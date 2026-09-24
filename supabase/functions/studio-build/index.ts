// studio-build — the state machine behind the "Ask" pill's builder.
//
// The builder is a fresh Claude session with no memory. Everything it needs to
// know and everything it must record goes through here, so the session never
// composes SQL and never touches a table directly. One key, one door.
//
// v10 (Spark, 2026-09-22): key in Vault; boot loader means shipping is a row
//    flip; record merges over the live build; 'handoff' is its own status.
// v11: memory / remember. v12: rollback — the watchdog's hands.
// v13 (2026-09-23): Vercel Deployment Protection. Protection covers every
//    *.vercel.app URL including PRODUCTION deployment URLs, which is what
//    rollback's serves() probe fetches. So serves() presents the Protection
//    Bypass secret, read at request time from Vault (vercel_bypass_secret,
//    service_role only), never held in source. bypass_setup registers it.
// v14: tried to fail loudly when locked out, by looking for 401/403.
// v15 (2026-09-23): THE v14 CHECK WAS WRONG AND WOULD NOT HAVE FIRED.
//    Measured against the real thing: a protected deployment does not answer
//    401. It answers 302 to https://vercel.com/sso-api?..., and fetch() follows
//    that by default all the way to vercel.com/login — HTTP 200, ~340 KB of
//    Vercel's own login page. So the probe saw a perfectly good 200 that simply
//    did not contain the loader, returned false, and rollback would once again
//    have said "no recent production deployment serves the loader" while the
//    real problem was that it could not see them at all. The probe now uses
//    redirect:"manual" so the 302 is visible, and treats a hop to vercel.com's
//    sso-api/login as being locked out, alongside 401/403.
//
//   health | memory | remember | queue | live | put | rollback | bypass_setup
//   building | record | preview | deploy | shipfiles | shipped | fail | handoff
//   ship {staff_token, request_id}   staff door: the Ship button

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const BUCKET = "review";
const TALK_ROOM = "fyqvdsa4";
const ORIGIN = "https://studio.bestly.tech";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

async function okKey(k: string): Promise<boolean> {
  if (!k || k.length < 20) return false;
  const { data, error } = await db.rpc("studio_build_key_ok", { p_key: k });
  return !error && data === true;
}

/* The Protection Bypass for Automation secret. Vault only, read at request
   time, never logged and never returned to a caller. Null means "not set up". */
async function bypassSecret(): Promise<string | null> {
  try {
    const { data, error } = await db.rpc("vercel_bypass_secret");
    if (error || !data) return null;
    const s = String(data).trim();
    return s.length >= 16 ? s : null;
  } catch { return null; }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-build-key, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function talk(message: string): Promise<boolean> {
  try {
    const { data } = await db.rpc("get_nextcloud_credentials");
    const row = Array.isArray(data) ? data[0] : data;
    const base = String(row?.base_url ?? "").replace(/\/+$/, "");
    const user = String(row?.username ?? ""), pass = String(row?.app_password ?? "");
    if (!base || !user || !pass) return false;
    const r = await fetch(`${base}/ocs/v2.php/apps/spreed/api/v1/chat/${TALK_ROOM}`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${user}:${pass}`), "OCS-APIRequest": "true",
                 Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    return r.ok;
  } catch { return false; }
}

async function note(request_id: string, body: string) {
  await db.from("studio_request_messages").insert({ request_id, role: "claude", body });
}
async function setStatus(request_id: string, status: string, extra: Record<string, unknown> = {}) {
  const { error } = await db.from("studio_requests").update({ status, updated_at: new Date().toISOString(), ...extra }).eq("id", request_id);
  if (error) throw new Error(error.message);
}
async function title(request_id: string): Promise<string> {
  const { data } = await db.from("studio_requests").select("title").eq("id", request_id).maybeSingle();
  return String(data?.title ?? request_id);
}
async function liveBuild() {
  const { data, error } = await db.from("studio_builds").select("*").eq("status", "live").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
async function latestBuild(request_id: string) {
  const { data, error } = await db.from("studio_builds").select("*").eq("request_id", request_id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
const loaderLive = (b: Record<string, any> | null) => !!(b?.files?.["_loader/index.html"]);

const PUB = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}`;
const VERCEL_TEAM = "team_Kwxz5PIgolwApAnbC131PCDd", VERCEL_PROJECT = "prj_LmNf0QMdiQJZQ6pDXJiC3VYHTJtC";

function buildSh(files: Record<string, string>, id = "?"): string {
  const pub = Object.keys(files).filter((n) => !n.startsWith("_loader/"));
  const dirs = [...new Set(pub.map((p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "").filter(Boolean))];
  const lines = pub.map((n) => files["_loader/" + n]
    ? `curl -fsSL "$B/${files["_loader/" + n]}" | sed "s#__FALLBACK__#${files[n]}#" > "public/${n}"`
    : `curl -fsSL "$B/${files[n]}" -o "public/${n}"`);
  return `#!/bin/bash\n# generated by studio-build from studio_builds id=${id}\nset -euo pipefail\nB="${PUB}"\nmkdir -p public${dirs.map((d) => " public/" + d).join("")}\n${lines.join("\n")}\n`;
}

async function vercelDeploy(build: Record<string, any>, target: "preview" | "production"): Promise<{ url: string; id: string }> {
  const token = Deno.env.get("VERCEL_TOKEN");
  if (!token) throw new Error("no VERCEL_TOKEN secret");
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const v = build.vercel ?? {};
  const body: Record<string, unknown> = {
    name: "bestly-review", project: VERCEL_PROJECT,
    files: [{ file: "build.sh", data: buildSh(build.files, build.id) },
            { file: "vercel.json", data: JSON.stringify({ headers: v.headers, rewrites: v.rewrites, redirects: v.redirects }, null, 1) }],
    projectSettings: { buildCommand: "bash build.sh", outputDirectory: "public", installCommand: "", framework: null },
  };
  if (target === "production") body.target = "production";
  const r = await fetch(`https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`vercel ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 200)}`);
  const id = String(j.id), url = `https://${j.url}`;
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 3000));
    const s = await fetch(`https://api.vercel.com/v13/deployments/${id}?teamId=${VERCEL_TEAM}`, { headers: H }).then((x) => x.json());
    const st = String(s.readyState ?? s.status ?? "");
    if (st === "READY") return { url, id };
    if (st === "ERROR" || st === "CANCELED") throw new Error(`vercel deployment ${id} ended ${st}`);
  }
  throw new Error(`vercel deployment ${id} still building after 2 minutes`);
}

async function stale(request_id: string, build: Record<string, any>): Promise<boolean> {
  const live = await liveBuild();
  if (!live || !build.base_build || build.base_build === live.id) return false;
  await db.from("studio_builds").update({ status: "superseded" }).eq("id", build.id);
  await setStatus(request_id, "open", { preview_url: null });
  await note(request_id, "The app changed since this preview was built, so shipping it would have undone newer work. It is being rebuilt on the current version; a fresh preview lands within about 20 minutes.");
  return true;
}

function previewUrl(build: Record<string, any>, request: Record<string, any> | null): string {
  const changed = Object.keys(build.parts?.changed ?? {});
  const boardOnly = changed.length > 0 && changed.every((n) => n === "board.html");
  const slug = request?.client_slug || "bestly-test";
  return boardOnly ? `${ORIGIN}/${slug}?preview=${build.id}` : `${ORIGIN}/?preview=${build.id}`;
}

async function publishPreview(rid: string, build: Record<string, any>, msg?: string) {
  const { data: req } = await db.from("studio_requests").select("client_slug").eq("id", rid).maybeSingle();
  const url = previewUrl(build, req);
  await setStatus(rid, "preview", { preview_url: url });
  await note(rid, String(msg ?? build.note ?? "Built. Open the preview to look at it."));
  return url;
}

async function release(rid: string, build: Record<string, any>): Promise<string> {
  const live = await liveBuild();
  const loaderNext = loaderLive(build) && loaderLive(live) &&
    build.files["_loader/index.html"] === live!.files["_loader/index.html"] &&
    build.files["_loader/board.html"] === live!.files["_loader/board.html"] &&
    JSON.stringify(build.vercel?.rewrites) === JSON.stringify(live!.vercel?.rewrites) &&
    JSON.stringify(build.vercel?.redirects) === JSON.stringify(live!.vercel?.redirects) &&
    JSON.stringify(build.vercel?.headers) === JSON.stringify(live!.vercel?.headers);
  if (!loaderNext) {
    const { id } = await vercelDeploy(build, "production");
    await db.from("studio_builds").update({ vercel: { ...(build.vercel ?? {}), deployment: id } }).eq("id", build.id);
  }
  await promote(rid, build);
  return loaderNext ? "loader" : "vercel";
}

async function promote(request_id: string, build: Record<string, any>) {
  const { error: e1 } = await db.from("studio_builds").update({ status: "superseded" }).eq("status", "live");
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await db.from("studio_builds").update({ status: "live" }).eq("id", build.id);
  if (e2) throw new Error(e2.message);
  await setStatus(request_id, "shipped", { preview_url: null });
  await note(request_id, "Shipped. It is live on studio.bestly.tech (reload to see it).");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  const action = String(body.action ?? "");
  const rid = body.request_id ? String(body.request_id) : "";

  if (action === "ship") {
    const token = String(body.staff_token ?? "");
    if (!token || !rid) return J({ ok: false, error: "staff_token and request_id required" }, 400);
    const { data: s, error } = await db.rpc("studio_resolve_staff", { p_token: token });
    const staff = Array.isArray(s) ? s[0] : s;
    if (error || !staff?.id) return J({ ok: false, error: "not_found" }, 401);
    if (!staff.can_promote) return J({ ok: false, error: "not_permitted" }, 403);
    try {
      const { data: r } = await db.from("studio_requests").select("status").eq("id", rid).maybeSingle();
      if (!r || !["ship", "preview"].includes(r.status)) return J({ ok: false, error: "not_shipping", status: r?.status ?? null }, 409);
      const build = await latestBuild(rid);
      if (!build) return J({ ok: false, error: "no build recorded for this request" }, 404);
      if (await stale(rid, build)) return J({ ok: false, error: "stale", rebuilding: true }, 200);
      const how = await release(rid, build);
      return J({ ok: true, url: ORIGIN, how });
    } catch (e) {
      await setStatus(rid, "ship").catch(() => {});
      return J({ ok: false, error: (e as Error).message, queued: true }, 200);
    }
  }

  const k = req.headers.get("x-build-key") ?? "";
  if (!(await okKey(k))) return J({ ok: false, error: "unauthorized" }, 401);

  try {
    if (action === "health") {
      const live = await liveBuild();
      return J({ ok: true, vercel_token: !!Deno.env.get("VERCEL_TOKEN"), bypass_secret: !!(await bypassSecret()), loader_live: loaderLive(live), live: live?.id ?? null });
    }

    if (action === "bypass_setup") {
      const token = Deno.env.get("VERCEL_TOKEN");
      if (!token) return J({ ok: false, error: "no VERCEL_TOKEN secret" }, 500);
      const bp = await bypassSecret();
      if (!bp) return J({ ok: false, error: "vercel_bypass_secret is not in the vault" }, 500);
      const r = await fetch(`https://api.vercel.com/v1/projects/${VERCEL_PROJECT}/protection-bypass?teamId=${VERCEL_TEAM}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ generate: { secret: bp, note: "studio-build rollback probe" } }),
      });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      const code = (j as any)?.error?.code ?? null;
      return J({ ok: r.ok, status: r.status, registered: r.ok, error_code: r.ok ? null : code });
    }

    if (action === "memory") {
      const q = String(body.query ?? "").trim(), area = body.area ? String(body.area) : null;
      let sel = db.from("bestly_memory").select("area,key,title,body,updated_at").eq("active", true);
      if (area) sel = sel.eq("area", area);
      if (q) for (const w of q.split(/\s+/).slice(0, 6)) sel = sel.or(`title.ilike.%${w.replace(/[,()%]/g, "")}%,body.ilike.%${w.replace(/[,()%]/g, "")}%`);
      const { data, error } = await sel.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(q || area ? 12 : 60);
      if (error) throw new Error(error.message);
      return J({ ok: true, notes: (data ?? []).map((m: any) => q || area ? { ...m, body: String(m.body).slice(0, 2500) } : { area: m.area, key: m.key, title: m.title }) });
    }
    if (action === "remember") {
      const area = String(body.area ?? ""), key = String(body.key ?? ""), text = String(body.body ?? "");
      if (!/^[a-z0-9-]{2,30}$/.test(area) || !/^[a-z0-9-]{2,60}$/.test(key)) return J({ ok: false, error: "area and key are short lowercase-hyphen slugs" }, 400);
      if (text.trim().length < 10 || text.length > 8000) return J({ ok: false, error: "body must be 10-8000 characters" }, 400);
      const { error } = await db.from("bestly_memory").upsert({ area, key, title: String(body.title ?? key), body: text, active: true,
        kind: "note", source: "builder", written_by: "Spark (builder)" }, { onConflict: "area,key" });
      if (error) return J({ ok: false, error: error.message }, 400);
      return J({ ok: true, area, key });
    }

    if (action === "queue") {
      const cutoff = new Date(Date.now() - 90 * 60_000).toISOString();
      const { data, error } = await db.from("studio_requests")
        .select("id,title,status,client_slug,context,preview_url,created_at,updated_at")
        .or(`status.in.(open,ship),and(status.eq.building,updated_at.lt.${cutoff})`)
        .order("created_at").limit(5);
      if (error) throw new Error(error.message);
      const out = [];
      for (const r of data ?? []) {
        const { data: m } = await db.from("studio_request_messages")
          .select("role,body,created_at").eq("request_id", r.id).order("created_at");
        out.push({ ...r, messages: m ?? [] });
      }
      return J({ ok: true, requests: out });
    }

    if (action === "live") {
      const data = await liveBuild();
      if (!data) return J({ ok: false, error: "no live build recorded" }, 404);
      return J({ ok: true, build: data });
    }

    if (action === "put") {
      const dest = String(body.dest ?? "");
      if (!/^(app|src|tools)\/[A-Za-z0-9._\/-]+$/.test(dest) || dest.includes("..")) return J({ ok: false, error: "dest must be under app/, src/ or tools/" }, 400);
      const b64 = String(body.base64 ?? "");
      if (!b64 || b64.length > 12_000_000) return J({ ok: false, error: "base64 missing or over 12 MB" }, 400);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ct = dest.endsWith(".html") ? "text/html; charset=utf-8" : dest.endsWith(".js") ? "text/javascript; charset=utf-8"
               : dest.endsWith(".json") ? "application/json" : dest.endsWith(".webmanifest") ? "application/manifest+json"
               : dest.endsWith(".png") ? "image/png" : "application/octet-stream";
      const { error } = await db.storage.from(BUCKET).upload(dest, bytes, { contentType: ct, upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(error.message);
      return J({ ok: true, path: dest, bytes: bytes.length, url: `${PUB}/${dest}` });
    }

    /* Production rollback. studio-drift finds the site dead and calls this.
       v15: the probe must be able to tell "this deployment served the wrong
       bytes" from "I was not allowed to look". Deployment Protection answers a
       302 to vercel.com/sso-api, and a following fetch lands on a 200-with-
       login-page, so redirect:"manual" is required or the two are
       indistinguishable. */
    if (action === "rollback") {
      const token = Deno.env.get("VERCEL_TOKEN");
      if (!token) return J({ ok: false, error: "no VERCEL_TOKEN secret" }, 500);
      const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const live = await liveBuild();
      const tplPath = live?.files?.["_loader/index.html"];
      if (!tplPath) return J({ ok: false, error: "the live build is not loader-served" }, 409);
      const tpl = await fetch(`${PUB}/${tplPath}`).then((r) => r.text());
      const bones = tpl.replace("__FALLBACK__", "").slice(50, 200);
      const bp = await bypassSecret();
      const probeHeaders: Record<string, string> = { "cache-control": "no-cache" };
      if (bp) {
        probeHeaders["x-vercel-protection-bypass"] = bp;
        probeHeaders["x-vercel-set-bypass-cookie"] = "false";
      }
      const lockedOut = (loc: string) => /vercel\.com\/(sso-api|login)/i.test(loc);
      let refused = 0;
      const serves = async (u: string) => {
        try {
          const r = await fetch(u, { headers: probeHeaders, redirect: "manual" });
          if (r.status === 401 || r.status === 403) { refused++; return false; }
          if (r.status >= 300 && r.status < 400) {
            if (lockedOut(r.headers.get("location") ?? "")) refused++;
            return false;
          }
          if (!r.ok) return false;
          const t = await r.text();
          return t.length < 20000 && t.includes(bones);
        } catch { return false; }
      };
      const list = await fetch(
        `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT}&target=production&state=READY&limit=12&teamId=${VERCEL_TEAM}`,
        { headers: H }).then((r) => r.json());
      const skip = String(body.skip ?? "");
      for (const d of (list.deployments ?? [])) {
        const id = String(d.uid ?? d.id ?? "");
        if (!d.url || id === skip) continue;
        if (!(await serves(`https://${d.url}/`))) continue;
        const pr = await fetch(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT}/promote/${id}?teamId=${VERCEL_TEAM}`,
          { method: "POST", headers: H });
        if (!pr.ok) return J({ ok: false, error: `promote ${id}: HTTP ${pr.status}` }, 502);
        await new Promise((r) => setTimeout(r, 8000));
        const back = await serves(ORIGIN + "/");
        await talk(back
          ? `🔁 studio.bestly.tech was down. Rolled production back to ${id} — it is answering again.`
          : `🔁 Rolled production back to ${id}, but studio.bestly.tech is still not right. This needs a person.`);
        return J({ ok: true, promoted: id, url: d.url, serving: back });
      }
      if (refused > 0) {
        const msg = `locked out, not broken: ${refused} production deployment(s) bounced the probe to Vercel's login. Deployment Protection is on for bestly-review and the automation bypass is not registered, so the watchdog cannot see the deployments — this is NOT evidence that they are bad. Fix: set VERCEL_TOKEN on the edge functions, then call studio-build action bypass_setup; or turn Vercel Authentication off for bestly-review.`;
        await talk(`🔒 Rollback could not run — ${msg}`);
        return J({ ok: false, error: msg, refused, locked_out: true }, 409);
      }
      return J({ ok: false, error: "no recent production deployment serves the loader" }, 409);
    }

    if (!rid) return J({ ok: false, error: "request_id required" }, 400);

    if (action === "building") { await setStatus(rid, "building"); return J({ ok: true }); }

    if (action === "record") {
      const live = await liveBuild();
      if (!live) return J({ ok: false, error: "no live build to build on" }, 409);
      const changed = (body.changed ?? {}) as Record<string, string>;
      for (const [n, p] of Object.entries(changed)) {
        if (!(n in live.files)) return J({ ok: false, error: `not a live file: ${n}` }, 400);
        if (!/^app\/[A-Za-z0-9._\/-]+$/.test(p)) return J({ ok: false, error: `bad path for ${n}` }, 400);
      }
      if (!Object.keys(changed).length && !body.files) return J({ ok: false, error: "changed:{name:path} required" }, 400);
      const files = body.files ?? { ...live.files, ...changed };
      const parts = { ...(live.parts ?? {}), changed, recipe: String(body.note ?? ""), by: "builder", request_id: rid };
      const { data, error } = await db.from("studio_builds")
        .insert({ request_id: rid, parts, files, vercel: live.vercel, note: body.note ?? null, status: "preview", base_build: live.id })
        .select("id").single();
      if (error) throw new Error(error.message);
      return J({ ok: true, build_id: data.id });
    }

    if (action === "preview" || (action === "deploy" && body.target !== "production")) {
      const build = body.build_id
        ? (await db.from("studio_builds").select("*").eq("id", String(body.build_id)).maybeSingle()).data
        : await latestBuild(rid);
      if (!build) return J({ ok: false, error: "no build recorded for this request" }, 404);
      const url = await publishPreview(rid, build, body.note);
      return J({ ok: true, url });
    }

    if (action === "deploy") {
      const build = await latestBuild(rid);
      if (!build) return J({ ok: false, error: "no build recorded for this request" }, 404);
      const { data: r } = await db.from("studio_requests").select("status").eq("id", rid).maybeSingle();
      if (r?.status !== "ship") return J({ ok: false, error: "not_shipping: a person has to tap Ship first", status: r?.status }, 409);
      if (await stale(rid, build)) return J({ ok: false, error: "stale: rebuilt from the current live build instead" }, 409);
      const how = await release(rid, build);
      return J({ ok: true, url: ORIGIN, shipped: true, how });
    }

    if (action === "shipfiles") {
      const data = await latestBuild(rid);
      if (!data) return J({ ok: false, error: "no build recorded for this request" }, 404);
      if (await stale(rid, data)) return J({ ok: false, error: "stale: rebuilt from the current live build instead" }, 409);
      return J({ ok: true, build: data, build_sh: buildSh(data.files, data.id) });
    }

    if (action === "shipped") {
      const bid = String(body.build_id ?? "");
      const { data: build } = await db.from("studio_builds").select("*").eq("id", bid).maybeSingle();
      if (!build) return J({ ok: false, error: "build_id required" }, 400);
      await promote(rid, build);
      return J({ ok: true });
    }

    if (action === "fail" || action === "handoff") {
      const status = action === "handoff" ? "handoff" : body.declined ? "declined" : "failed";
      await setStatus(rid, status);
      await note(rid, String(body.why ?? (status === "declined" ? "Declined." : status === "handoff" ? "This needs a person." : "The build failed.")).slice(0, 2000));
      if (status !== "handoff") await talk(`${status === "declined" ? "⛔ Declined" : "❌ Build failed"}: "${await title(rid)}". Details in the Ask pill.`);
      return J({ ok: true });
    }

    return J({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});
