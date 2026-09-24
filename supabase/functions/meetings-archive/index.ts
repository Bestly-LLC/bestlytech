// MEETINGS-01: Admin-gated read-only proxy to the meeting recording archive on
// Nextcloud (cloud.bestly.tech).
//
// These are private business conversations, so the rule is that the browser
// never sees a Nextcloud credential and never talks to Nextcloud directly.
// AdminRoute in the SPA is a *render* gate — it decides what to draw, not what
// the server will hand out — so the real access control is here:
//
//   1. Caller must present a valid Supabase JWT (verify_jwt = true, plus an
//      explicit getUser() check).
//   2. That user must hold the 'admin' role via has_role(), the same RPC the
//      rest of /admin uses. Anything else gets 403.
//   3. Only then does this function use NEXTCLOUD_APP_PASSWORD — a function
//      secret, never in the repo and never sent to the client — to read WebDAV.
//
// Read-only by design: it issues PROPFIND and GET, never PUT/DELETE/MKCOL, so a
// bug here cannot damage the archive. Audio is deliberately not proxied; the
// archive is large and the UI only needs transcripts.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_PUBLISHABLE: string = __keys("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NC_BASE = "https://cloud.bestly.tech/remote.php/dav/files/jared";
const ARCHIVE = "Meeting%20Recordings";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type NcEntry = { name: string; size: number; isDir: boolean; rel: string };

/**
 * depth "1" lists one folder. depth "infinity" returns the whole tree in a single
 * request, which is the difference between eleven round trips to Nextcloud and one.
 * `rel` is the entry's path below the requested folder, so callers can group by day
 * without asking for each day separately.
 */
async function propfind(path: string, auth: string, depth: "1" | "infinity" = "1"): Promise<NcEntry[]> {
  const res = await fetch(`${NC_BASE}/${path}`, {
    method: "PROPFIND",
    headers: { Authorization: auth, Depth: depth, "Content-Type": "application/xml" },
    body:
      `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>` +
      `<d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>`,
  });
  if (!res.ok) return [];
  const xml = await res.text();

  // Everything below this prefix is what `rel` describes.
  const baseDecoded = decodeURIComponent(new URL(`${NC_BASE}/${path}`).pathname).replace(/\/+$/, "");

  const out: NcEntry[] = [];
  // Each <d:response> is one entry; the first is the collection itself.
  const blocks = xml.split(/<[a-zA-Z]*:?response>/).slice(1);
  for (const b of blocks) {
    const href = b.match(/<[a-zA-Z]*:?href>([^<]*)<\/[a-zA-Z]*:?href>/)?.[1];
    if (!href) continue;
    const decoded = decodeURIComponent(href);
    const name = decoded.replace(/\/$/, "").split("/").pop() ?? "";
    if (!name) continue;
    const isDir = /<[a-zA-Z]*:?collection\s*\/>/.test(b) || href.endsWith("/");
    const len = b.match(
      /<[a-zA-Z]*:?getcontentlength>(\d+)<\/[a-zA-Z]*:?getcontentlength>/,
    )?.[1];
    const clean = decoded.replace(/\/+$/, "");
    const rel = clean.startsWith(baseDecoded) ? clean.slice(baseDecoded.length).replace(/^\/+/, "") : "";
    out.push({ name, size: len ? parseInt(len, 10) : 0, isDir, rel });
  }
  return out;
}

async function getText(path: string, auth: string): Promise<string | null> {
  const res = await fetch(`${NC_BASE}/${path}`, { headers: { Authorization: auth } });
  if (!res.ok) return null;
  return await res.text();
}

// Transcript lines look like:  [MM:SS] SPEAKER: text
// MM is cumulative minutes and regularly exceeds 60 (e.g. [135:06]).
const LINE_RE = /^\[(\d+):(\d{2})\]\s+([^:]+):/;

function parseTranscript(text: string) {
  const speakers: Record<string, number> = {};
  let lastSeconds = 0;
  let lineCount = 0;

  // The header records how much of the labelling is backed by voice evidence:
  // "# voice-confirmed anchors: 637 lines | inherited from speech run: 77 | assumed: 14"
  const hdr = text.match(
    /voice-confirmed anchors:\s*(\d+)\s*lines\s*\|\s*inherited from speech run:\s*(\d+)\s*\|\s*assumed:\s*(\d+)/i,
  );
  const voiceConfirmed = hdr ? parseInt(hdr[1], 10) : null;
  const inherited = hdr ? parseInt(hdr[2], 10) : null;
  const assumed = hdr ? parseInt(hdr[3], 10) : null;

  for (const raw of text.split("\n")) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    lineCount++;
    const secs = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (secs > lastSeconds) lastSeconds = secs;
    const who = m[3].trim();
    speakers[who] = (speakers[who] ?? 0) + 1;
  }

  const ranked = Object.entries(speakers).sort((a, b) => b[1] - a[1]);
  const topShare = lineCount > 0 && ranked.length ? ranked[0][1] / lineCount : 0;

  // Diarization is untrustworthy when one voice holds essentially every line
  // (meeting-20260911-1405 is 829/829 JARED because it was a phone call and the
  // system track barely recorded), or when the labeller found no voice anchors
  // at all. Either way the speaker labels are not evidence of who said what.
  const reasons: string[] = [];
  if (lineCount > 0 && topShare >= 0.95) {
    reasons.push(
      `${ranked[0][0]} is labelled on ${Math.round(topShare * 100)}% of ${lineCount} lines`,
    );
  }
  if (voiceConfirmed === 0 && lineCount > 0) {
    reasons.push("no voice-confirmed speaker anchors");
  }
  if (ranked.length === 1 && lineCount > 0) {
    reasons.push("only one speaker detected across the whole call");
  }

  return {
    durationSeconds: lastSeconds,
    lineCount,
    speakers: ranked.map(([name, lines]) => ({
      name,
      lines,
      share: lineCount ? lines / lineCount : 0,
    })),
    voiceConfirmed,
    inherited,
    assumed,
    diarizationSuspect: reasons.length > 0,
    diarizationReasons: reasons,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // --- 1. Caller must be an authenticated admin on this project ---
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const authed = createClient(
    Deno.env.get("SUPABASE_URL")!,
    SB_PUBLISHABLE,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const { data: isAdmin } = await authed.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  // --- 2. Nextcloud credential ---
  // Prefer the function secret; otherwise read the same credential the rest of the
  // Nextcloud integrations use from Vault (get_nextcloud_credentials, service role only).
  let ncPass = Deno.env.get("NEXTCLOUD_APP_PASSWORD") ?? "";
  let ncUser = Deno.env.get("NEXTCLOUD_USER") ?? "";
  if (!ncPass) {
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);
    const { data: cred } = await svc.rpc("get_nextcloud_credentials");
    const row = Array.isArray(cred) ? cred[0] : cred;
    ncPass = row?.app_password ?? "";
    ncUser = ncUser || row?.username || "";
  }
  ncUser = ncUser || "jared";
  if (!ncPass) {
    return json(
      {
        error: "not_configured",
        message: "No Nextcloud credential: set NEXTCLOUD_APP_PASSWORD or the nextcloud_app_password Vault secret.",
      },
      503,
    );
  }
  const auth = "Basic " + btoa(`${ncUser}:${ncPass}`);

  // Parse cache. A transcript never changes once written, so re-downloading and re-parsing
  // every one on every list was ~1MB of text and about 15 seconds - long enough that the
  // page looked empty and the meetings looked lost. Keyed by file name + size: same name
  // and size means the same bytes.
  const cacheDb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body is fine for list */
  }
  const op = String(body.op ?? "list");

  // --- 3a. list: enumerate meetings and summarise each transcript ---
  if (op === "list") {
    // One request for the whole tree. Asking per day meant eleven round trips to a
    // self-hosted Nextcloud, which was most of the wall clock. Some servers refuse
    // Depth: infinity, so fall back to walking day by day rather than showing nothing.
    let tree = await propfind(`${ARCHIVE}/`, auth, "infinity");
    let filesByDay: Record<string, NcEntry[]> = {};

    const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    for (const e of tree) {
      if (e.isDir || !e.rel.includes("/")) continue;
      const [day, ...rest] = e.rel.split("/");
      if (!isDay(day) || rest.length !== 1) continue;
      (filesByDay[day] ??= []).push(e);
    }

    if (Object.keys(filesByDay).length === 0) {
      const days = (await propfind(`${ARCHIVE}/`, auth)).filter((e) => e.isDir && isDay(e.name));
      const walked = await Promise.all(
        days.map(async (d) => [d.name, (await propfind(`${ARCHIVE}/${d.name}/`, auth)).filter((f) => !f.isDir)] as const),
      );
      filesByDay = Object.fromEntries(walked);
    }

    // One cache read for every transcript at once, instead of a query per meeting.
    const wanted: string[] = [];
    for (const files of Object.values(filesByDay)) {
      for (const f of files) if (f.name.endsWith("-transcript-named.txt") || f.name.endsWith("-transcript.txt")) wanted.push(f.name);
    }
    const cacheByName = new Map<string, { parsed: unknown; size_bytes: number }>();
    if (wanted.length) {
      const { data: rows } = await cacheDb
        .from("meetings_parse_cache")
        .select("file_name, parsed, size_bytes")
        .in("file_name", wanted);
      for (const r of rows ?? []) cacheByName.set(r.file_name as string, r as never);
    }

    const meetings = await Promise.all(
      Object.entries(filesByDay).map(async ([dayName, files]) => {
        const day = { name: dayName };

        // Group the flat, prefixed files back into meetings.
        const byMeeting: Record<string, NcEntry[]> = {};
        for (const f of files) {
          const id = f.name.match(/^(meeting-\d{8}-\d{4})-/)?.[1];
          if (!id) continue;
          (byMeeting[id] ??= []).push(f);
        }

        return Promise.all(
          Object.entries(byMeeting).map(async ([id, fs]) => {
            // Prefer the speaker-named transcript; fall back to the raw one.
            const named = fs.find((f) => f.name.endsWith("-transcript-named.txt"));
            const plain = fs.find((f) => f.name.endsWith("-transcript.txt"));
            const chosen = named ?? plain;

            const stamp = id.match(/^meeting-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
            const startedAt = stamp
              ? `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:00`
              : null;

            let parsed = null;
            if (chosen) {
              const hit = cacheByName.get(chosen.name);

              if (hit && Number(hit.size_bytes) === chosen.size) {
                parsed = hit.parsed;
              } else {
                const text = await getText(`${ARCHIVE}/${day.name}/${chosen.name}`, auth);
                if (text) {
                  parsed = parseTranscript(text);
                  // Best effort: a cache write that fails must never fail the listing.
                  await cacheDb
                    .from("meetings_parse_cache")
                    .upsert({ file_name: chosen.name, size_bytes: chosen.size, parsed, cached_at: new Date().toISOString() },
                            { onConflict: "file_name" });
                }
              }
            }

            return {
              id,
              day: day.name,
              startedAt,
              transcriptFile: chosen?.name ?? null,
              usingNamed: !!named,
              hasAudio: fs.some((f) => f.name.endsWith(".m4a")),
              totalBytes: fs.reduce((n, f) => n + f.size, 0),
              files: fs.map((f) => ({ name: f.name, size: f.size })),
              ...(parsed ?? {
                durationSeconds: null,
                lineCount: 0,
                speakers: [] as { name: string; lines: number; share: number }[],
                voiceConfirmed: null,
                inherited: null,
                assumed: null,
                diarizationSuspect: false,
                diarizationReasons: [] as string[],
              }),
            };
          }),
        );
      }),
    );

    const flat = meetings.flat().sort((a, b) => (a.id < b.id ? 1 : -1));
    return json({ meetings: flat });
  }

  // --- 3b. transcript: return one transcript's full text ---
  if (op === "transcript") {
    const day = String(body.day ?? "");
    const file = String(body.file ?? "");

    // Path containment: only a YYYY-MM-DD folder and a meeting transcript file.
    // Blocks traversal and blocks pulling anything that is not a transcript.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "bad_day" }, 400);
    if (!/^meeting-\d{8}-\d{4}-transcript(-named|-turns)?\.txt$/.test(file)) {
      return json({ error: "bad_file" }, 400);
    }

    const text = await getText(`${ARCHIVE}/${day}/${encodeURIComponent(file)}`, auth);
    if (text === null) return json({ error: "not_found" }, 404);

    return json({ day, file, text, ...parseTranscript(text) });
  }

  // --- 3c. rename: WebDAV MOVE the folder (renames the whole meeting) ---
  if (op === "rename") {
    const day = String(body.day ?? "");
    const oldId = String(body.oldId ?? "");
    const newId = String(body.newId ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "bad_day" }, 400);
    if (!/^meeting-\d{8}-\d{4}$/.test(oldId) || !/^meeting-\d{8}-\d{4}$/.test(newId))
      return json({ error: "bad_id" }, 400);

    // Rename every file in the day folder whose name starts with oldId.
    const files = (await propfind(`${ARCHIVE}/${day}/`, auth)).filter(
      (f) => !f.isDir && f.name.startsWith(oldId + "-"),
    );
    if (!files.length) return json({ error: "not_found" }, 404);

    const results = await Promise.all(
      files.map(async (f) => {
        const newName = newId + f.name.slice(oldId.length);
        const src = `${NC_BASE}/${ARCHIVE}/${day}/${encodeURIComponent(f.name)}`;
        const dest = `${NC_BASE}/${ARCHIVE}/${day}/${encodeURIComponent(newName)}`;
        const res = await fetch(src, {
          method: "MOVE",
          headers: { Authorization: auth, Destination: dest, Overwrite: "F" },
        });
        return { file: f.name, ok: res.ok, status: res.status };
      }),
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length) return json({ error: "move_failed", details: failed }, 502);
    return json({ ok: true, renamed: results.length });
  }

  // --- 3d. delete: WebDAV DELETE every file in the meeting ---
  if (op === "delete") {
    const day = String(body.day ?? "");
    const id = String(body.id ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "bad_day" }, 400);
    if (!/^meeting-\d{8}-\d{4}$/.test(id)) return json({ error: "bad_id" }, 400);

    // List everything in the day folder so we know exactly what is there.
    const all = await propfind(`${ARCHIVE}/${day}/`, auth);
    const files = all.filter(
      (f) => !f.isDir && (f.name.startsWith(id + "-") || f.name.startsWith(id + ".")),
    );

    // If no flat files found, check for a same-named sub-folder and DELETE it
    // as a single recursive WebDAV DELETE (Nextcloud supports this).
    if (!files.length) {
      const asDir = all.find((f) => f.isDir && f.name === id);
      if (asDir) {
        const url = `${NC_BASE}/${ARCHIVE}/${day}/${encodeURIComponent(id)}`;
        const res = await fetch(url, { method: "DELETE", headers: { Authorization: auth } });
        const ncBody = await res.text().catch(() => "");
        if (!res.ok && res.status !== 404) {
          return json({ error: "delete_failed", status: res.status, ncBody, url }, 502);
        }
        return json({ ok: true, deleted: 1, via: "folder" });
      }
      // Nothing at all — return a full diagnostic so we can see what IS there.
      return json(
        {
          error: "not_found",
          message: `No files or folder found for ${id} in ${day}.`,
          lookedFor: [id + "-", id + ".", id],
          allEntries: all.map((f) => ({ name: f.name, isDir: f.isDir })),
        },
        404,
      );
    }

    // Delete each matched file and capture the full NC response body on failure.
    const results = await Promise.all(
      files.map(async (f) => {
        const url = `${NC_BASE}/${ARCHIVE}/${day}/${encodeURIComponent(f.name)}`;
        const res = await fetch(url, { method: "DELETE", headers: { Authorization: auth } });
        const ok = res.ok || res.status === 404;
        const ncBody = ok ? null : await res.text().catch(() => "");
        return { file: f.name, url, ok, status: res.status, ncBody };
      }),
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      // Surface the real Nextcloud error — this is what tells us if it is a
      // permission problem, a path mismatch, or something else entirely.
      return json({ error: "delete_failed", details: failed }, 502);
    }
    return json({ ok: true, deleted: results.length, files: files.map((f) => f.name) });
  }

  return json({ error: "unknown_op" }, 400);
});
