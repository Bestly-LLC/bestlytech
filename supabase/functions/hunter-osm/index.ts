// hunter-osm: DIAGNOSTIC ONLY, not called by hunter-run. Probes the public Overpass mirrors from the edge runtime.
// Finding (2026-10-11): every mirror answers 406 to edge-runtime requests whatever the headers, so hunter-run asks Overpass
// through pg_net instead (hunter_net_get / hunter_net_result). Kept so the probe can be re-run if the mirrors change.
// Auth: service key as Bearer/apikey.
//   {query}           -> {ok, els, mirror} | {ok:false, error}
//   {probe:true, q?}  -> status of each header variant against one mirror (diagnostics)
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const KEYS = new Set([__keys("SUPABASE_SECRET_KEYS"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")].filter(Boolean) as string[]);
const UA = "BestlyHunter/1.0 (jared@bestly.tech)";
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VARIANTS: Record<string, Record<string, string>> = {
  plain: { "user-agent": UA, accept: "*/*", "accept-language": "en-US,en;q=0.9", "accept-encoding": "identity" },
  json: { "user-agent": UA, accept: "application/json", "accept-language": "en-US,en;q=0.9", "accept-encoding": "identity" },
  minimal: { "user-agent": UA },
};

async function once(url: string, q: string, hdr: Record<string, string>, ms: number): Promise<{ status: number; text: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url + "?data=" + encodeURIComponent(q), { headers: hdr, signal: ctl.signal });
    return { status: r.status, text: await r.text() };
  } catch (e) { return { status: 0, text: String(e).slice(0, 120) }; } finally { clearTimeout(t); }
}

Deno.serve(async (req: Request) => {
  const tok = ((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || req.headers.get("apikey") || "").trim();
  if (!tok || !KEYS.has(tok)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.probe) {
    const q = String(body.q ?? '[out:json][timeout:25];nwr["shop"="car_repair"]["name"](34.05,-118.25,34.06,-118.24);out tags center 5;');
    const out: Record<string, unknown> = {};
    for (const [k, h] of Object.entries(VARIANTS)) {
      const r = await once(MIRRORS[0], q, h, 30_000);
      out[k] = { status: r.status, head: r.text.slice(0, 100).replace(/\s+/g, " ") };
      await sleep(2500);
    }
    return Response.json({ ok: true, out });
  }
  const q = String(body.query ?? "");
  if (!q) return Response.json({ ok: false, error: "no query" }, { status: 400 });
  const errs: string[] = [];
  for (const url of MIRRORS) {
    const host = new URL(url).hostname;
    for (let a = 0; a < 2; a++) {
      const r = await once(url, q, VARIANTS.plain, 55_000);
      if (r.status === 200) {
        try { return Response.json({ ok: true, mirror: host, els: JSON.parse(r.text).elements ?? [] }); }
        catch { errs.push(`${host}: not JSON`); break; }
      }
      errs.push(r.status ? `${host} answered ${r.status}` : `${host}: ${r.text}`);
      if (r.status === 429 && a === 0) { await sleep(8000); continue; }
      break;
    }
  }
  return Response.json({ ok: false, error: errs.join("; ").slice(0, 400) });
});
