// tiktok-poster — backend for the Cookie Yeti Poster review UI.
// Holds the TikTok token server-side (Supabase secrets); the page never sees it.
// Secrets required (supabase secrets set ...):
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN
// Actions:
//   GET  ?action=creator-info                              -> { data: creator_info }
//   POST { action:"post", videoUrl, caption, privacy }     -> publish status
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const API = "https://open.tiktokapis.com/v2";

async function accessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_key: Deno.env.get("TIKTOK_CLIENT_KEY")!,
    client_secret: Deno.env.get("TIKTOK_CLIENT_SECRET")!,
    grant_type: "refresh_token",
    refresh_token: Deno.env.get("TIKTOK_REFRESH_TOKEN")!,
  });
  const r = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token refresh failed: " + JSON.stringify(j));
  return j.access_token as string;
}

async function tk(path: string, tok: string, body: unknown) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || (req.method === "POST" ? "post" : "");

    if (action === "creator-info") {
      const tok = await accessToken();
      const { json } = await tk("/post/publish/creator_info/query/", tok, {});
      return J(json);
    }

    if (action === "post") {
      const b = await req.json().catch(() => ({}));
      const videoUrl = b.videoUrl, caption = (b.caption || "").slice(0, 2200), privacy = b.privacy || "SELF_ONLY";
      if (!videoUrl) return J({ error: "videoUrl required" }, 400);
      const tok = await accessToken();
      const vid = await fetch(videoUrl);
      if (!vid.ok) return J({ stage: "fetch-video", status: vid.status }, 502);
      const bytes = new Uint8Array(await vid.arrayBuffer());
      const size = bytes.length;
      const init = await tk("/post/publish/video/init/", tok, {
        post_info: { title: caption, privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
      });
      if (init.status !== 200 || (init.json?.error?.code && init.json.error.code !== "ok"))
        return J({ stage: "init", ...init.json }, init.status);
      const pubId = init.json?.data?.publish_id;
      const uploadUrl = init.json?.data?.upload_url;
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Range": `bytes 0-${size - 1}/${size}` },
        body: bytes,
      });
      if (![200, 201, 206].includes(put.status)) return J({ stage: "upload", status: put.status }, 502);
      // poll status a few times
      let last: unknown = null;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const st = await tk("/post/publish/status/fetch/", tok, { publish_id: pubId });
        last = st.json;
        const s = st.json?.data?.status;
        if (s === "PUBLISH_COMPLETE" || s === "FAILED") break;
      }
      return J({ publish_id: pubId, status: last });
    }

    return J({ error: "unknown action" }, 400);
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
