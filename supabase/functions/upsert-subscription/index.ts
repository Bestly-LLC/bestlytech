// CY-MIG-01 / C1 hardening: StoreKit -> Supabase subscription sync.
//
// SECURITY (C1): this endpoint mirrors an Apple StoreKit purchase into the
// cross-platform `subscriptions` table (so Chrome/web can discover Pro by
// email). The subscriptions table is RLS-locked to service_role, so the write
// must go through this function.
//
// PREVIOUS STATE (still vulnerable): the endpoint trusted a shared
// `x-internal-secret` that was EMBEDDED IN THE SHIPPED APP BINARY. Anyone who
// extracted that string from the app could POST {email, plan:"lifetime"} and
// grant themselves permanent Pro — the paywall was fully bypassable.
//
// NEW MODEL (fail-safe, prove-the-purchase):
//   1. Apple/StoreKit path — the client MUST send the transaction's signed JWS
//      (`jws` / jwsRepresentation). We verify it SERVER-SIDE with zero trust in
//      the client: validate the x5c certificate chain up to Apple's pinned Root
//      CA G3, verify the ES256 JWS signature with the leaf cert, confirm the
//      bundleId is Cookie Yeti's and the productId is one of our Pro products,
//      and derive plan/expiry from the DECODED, VERIFIED payload. The client's
//      `plan` is ignored. `email` is accepted only as the cross-link key (Apple
//      does not put the user's email in the transaction) — but Pro is granted
//      ONLY when a genuine Apple-signed purchase is proven.
//   2. Admin/manual path — a SERVER-ONLY secret in the `UPSERT_ADMIN_SECRET`
//      function env var (NOT shipped in any client binary) allows manual grants
//      via server-side curl. This is the only remaining {email, plan} path.
//   3. Everything else is rejected (401/400) and logged.
//
// The old embedded-secret / internal_fn_secrets table path is INTENTIONALLY no
// longer honored — that secret must be considered compromised and rotated.
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as x509 from "https://esm.sh/@peculiar/x509@1.12.3";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

x509.cryptoProvider.set(crypto as unknown as Crypto);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// SHA-256 fingerprint of "Apple Root CA - G3" (apple.com/certificateauthority).
// Root pinning: only certificate chains that terminate in THIS exact Apple root
// are accepted, so an attacker cannot present a self-signed x5c chain.
const APPLE_ROOT_CA_G3_SHA256 =
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";

// Cookie Yeti app bundle ids (iOS + macOS share the same StoreKit products but
// have distinct bundle ids). The verified transaction's bundleId must match.
const ALLOWED_BUNDLE_IDS = new Set([
  "tech.bestly.cookieyeti.ios.hhw5x23by2a",
  "tech.bestly.cookieyeti.macos.hhw5x23by2a",
]);

// Pro products -> plan label. Includes legacy ids still present in old installs.
const PRODUCT_PLAN: Record<string, string> = {
  "tech.bestly.cookieyeti.monthly": "monthly",
  "tech.bestly.cookieyeti.yearly": "yearly",
  "tech.bestly.cookieyeti.lifetime": "lifetime",
  "com.bestly.cookieyeti.lifetime": "lifetime",
  "tech.slc.cookieaddy.macos.yearly": "yearly",
};
// Subscription products require an unexpired expiresDate; lifetime does not.
const SUBSCRIPTION_PRODUCTS = new Set([
  "tech.bestly.cookieyeti.monthly",
  "tech.bestly.cookieyeti.yearly",
  "tech.slc.cookieaddy.macos.yearly",
]);

const ADMIN_ALLOWED_PLANS = new Set(["monthly", "yearly", "lifetime"]);

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function b64urlToBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4;
  if (pad) t += "=".repeat(4 - pad);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface AppleTxn {
  bundleId?: string;
  productId?: string;
  type?: string;
  expiresDate?: number;
  revocationDate?: number;
  originalTransactionId?: string;
  transactionId?: string;
}

// Verify an Apple StoreKit2 signed transaction (JWS). Throws on any failure so
// the caller fails CLOSED (no grant). Returns the decoded, verified payload.
async function verifyAppleJWS(jws: string): Promise<AppleTxn> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("jws_malformed");
  const [h, p, s] = parts;

  const header = JSON.parse(b64urlToString(h));
  if (header.alg !== "ES256") throw new Error("jws_bad_alg");
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2) throw new Error("jws_no_chain");

  const certs = x5c.map((c: string) => new x509.X509Certificate(b64ToBytes(c)));
  const leaf = certs[0];
  const root = certs[certs.length - 1];
  const now = new Date();

  // 1. Pin the root of the chain to Apple Root CA G3 (by SHA-256 of its DER).
  const rootFp = toHex(await crypto.subtle.digest("SHA-256", root.rawData));
  if (!timingSafeEqual(rootFp, APPLE_ROOT_CA_G3_SHA256)) throw new Error("jws_untrusted_root");
  if (now < root.notBefore || now > root.notAfter) throw new Error("jws_root_expired");

  // 2. Verify each certificate is signed by the next one up the chain, and is
  //    within its validity window.
  for (let i = 0; i < certs.length - 1; i++) {
    const child = certs[i];
    const parent = certs[i + 1];
    const parentKey = await parent.publicKey.export();
    const ok = await child.verify({ publicKey: parentKey, signatureOnly: true });
    if (!ok) throw new Error("jws_chain_invalid");
    if (now < child.notBefore || now > child.notAfter) throw new Error("jws_cert_expired");
  }

  // 3. Verify the JWS body signature with the (now-trusted) leaf public key.
  const leafKey = await crypto.subtle.importKey(
    "spki",
    leaf.publicKey.rawData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const sig = b64urlToBytes(s);
  const signingInput = new TextEncoder().encode(`${h}.${p}`);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, leafKey, sig, signingInput);
  if (!valid) throw new Error("jws_sig_invalid");

  return JSON.parse(b64urlToString(p)) as AppleTxn;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    SB_SECRET,
    { auth: { persistSession: false } },
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return json({ ok: false, error: "invalid_email" }, 400);

  let plan: string;
  let periodEnd: string | null = null;
  const jws = typeof body.jws === "string" ? body.jws : (typeof body.jwsRepresentation === "string" ? body.jwsRepresentation : "");

  if (jws) {
    // ---- Apple StoreKit path: prove the purchase via signed transaction ----
    let txn: AppleTxn;
    try {
      txn = await verifyAppleJWS(jws);
    } catch (e) {
      console.error("upsert-subscription REJECT jws_verify_failed", { email, reason: String(e) });
      return json({ ok: false, error: "jws_verification_failed" }, 401);
    }
    if (txn.revocationDate) {
      console.error("upsert-subscription REJECT revoked", { email, txn: txn.transactionId });
      return json({ ok: false, error: "transaction_revoked" }, 403);
    }
    if (!txn.bundleId || !ALLOWED_BUNDLE_IDS.has(txn.bundleId)) {
      console.error("upsert-subscription REJECT bundle", { email, bundleId: txn.bundleId });
      return json({ ok: false, error: "bundle_mismatch" }, 403);
    }
    const mapped = txn.productId ? PRODUCT_PLAN[txn.productId] : undefined;
    if (!mapped) {
      console.error("upsert-subscription REJECT product", { email, productId: txn.productId });
      return json({ ok: false, error: "product_not_pro" }, 403);
    }
    if (SUBSCRIPTION_PRODUCTS.has(txn.productId!)) {
      if (!txn.expiresDate || txn.expiresDate <= Date.now()) {
        console.error("upsert-subscription REJECT expired", { email, productId: txn.productId, expiresDate: txn.expiresDate });
        return json({ ok: false, error: "subscription_expired" }, 403);
      }
      periodEnd = new Date(txn.expiresDate).toISOString();
    }
    plan = mapped;
  } else {
    // ---- Admin/manual path: server-only secret (NOT in any client binary) ----
    const provided = req.headers.get("x-internal-secret") ?? "";
    if (!provided) {
      // No signed Apple transaction and no admin secret -> hard reject. This is
      // the path that closes the "bare {email, plan} free Pro" bypass.
      console.error("upsert-subscription REJECT no_jws_or_secret", { email });
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    const adminSecret = Deno.env.get("UPSERT_ADMIN_SECRET") ?? "";
    if (!adminSecret) {
      console.error("upsert-subscription REJECT admin_not_configured", { email });
      return json({ ok: false, error: "server_misconfigured" }, 500);
    }
    if (!timingSafeEqual(provided, adminSecret)) {
      console.error("upsert-subscription REJECT bad_admin_secret", { email });
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    const requested = String(body.plan ?? "").trim();
    if (!ADMIN_ALLOWED_PLANS.has(requested)) return json({ ok: false, error: "invalid_plan" }, 400);
    plan = requested;
  }

  try {
    const { data: existing } = await db.from("subscriptions").select("id").eq("email", email).limit(1);
    if (existing && existing.length > 0) {
      const update: Record<string, unknown> = { plan, status: "active", updated_at: new Date().toISOString() };
      if (periodEnd) update.current_period_end = periodEnd;
      await db.from("subscriptions").update(update).eq("email", email);
    } else {
      const insert: Record<string, unknown> = {
        email,
        plan,
        status: "active",
        stripe_customer_id: "storekit_" + crypto.randomUUID(),
      };
      if (periodEnd) insert.current_period_end = periodEnd;
      await db.from("subscriptions").insert(insert);
    }
    return json({ ok: true, plan });
  } catch (e) {
    console.error("upsert-subscription db_error", { email, error: String(e) });
    return json({ ok: false, error: String(e) }, 200);
  }
});
