// studio-drift — the watchdog for studio.bestly.tech, and its first responder.
//
// Shipping is a studio_builds row flip, which only reaches people while Vercel
// serves the BOOT LOADER. Two ways that breaks, and on 2026-09-22 both happened:
//
//   DRIFT — a deploy bakes the app itself in. The site works, but every later
//           ship changes nothing for anyone. Loud, but not urgent.
//   DOWN  — a deploy lands with nothing in it. Every path 404s. Urgent.
//
// v1 reported drift and, on DOWN, said nothing at all: its fetch helper threw on
// a non-200, the throw fell into the catch, and the catch only returned an error
// to a cron job nobody reads. The single most serious failure was the one case
// it stayed silent on, and it ran every 30 minutes, so the first anyone knew was
// a person opening the site. (Jared, 2026-09-22: "scout should have caught this
// — learn from this mistake and self heal in the future.")
//
// So now: it runs every minute, a non-200 is the loudest result rather than an
// exception, and when production is DOWN it asks studio-build to roll production
// back to the newest deployment that still serves the loader, then says what it
// did. VERCEL_TOKEN lives in studio-build and nowhere else, so the hands are
// there and this only knocks. It heals at most 3 times an hour and never twice
// for the same deployment, so a broken build cannot become a promote loop.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const PUB = "https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/";
const SITE = "https://studio.bestly.tech";
const MAX_HEALS_PER_HOUR = 3;
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

/** Never throws. A dead page is a result, not an exception — that was the bug. */
async function look(u: string): Promise<{ ok: boolean; status: number; body: string; err?: string }> {
  try {
    const r = await fetch(u, { headers: { "cache-control": "no-cache" }, redirect: "follow" });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: "", err: (e as Error).message };
  }
}

const isLoader = (served: string, tpl: string) => {
  const bones = tpl.replace("__FALLBACK__", "").slice(0, 400);
  return served.length < 20000 && served.includes(bones.slice(50, 200));
};

/* studio-build holds VERCEL_TOKEN, so the hands live there and the watchdog just
   knocks. One key, one door — the same rule the builder already follows. */
async function buildDoor(action: string, extra: Record<string, unknown> = {}) {
  const { data: key } = await db.rpc("studio_build_key");
  if (!key) throw new Error("studio_build_key is not in the vault");
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/studio-build`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-build-key": String(key) },
    body: JSON.stringify({ action, ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  return j as Record<string, unknown>;
}

async function tell(subject: string, body: string, dedupe: string, payload: Record<string, unknown>) {
  const { data: owners } = await db.from("approval_staff").select("id, email").eq("is_owner", true).eq("active", true);
  for (const o of owners ?? []) {
    await db.from("notify_outbox").insert({
      kind: "drift", audience: "staff", staff_id: o.id, to_email: o.email,
      subject, body, link: SITE, dedupe, payload,
    }).then(() => {}, () => {});
  }
  await db.rpc("talk_say", {
    p_kind: "review", p_line: "🚨 " + subject + "\n" + body,
    p_dedupe: dedupe, p_many: "🚨 {n} notices about studio.bestly.tech.", p_payload: payload,
  }).then(() => {}, () => {});
}

Deno.serve(async (req) => {
  const started = new Date().toISOString();
  try {
    // ?probe=1 — prove the healing arm is reachable without breaking anything.
    // A self-healer nobody has watched heal is a hope, not a mechanism.
    if (new URL(req.url).searchParams.get("probe")) {
      let health: unknown = null, err: string | null = null;
      try { health = await buildDoor("health"); } catch (e) { err = (e as Error).message; }
      return J({ ok: true, probe: true, build_door: health, error: err });
    }
    const { data: live } = await db.from("studio_builds").select("id, files").eq("status", "live").maybeSingle();
    if (!live) return J({ ok: false, error: "no live build" }, 409);
    const files = live.files as Record<string, string>;
    const tplPath = files["_loader/index.html"];
    if (!tplPath) return J({ ok: true, skipped: "not loader-served" });
    const tplRes = await look(PUB + tplPath);
    if (!tplRes.ok) return J({ ok: false, error: "cannot read the loader template" }, 500);
    const tpl = tplRes.body;

    // every door someone actually uses, not just the front one
    const pages = [`${SITE}/`, `${SITE}/centering-you`, `${SITE}/cy`];
    const down: string[] = [], drift: string[] = [];
    for (const u of pages) {
      const got = await look(u);
      if (!got.ok || !got.body.length) { down.push(`${u} → ${got.err ? got.err : "HTTP " + got.status}`); continue; }
      if (!isLoader(got.body, tpl)) drift.push(`${u} is serving ${got.body.length} bytes, not the boot loader — a deploy has baked the app in, so shipping no longer changes what anyone sees.`);
    }

    const state = down.length ? "down" : drift.length ? "drift" : "ok";
    if (state === "ok") {
      await db.from("studio_health").insert({ state, detail: { pages } });
      return J({ ok: true, state, live: live.id });
    }

    // ── DOWN: fix it, then say so ──────────────────────────────────────────
    if (state === "down") {
      let healed = false, to: string | null = null, note = "";
      const { data: recent } = await db.rpc("studio_heals_recent", { p_minutes: 60 });
      if ((recent ?? 0) >= MAX_HEALS_PER_HOUR) {
        note = `already promoted ${recent} times in the last hour — stopping rather than looping. This needs a person.`;
      } else {
        try {
          const r = await buildDoor("rollback");
          healed = r.ok === true && r.serving === true;
          to = (r.promoted as string) ?? null;
          note = r.ok === true
            ? (healed ? `rolled production back to ${to} — the site is answering again.`
                      : `rolled back to ${to} but the site is still not right. This needs a person.`)
            : `could not roll back: ${r.error ?? "the builder door refused"}`;
        } catch (e) { note = "could not heal it: " + (e as Error).message; }
      }
      await db.from("studio_health").insert({ state, detail: { down, drift }, healed, healed_to: to, note });
      await tell(
        healed ? "studio.bestly.tech went down — rolled back automatically" : "studio.bestly.tech is DOWN",
        down.join("\n") + "\n\n" + note,
        `down:${started.slice(0, 16)}`,
        { live_build: live.id, down, healed, healed_to: to },
      );
      return J({ ok: true, state, healed, healed_to: to, note, down });
    }

    // ── DRIFT: the site works, so say it loudly but change nothing ─────────
    await db.from("studio_health").insert({ state, detail: { drift } });
    await tell("Production is not serving the live build",
      drift.join("\n") + "\nFix: ship.js --write, then deploy build.sh + vercel.json only — never the app file.",
      "drift:" + live.id, { live_build: live.id });
    return J({ ok: true, state, drift });
  } catch (e) {
    await db.from("studio_health").insert({ state: "error", note: (e as Error).message }).then(() => {}, () => {});
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});
