// ltx-box — the LTX-2.5 video GPU box's door to Bestly (2026-10-05).
//
//   GET  ?v=<code>                 → 302 to a fresh 1-hour signed link for a finished clip (bestly.tech/v/<code>)
//   GET  ?op=waiting               → {waiting: n} jobs queued or rendering (AWS dispatcher Lambda; count only)
//   POST {op:"claim"}              → next queued job, plus a signed upload URL for its mp4      (box key)
//   POST {op:"finish", job, ok, render_s?, error?} → prices it and posts the result to the thread (box key)
//
// Box key: header x-ltx-key, compared to ltx_box.key_hash (sha256) by ltx_key_ok(). The key lives
// only on the box (/etc/bestly/ltx-box.key); nobody else ever sees it.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const BUCKET = "ltx-clips";
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const code = (url.searchParams.get("v") ?? "").trim().toLowerCase();
    if (code) {
      if (!/^[0-9a-f]{7}$/.test(code)) return new Response("Not found", { status: 404 });
      const { data: job } = await db.from("ltx_jobs").select("path,status").eq("code", code).maybeSingle();
      if (!job?.path || job.status !== "done") return new Response("That video is not ready or does not exist.", { status: 404 });
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(job.path, 3600);
      if (error || !data?.signedUrl) return new Response("Could not open the video right now.", { status: 502 });
      return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "no-store" } });
    }
    if (url.searchParams.get("op") === "waiting") {
      const { data } = await db.rpc("ltx_waiting");
      return J({ waiting: Number(data ?? 0) });
    }
    return new Response("Not found", { status: 404 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const { data: ok } = await db.rpc("ltx_key_ok", { p_key: req.headers.get("x-ltx-key") ?? "" });
  if (ok !== true) return J({ ok: false, error: "bad key" }, 401);
  const body = await req.json().catch(() => ({}));

  if (body.op === "claim") {
    const { data, error } = await db.rpc("ltx_claim");
    if (error) return J({ ok: false, error: error.message }, 500);
    const job = (data as any)?.job;
    if (!job) return J({ ok: true, job: null });
    const path = `${new Date().toISOString().slice(0, 10)}/${job.code}.mp4`;
    const { data: up, error: upErr } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (upErr || !up) {
      await db.rpc("ltx_finish", { p_job: job.id, p_ok: false, p_error: `upload link failed: ${upErr?.message}` });
      return J({ ok: false, error: "upload link failed" }, 502);
    }
    return J({ ok: true, job: { ...job, path, upload_url: up.signedUrl } });
  }

  if (body.op === "finish") {
    if (!body.job) return J({ ok: false, error: "job required" }, 400);
    const { data, error } = await db.rpc("ltx_finish", {
      p_job: body.job, p_ok: !!body.ok,
      p_render_s: Number.isFinite(body.render_s) ? Math.round(body.render_s) : null,
      p_path: body.ok ? String(body.path ?? "") || null : null,
      p_error: body.ok ? null : String(body.error ?? "render failed").slice(0, 500),
    });
    if (error) return J({ ok: false, error: error.message }, 500);
    return J(data);
  }

  return J({ ok: false, error: "unknown op" }, 400);
});
