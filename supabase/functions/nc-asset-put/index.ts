// One-shot uploader: PUTs a binary body into Nextcloud over WebDAV and returns a
// public share link. Gated by a throwaway token held in Vault (sig_upload_token).
// Delete this function and the token once the asset is in place.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
);

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

Deno.serve(async (req) => {
  try {
    const { data: ctx, error } = await sb.rpc("get_sig_upload_ctx");
    if (error) throw new Error(`ctx: ${error.message}`);

    if (req.headers.get("x-token") !== ctx.sig_upload_token) {
      return new Response("forbidden", { status: 403 });
    }

    const url   = new URL(req.url);
    const path  = url.searchParams.get("path");
    const ctype = url.searchParams.get("ctype") ?? "application/octet-stream";
    if (!path) return new Response("missing ?path", { status: 400 });

    const base = String(ctx.nextcloud_base_url).replace(/\/+$/, "");
    const user = String(ctx.nextcloud_user);
    const auth = "Basic " + btoa(`${user}:${ctx.nextcloud_app_password}`);
    const dav  = `${base}/remote.php/dav/files/${user}`;

    const parts = path.split("/").filter(Boolean);
    const file  = parts.pop()!;
    const steps: string[] = [];

    let acc = "";
    for (const seg of parts) {
      acc += "/" + seg;
      const r = await fetch(`${dav}${enc(acc)}`, { method: "MKCOL", headers: { Authorization: auth } });
      steps.push(`MKCOL ${acc} -> ${r.status}`);
    }

    const remote = "/" + parts.join("/") + "/" + file;
    const body = new Uint8Array(await req.arrayBuffer());
    const put = await fetch(`${dav}${enc(remote)}`, {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": ctype },
      body,
    });
    steps.push(`PUT ${file} (${body.length}B) -> ${put.status}`);
    if (put.status >= 300) {
      return Response.json({ ok: false, steps, detail: (await put.text()).slice(0, 400) }, { status: 502 });
    }

    const share = await fetch(`${base}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "OCS-APIRequest": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: remote, shareType: 3, permissions: 1 }),
    });
    const txt = await share.text();
    let token: string | null = null, link: string | null = null, msg: string | null = null;
    try {
      const j = JSON.parse(txt);
      token = j?.ocs?.data?.token ?? null;
      link  = j?.ocs?.data?.url ?? null;
      msg   = j?.ocs?.meta?.message ?? null;
    } catch { /* keep raw */ }

    return Response.json({
      ok: true, steps,
      share_status: share.status, share_message: msg,
      token, link,
      direct: token ? `${base}/s/${token}/download/${encodeURIComponent(file)}` : null,
      raw: token ? undefined : txt.slice(0, 600),
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
