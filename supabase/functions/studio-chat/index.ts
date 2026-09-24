// studio-chat — the thing on the other end of the Ask pill.
//
// A question is answered in seconds, a content change is made on the spot,
// and only an actual code change becomes a build.
//
// Three rules shape the whole design:
//
//  1. It can never do more than the person typing can. Every write goes through
//     the same token-guarded RPC the UI calls, with THEIR staff token — not the
//     service role. can_promote, the claim gate and the stage trigger all still
//     apply, unchanged.
//  2. Anything a client would see needs a yes first. Those tools carry an
//     explicit `confirmed` flag the model may only set after the person agreed
//     in this thread.
//  3. Every tool run is written to studio_chat_actions. The question six weeks
//     from now is "why did this caption change?", and it deserves an answer.
//
// v15 (2026-09-23): prompt caching. The system prompt is now [fixed rules][memory
// index][live data]; tools + fixed rules and the memory index carry cache
// breakpoints, and a top-level cache_control caches the conversation inside the
// tool loop. Cache token counts are logged per call.
// v14 (2026-09-22): recall / remember — every chat reads and writes the shared
// memory (bestly_memory); secrets stay in Vault.
// v13 (Spark, 2026-09-22), after "it needs to be able to do more, like change
// the UI of the app itself — and it says Failed":
//  * app_find / app_read: Spark can read the live Studio and client-board source,
//    so it can explain how a screen works and hand the builder a brief that names
//    the real function and the real line, not a guess.
//  * app_status: what is live, what the builder did lately and why a thread
//    failed — answered from the tables, not from memory.
//  * handoff: "needs a person" (render carousel images, a template, an
//    integration) is recorded as its own status, not as a failure.
//  * A reply in a Failed / Declined / Shipped thread reopens it as a chat, so the
//    badge stops saying Failed while the conversation carries on.
//  * The copy of the builder key that lived here is gone; the model-list debug
//    door is behind a staff token with can_promote instead.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MODEL = Deno.env.get("STUDIO_CHAT_MODEL") ?? "claude-sonnet-4-6";
const MAX_TURNS = 10;
const SB = Deno.env.get("SUPABASE_URL")!;

const db = createClient(SB, SB_SECRET, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

// People paste a whole curl example into the secret box; take the key out of it.
function cleanKey(raw: string | undefined): string {
  if (!raw) return "";
  const m = raw.match(/sk-ant-[A-Za-z0-9_\-]{20,}/);
  return (m ? m[0] : raw).trim();
}

// ── the live app source, read on demand ───────────────────────────────────
// Studio and the client board are one HTML file each; studio_boot() says which
// content-hashed file is live. Read once per request, only if a tool needs it.
const SRC: Record<string, string[]> = {};
async function appLines(file: "studio" | "board"): Promise<string[]> {
  if (SRC[file]) return SRC[file];
  const { data } = await db.rpc("studio_boot", { p_file: file === "board" ? "board.html" : "index.html", p_preview: null });
  const path = (data as any)?.path;
  if (!path) throw new Error("no live build recorded");
  const r = await fetch(`${SB}/storage/v1/object/public/review/${path}`);
  if (!r.ok) throw new Error(`storage ${r.status}`);
  SRC[file] = (await r.text()).split("\n");
  return SRC[file];
}

// ── tools ─────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "look",
    description:
      "Read detail the snapshot in your context does not carry. Never guess at an id or a caption. " +
      "'post' = ONE post in full: the whole caption, per-platform variants, slide count, decisions so far. Use this before rewriting anything. " +
      "'queue' = every post for a client with its stage, status, media type and version. 'asks' = recording requests and what has come back. " +
      "'clients' = every client, their open counts and board links. 'brand' = the client's guide answers, voice memo and proposed claim rules.",
    input_schema: {
      type: "object",
      properties: {
        what: { type: "string", enum: ["post", "queue", "asks", "clients", "brand"] },
        item_id: { type: "string", description: "Required for 'post'." },
        client_slug: { type: "string", description: "Defaults to the client the person is looking at." },
      },
      required: ["what"],
    },
  },
  {
    name: "app_find",
    description:
      "Search the LIVE source of the app. file 'studio' = the staff app (studio.bestly.tech, one HTML file: CSS in <style>, markup, then one big script); " +
      "'board' = the client board (studio.bestly.tech/<client>). Returns up to 25 matching lines with line numbers and a little context. " +
      "Use it to answer how a screen behaves, and ALWAYS before queue_build, so the builder brief names real functions, ids and CSS classes. " +
      "pattern is a case-insensitive regular expression (escape regex characters you mean literally).",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", enum: ["studio", "board"] },
        pattern: { type: "string" },
        context: { type: "number", description: "Lines of context each side, 0–6. Default 2." },
      },
      required: ["file", "pattern"],
    },
  },
  {
    name: "app_read",
    description: "Read a range of lines from the live app source (max 160 lines per call). Use after app_find to read a whole function.",
    input_schema: {
      type: "object",
      properties: { file: { type: "string", enum: ["studio", "board"] }, from: { type: "number" }, to: { type: "number" } },
      required: ["file", "from", "to"],
    },
  },
  {
    name: "app_status",
    description:
      "What is live and what the builder has done: the live build (when, what the last changes were), whether shipping is instant, " +
      "and the latest build requests with their status and last word. Use it for 'why did that fail', 'what shipped today', 'is my change live'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "recall",
    description:
      "Search the studio's shared memory (bestly_memory) — the notes every Bestly chat reads and writes: house rules, how things are shipped, client facts, decisions, open items. " +
      "Use it before answering anything about how the studio works, what was decided, or what a client said outside the app, and before saying you do not know. " +
      "query is a few words (all must match); area narrows it (house, studio, ship, security, client, render, …). The memory index in your context lists what exists.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, area: { type: "string" }, limit: { type: "number" } },
    },
  },
  {
    name: "remember",
    description:
      "Save something durable to the shared memory so every future chat knows it: a decision, a standing preference, a client fact, a lesson, where something lives. " +
      "Use it whenever the person tells you something that should outlive this conversation, or says 'remember'. Same area+key replaces the note (the old text is kept in history), so read it with recall first and write the whole updated note. " +
      "Never a secret — no passwords, keys or tokens (the database refuses them). For a secret, say it belongs in Supabase Vault and record only WHERE it lives. Not for today's chatter or anything that will be stale by next week.",
    input_schema: {
      type: "object",
      properties: {
        area: { type: "string", description: "house | studio | ship | security | client | render | … (lowercase-hyphen)" },
        key: { type: "string", description: "short lowercase-hyphen slug, stable for the subject" },
        title: { type: "string" },
        body: { type: "string", description: "The whole note, plain and specific, with dates." },
        client_slug: { type: "string" },
      },
      required: ["area", "key", "title", "body"],
    },
  },
  {
    name: "edit_post",
    description:
      "Rewrite the title and/or caption of an INTERNAL post. Reversible and versioned — if the client has already seen the post this re-shows it to her. " +
      "Never use this on a post that is already with the client. Pass the full new text, not a diff.",
    input_schema: {
      type: "object",
      properties: { item_id: { type: "string" }, title: { type: "string" }, caption: { type: "string" } },
      required: ["item_id"],
    },
  },
  {
    name: "check_claims",
    description:
      "Run proposed copy through the claim gate before writing it anywhere. Always do this before edit_post when you wrote the words yourself. " +
      "Returns ok:false with a reason for a hard block, or a soft note worth mentioning.",
    input_schema: { type: "object", properties: { client_slug: { type: "string" }, text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "decide_post",
    description:
      "Record the INTERNAL verdict on a post: approved, changes or killed. This is Jared's or Eli's own decision — only do it when they plainly ask for it. Requires confirmed:true.",
    input_schema: {
      type: "object",
      properties: {
        item_id: { type: "string" },
        decision: { type: "string", enum: ["approved", "changes", "killed"] },
        note: { type: "string", description: "Internal note. The client never sees it." },
        confirmed: { type: "boolean", description: "Only true once the person has said yes in this conversation." },
      },
      required: ["item_id", "decision", "confirmed"],
    },
  },
  {
    name: "send_to_client",
    description: "Promote an internally-approved post to the client's board. The client sees it immediately. Requires confirmed:true and a yes in this conversation.",
    input_schema: { type: "object", properties: { item_id: { type: "string" }, confirmed: { type: "boolean" } }, required: ["item_id", "confirmed"] },
  },
  {
    name: "draft_ask",
    description:
      "Create a recording request as a DRAFT — the client does not see it until it is sent. Safe to do without asking. " +
      "script is what they SAY, as plain paragraphs: a string with a blank line between breaths, or a list of {say, on_screen?}. " +
      "No timecodes, no beat numbers, no shot notes — it is read off a phone by the person recording it.",
    input_schema: {
      type: "object",
      properties: {
        client_slug: { type: "string" }, title: { type: "string" },
        brief: { type: "string", description: "One or two sentences on why, in her language." },
        target_seconds: { type: "number" },
        script: { anyOf: [{ type: "string" }, { type: "array", items: { type: "object" } }] },
        item_id: { type: "string", description: "Link it to an existing post, if this ask is for one." },
      },
      required: ["title"],
    },
  },
  {
    name: "send_ask",
    description: "Send a drafted ask to the client. She sees it on her board immediately. Requires confirmed:true.",
    input_schema: { type: "object", properties: { ask_id: { type: "string" }, confirmed: { type: "boolean" } }, required: ["ask_id", "confirmed"] },
  },
  {
    name: "create_post",
    description:
      "Make a new post for the client. It lands in Drafts › To review as an internal draft; nobody outside the studio sees it until a person approves and sends it. " +
      "slides are words, not pictures: [{kicker?, headline, body?}] — one object per slide, drawn live in the client's colours for review (the PNGs are rendered after approval). " +
      "A slide may instead be {url} for a picture that already exists. Run check_claims on the whole text first. Never invent statistics, credentials or outcomes.",
    input_schema: {
      type: "object",
      properties: {
        client_slug: { type: "string" },
        title: { type: "string", description: "Working title, internal." },
        caption: { type: "string", description: "The caption as it would post. Hashtags on the last line are fine." },
        platform: { type: "string", enum: ["instagram", "tiktok"] },
        slides: { type: "array", items: { type: "object" }, description: "[{kicker, headline, body}] or [{url}]" },
        variants: { type: "object", description: "Optional per-platform captions: {instagram:{caption,hashtags[]}, tiktok:{...}}" },
        scheduled_for: { type: "string", description: "YYYY-MM-DD, optional." },
      },
      required: ["title", "slides"],
    },
  },
  {
    name: "write_brief",
    description:
      "Write a build brief for Jared to take somewhere else, instead of queueing it here. " +
      "Use this when he says 'write me a prompt', 'give me a brief', 'I'll take this to Claude', 'don't build it, just spec it'. " +
      "Do not call queue_build as well. The brief goes into the thread as a block he can copy in one tap.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Six words or fewer, what the change is." },
        brief: { type: "string", description:
          "The whole instruction, self-contained, for someone with no memory of this conversation. State the problem before the fix. " +
          "Name the file (Studio = the live index.html; client board = board.html), the function, the CSS class and the RPC — found with app_find, never invented. " +
          "Say what it should do, what it must not break, and how to tell it worked." },
      },
      required: ["title", "brief"],
    },
  },
  {
    name: "queue_build",
    description:
      "Hand this thread to the builder because it needs a CHANGE TO THE APP'S CODE — anything in the Studio or client-board UI: layout, buttons, styles, text on screen, a new panel or feature, a bug. " +
      "The builder edits the live HTML, and within about 20 minutes a preview opens right inside Studio (studio.bestly.tech/?preview=…); a person taps Ship and it is live on the next reload. " +
      "It cannot render images, change the database, send anything, or edit other systems — use handoff for those. " +
      "Find the code with app_find first and put the real function names and line numbers in the summary.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "A precise, self-contained instruction for the builder: problem, the change, where (functions / classes / lines from app_find), what must not break, how to check it." },
      },
      required: ["summary"],
    },
  },
  {
    name: "handoff",
    description:
      "Record a job that needs a person or a full Cowork session rather than you or the builder: re-rendering carousel or video images, " +
      "changing a render template, database or pipeline changes, new integrations, anything touching credentials. " +
      "The thread is marked 'Needs a person' (not Failed) with your brief, so it is picked up rather than lost. Say plainly that it is waiting on a person.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Six words or fewer." },
        brief: { type: "string", description: "Self-contained: what is wanted, which posts/clients/templates (ids), and what 'done' looks like." },
      },
      required: ["title", "brief"],
    },
  },
];

// The system prompt is three blocks, most stable first, so prompt caching can
// reuse them: [fixed rules — never changes] [memory index — changes when a note
// is added] [live data — changes every request]. Only the last is uncached.
const SYSTEM_FIXED = `
You are Spark, the assistant inside Bestly Studio, the internal content-review app Jared Best runs for his clients. Your name is Spark; use it if asked who you are, and never call yourself anything else. Who you are talking to, where they are and what is in the app right now are in the live section at the end of these instructions.

# What this app is
Bestly makes social content for clients. Work flows through two tiers:
- **internal** — drafts only Jared and Eli can see (internal_status: pending / approved / changes / killed)
- **client** — what the client reviews on her own board (status: pending / approved / changes)
A post only reaches a client when a staff member promotes it, and only after it is internally approved. Clients also get **asks**: a script to record a video on their phone, which lands back in the app transcoded and ready to attach.
A **claim gate** in the database blocks unsupportable claims ("clinically proven", "FDA approved") and, for health clients, demands a crisis resource in copy that needs one. It is not advisory — it refuses the write.
The app itself is two HTML files served from studio_builds: the staff Studio and the client board. You can read both with app_find / app_read.

# Reading the live section
"Where the person is right now": when they say "this post" or "her", they mean whatever is in that context unless they name something else.
"What is in the app right now" was read a moment ago. Answer from it directly — do not call \`look\` to re-read what is already there.
"contact" is the human behind a client: if they say a first name, that is who they mean.
"client_feedback" is every decision the client has made, newest first, with her own words in "note"; each queue row also carries "client_said". Quote her words, never paraphrase them into something she did not say, and say how many decisions the answer rests on.

# The studio's memory
Every Bestly chat — you, the builder, and Jared's Cowork sessions — shares one memory: bestly_memory. The notes that exist right now are listed (area/key — title) just before the live section.
Read before you answer from habit: \`recall\` the relevant note when a question touches how the studio works, a decision, a client, or anything you are unsure of. Write when it matters: when the person tells you something durable (a decision, a preference, a client fact, a lesson, where something lives), or says "remember", \`remember\` it and say so in a few words. Secrets never go in memory — passwords, keys and tokens belong in Supabase Vault; record only where they live, and never ask anyone to paste one into chat.

# Six jobs, told apart by what they ask for
1. **Make content** — "write a carousel about…": read \`look\` what:"brand" once, write the slides as words (kicker / headline / body, one idea per slide, the last slide a soft close), write the caption, \`check_claims\`, then \`create_post\`. Say what you made in one line and where it is.
2. **Change content** — a caption, a title, hashtags, a variant: read it whole, rewrite, \`check_claims\` if it makes any claim, \`edit_post\`, report the change.
3. **Change the app** — anything about how Studio or the client board looks or behaves: buttons, layout, colours, sizes, text on screen, a new panel, a bug. First \`app_find\` the code, then \`queue_build\` with a brief that names the real functions, classes and line numbers. Tell them it is with the builder and a preview opens inside Studio in about 20 minutes. If he wants the words instead of the work, \`write_brief\`.
4. **Her feedback** — answer from client_feedback / client_said, in her words.
5. **Explain / status** — "how does X work", "why did that fail", "is it live": read the code with app_find / app_read, or \`app_status\`, and answer plainly.
6. **Remember** — "remember that…", "from now on…", a decision or fact worth keeping: \`remember\` it.
Jobs neither you nor the builder can do — rendering new slide or video images, changing a carousel or video template, database or pipeline changes, integrations, credentials — go to \`handoff\` with a clear brief. Never tell someone a builder will do what it cannot, and never call it a failure: it is waiting on a person.
If a request mixes jobs ("she hated the hook, fix it"), do the content job and cite the feedback that drove it. Making a post is never a build.

# How to behave
- **Do the thing.** If they ask for a caption change, read the post, rewrite it, make the edit. Do not describe how they could. Report what you changed in one line.
- **Ask at most one question**, and only when you genuinely cannot proceed. Otherwise pick the sensible reading and say which you picked.
- **Confirm before the client sees anything.** send_to_client, send_ask and decide_post need an explicit yes in this conversation first. Never set confirmed:true on the strength of your own suggestion.
- **Never invent** a metric, a date, a credential, a claim, a file or a function name. If you do not know, look (app_find, look, app_status, recall) or say so.
- **Never write in a client's voice without their material.** Copy you write is a draft for a human to approve.
- If a tool fails, say what failed and what would fix it. A clear no beats a vague yes.

# Voice
Plain, short, specific. Plain text only — the chat renders no markdown: no asterisks, headings or bullet symbols; a list is one line per item. No preamble, no restating the question. Aim for under 60 words. Lead with the answer or what you did.
`.trim();

const SYSTEM_MEMORY = (memIndex: string) => `
# Memory notes that exist right now (area/key — title)
${memIndex}
`.trim();

const SYSTEM_LIVE = (ctx: Record<string, unknown>, staff: Record<string, unknown>, snap: unknown) => `
# Live section
You are talking to ${staff.name}, a member of staff${staff.can_promote ? "" : " who cannot promote posts to clients"}.

# Where the person is right now
${JSON.stringify(ctx)}

# What is in the app right now
${JSON.stringify(snap)}
`.trim();

// ── tool execution ────────────────────────────────────────────────────────
async function runTool(
  name: string, args: Record<string, any>, token: string, ctx: Record<string, any>, requestId: string, staffId: string,
): Promise<Record<string, unknown>> {
  const slug = args.client_slug || ctx.client || null;
  const rpc = async (fn: string, body: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, body);
    if (error) return { ok: false, error: error.message };
    return data as Record<string, unknown>;
  };
  let out: Record<string, unknown>;

  try {
  switch (name) {
    case "look": {
      if (args.what === "clients") out = await rpc("studio_clients", { p_token: token });
      else if (args.what === "asks") out = await rpc("studio_asks", { p_token: token, p_client_slug: slug });
      else if (args.what === "brand") out = await rpc("studio_brand", { p_token: token, p_client_slug: slug });
      else {
        const b = await rpc("studio_board", { p_token: token, p_client_slug: slug });
        const all = ((b as any)?.items ?? []) as any[];
        if (args.what === "post") {
          const i = all.find((x: any) => x.id === args.item_id || String(x.id).startsWith(String(args.item_id ?? "")));
          out = i
            ? { ok: true, post: {
                id: i.id, title: i.title, caption: i.caption ?? null, stage: i.stage,
                internal_status: i.internal_status, status: i.status, media_type: i.media_type,
                version: i.content_version, slides: Array.isArray(i.slides) ? i.slides.length : 0,
                variants: i.variants ?? null, reviews: i.reviews ?? null, provenance: i.provenance ?? null } }
            : { ok: false, error: "no post with that id for this client" };
        } else {
          out = { ok: (b as any)?.ok !== false, items: all.map((i: any) => ({
            id: i.id, title: i.title, stage: i.stage, internal_status: i.internal_status, status: i.status,
            media_type: i.media_type, client_slug: i.client_slug, version: i.content_version,
            caption_opens: typeof i.caption === "string" ? i.caption.slice(0, 120) : null,
            caption_chars: typeof i.caption === "string" ? i.caption.length : 0,
            slides: Array.isArray(i.slides) ? i.slides.length : 0, has_media: !!i.media_url,
          })) };
        }
      }
      break;
    }
    case "app_find": {
      const lines = await appLines(args.file === "board" ? "board" : "studio");
      let re: RegExp;
      try { re = new RegExp(String(args.pattern), "i"); } catch (e) { out = { ok: false, error: `bad pattern: ${(e as Error).message}` }; break; }
      const c = Math.max(0, Math.min(6, Number(args.context ?? 2)));
      const hits: string[] = []; let n = 0;
      for (let i = 0; i < lines.length && hits.length < 25; i++) {
        if (!re.test(lines[i])) continue;
        n++;
        const a = Math.max(0, i - c), b = Math.min(lines.length - 1, i + c);
        hits.push(lines.slice(a, b + 1).map((t, k) => `${a + k + 1}${a + k === i ? ">" : ":"} ${t.slice(0, 240)}`).join("\n"));
      }
      out = { ok: true, file: args.file, total_lines: lines.length, matches: hits.length, hits: hits.join("\n--\n") || "no matches" };
      break;
    }
    case "app_read": {
      const lines = await appLines(args.file === "board" ? "board" : "studio");
      const from = Math.max(1, Math.floor(Number(args.from) || 1));
      const to = Math.min(lines.length, Math.max(from, Math.min(from + 159, Math.floor(Number(args.to) || from + 40))));
      out = { ok: true, file: args.file, from, to, total_lines: lines.length,
              text: lines.slice(from - 1, to).map((t, k) => `${from + k}: ${t.slice(0, 300)}`).join("\n") };
      break;
    }
    case "app_status": {
      const { data: live } = await db.from("studio_builds").select("id,created_at,note,parts,files").eq("status", "live").order("created_at", { ascending: false }).limit(1).maybeSingle();
      const patches = Object.entries((live as any)?.parts ?? {}).filter(([k]) => /^patch\d+$/.test(k))
        .map(([k, v]: [string, any]) => `${k}: ${String(v?.recipe ?? "").slice(0, 160)}`);
      const { data: reqs } = await db.from("studio_requests").select("id,title,status,updated_at,preview_url")
        .eq("kind", "build").order("updated_at", { ascending: false }).limit(6);
      const recent = [];
      for (const r of reqs ?? []) {
        const { data: m } = await db.from("studio_request_messages").select("body").eq("request_id", r.id).eq("role", "claude")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        recent.push({ ...r, last_word: String(m?.body ?? "").slice(0, 400) });
      }
      out = { ok: true, live: live ? { id: live.id, since: live.created_at, note: live.note, last_changes: patches.slice(-5),
                instant_ship: !!(live as any).files?.["_loader/index.html"] } : null, recent_builds: recent };
      break;
    }
    case "recall":
      out = await rpc("studio_memory_recall", { p_token: token, p_query: args.query ?? null, p_area: args.area ?? null, p_limit: args.limit ?? 12 });
      break;
    case "remember":
      out = await rpc("studio_memory_remember", { p_token: token, p_area: String(args.area ?? "").toLowerCase(), p_key: String(args.key ?? "").toLowerCase(),
        p_title: args.title ?? null, p_body: args.body ?? "", p_client_slug: args.client_slug ?? null, p_by: null });
      break;
    case "check_claims": {
      const { data, error } = await db.rpc("claim_check", { _client_slug: slug, _text: args.text, _context: "studio-chat" });
      out = error ? { ok: false, error: error.message } : (data as Record<string, unknown>);
      break;
    }
    case "edit_post":
      out = await rpc("studio_item_edit", { p_token: token, p_item: args.item_id, p_title: args.title ?? null, p_caption: args.caption ?? null });
      break;
    case "decide_post":
      if (!args.confirmed) { out = { ok: false, error: "not_confirmed", hint: "Ask them first, then call again." }; break; }
      out = await rpc("studio_decide", { p_token: token, p_item: args.item_id, p_decision: args.decision, p_note: args.note ?? null });
      break;
    case "send_to_client":
      if (!args.confirmed) { out = { ok: false, error: "not_confirmed", hint: "Ask them first, then call again." }; break; }
      out = await rpc("studio_promote", { p_token: token, p_item: args.item_id });
      break;
    case "draft_ask": {
      const strip = (t: unknown) => String(t ?? "").replace(/^\s*\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\s*:?\s*/, "").trim();
      const script = typeof args.script === "string"
        ? args.script.replace(/\r/g, "").split(/\n\s*\n/).map((p: string) => strip(p.replace(/\n+/g, " "))).filter(Boolean).map((say: string) => ({ say, beat: "", on_screen: "" }))
        : Array.isArray(args.script)
          ? args.script.map((b: any) => ({ say: strip(b.say ?? b.says ?? b.text ?? ""), beat: "", on_screen: String(b.on_screen ?? "").trim() })).filter((b: any) => b.say)
          : null;
      const payload: Record<string, unknown> = { title: args.title, brief: args.brief ?? null, target_seconds: args.target_seconds ?? null, script };
      if (args.item_id) payload.item_id = args.item_id;
      out = await rpc("studio_ask_create", { p_token: token, p_client_slug: slug, p_payload: payload });
      break;
    }
    case "send_ask":
      if (!args.confirmed) { out = { ok: false, error: "not_confirmed", hint: "Ask them first, then call again." }; break; }
      out = await rpc("studio_ask_send", { p_token: token, p_ask: args.ask_id });
      break;
    case "create_post": {
      const slides = (Array.isArray(args.slides) ? args.slides : []).map((x: any) =>
        typeof x === "string" ? x : x?.url ? { url: String(x.url) }
          : { kicker: String(x?.kicker ?? "").trim(), headline: String(x?.headline ?? x?.title ?? x?.text ?? "").trim(), body: String(x?.body ?? "").trim() })
        .filter((x: any) => typeof x === "string" || x.url || x.headline || x.body);
      out = await rpc("studio_item_create", { p_token: token, p_client_slug: slug, p_payload: {
        title: args.title, caption: args.caption ?? "", platform: args.platform ?? "instagram", slides,
        variants: args.variants ?? null, scheduled_for: args.scheduled_for ?? null, made_in: "spark",
      } });
      break;
    }
    case "write_brief": {
      await db.from("studio_request_messages").insert({ request_id: requestId, role: "claude", staff_id: staffId, body: `[brief] ${args.title}\n\n${args.brief}` });
      out = { ok: true, written: true, title: args.title };
      break;
    }
    case "queue_build": {
      await db.from("studio_requests").update({
        kind: "build", status: "open", preview_url: null, title: String(args.summary).slice(0, 70), updated_at: new Date().toISOString(),
      }).eq("id", requestId);
      await db.from("studio_request_messages").insert({ request_id: requestId, role: "staff", staff_id: staffId, body: `[for the builder] ${args.summary}` });
      out = { ok: true, queued: true, eta: "about 20 minutes; the preview opens inside Studio" };
      break;
    }
    case "handoff": {
      await db.from("studio_requests").update({
        kind: "build", status: "handoff", title: String(args.title).slice(0, 70), updated_at: new Date().toISOString(),
      }).eq("id", requestId);
      await db.from("studio_request_messages").insert({ request_id: requestId, role: "claude", staff_id: staffId, body: `[needs a person] ${args.title}\n\n${args.brief}` });
      out = { ok: true, handed_off: true };
      break;
    }
    default:
      out = { ok: false, error: `unknown tool ${name}` };
  }
  } catch (e) {
    out = { ok: false, error: (e as Error).message };
  }

  // the source reads are big and say nothing about what changed; log that they happened, not the text
  const logged = name === "app_find" || name === "app_read" ? { ok: (out as any).ok, matches: (out as any).matches, from: (out as any).from, to: (out as any).to } : out;
  await db.from("studio_chat_actions").insert({ request_id: requestId, staff_id: staffId, tool: name, args, result: logged, ok: (out as any)?.ok !== false });
  return out;
}

// ── the loop ──────────────────────────────────────────────────────────────
async function ask(messages: any[], system: any[], apiKey: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    // top-level cache_control caches the conversation so far, so each tool-loop turn re-reads it cheaply
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, cache_control: { type: "ephemeral" }, system, tools: TOOLS, messages }),
  });
  const j = await r.json();
  if (!r.ok) {
    const why = String(j?.error?.message ?? JSON.stringify(j)).slice(0, 300).replace(/sk-ant-[A-Za-z0-9_\-]+/g, "sk-ant-…");
    throw new Error(`anthropic ${r.status}: ${why}`);
  }
  const u = j?.usage ?? {};
  console.log(JSON.stringify({ cache: { wrote: u.cache_creation_input_tokens ?? 0, read: u.cache_read_input_tokens ?? 0, plain: u.input_tokens ?? 0 } }));
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }

  const apiKey = cleanKey(Deno.env.get("ANTHROPIC_API_KEY"));
  const token = String(body.staff_token ?? "");
  if (!token) return J({ ok: false, error: "staff_token required" }, 400);
  const { data: s, error: se } = await db.rpc("studio_resolve_staff", { p_token: token });
  const staff = (Array.isArray(s) ? s[0] : s) as Record<string, any>;
  if (se || !staff?.id) return J({ ok: false, error: "not_found" }, 401);

  // debug door: which model names this key can use (producers only)
  if (body.action === "models") {
    if (!staff.can_promote) return J({ ok: false, error: "not_permitted" }, 403);
    if (!apiKey) return J({ ok: false, error: "no ANTHROPIC_API_KEY secret" }, 500);
    const r = await fetch("https://api.anthropic.com/v1/models?limit=40", { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } });
    return J({ ok: r.ok, configured: MODEL, models: await r.json() }, r.ok ? 200 : 502);
  }

  const text = String(body.body ?? "").trim();
  if (!text) return J({ ok: false, error: "staff_token and body required" }, 400);
  if (text.length > 4000) return J({ ok: false, error: "that is too long for one message" }, 400);

  const ctx = (body.context ?? {}) as Record<string, any>;

  let requestId = body.request_id ? String(body.request_id) : "";
  if (!requestId) {
    const { data, error } = await db.from("studio_requests").insert({
      staff_id: staff.id, client_slug: ctx.client ?? null, context: ctx, title: text.slice(0, 70), status: "chat", kind: "chat",
    }).select("id").single();
    if (error) return J({ ok: false, error: error.message }, 500);
    requestId = data.id;
  } else {
    // a reply in a finished thread reopens it as a conversation — the badge
    // should not keep saying Failed while the two of you are still talking
    await db.from("studio_requests").update({ status: "chat", kind: "chat" })
      .eq("id", requestId).in("status", ["failed", "declined", "shipped", "handoff"]);
  }
  await db.from("studio_request_messages").insert({ request_id: requestId, role: "staff", staff_id: staff.id, body: text });
  await db.from("studio_requests").update({ updated_at: new Date().toISOString() }).eq("id", requestId);

  if (!apiKey) {
    const why = "No Anthropic key is set on this project, so I cannot answer here yet. Your message is saved.";
    await db.from("studio_request_messages").insert({ request_id: requestId, role: "claude", body: why });
    return J({ ok: true, request_id: requestId, reply: why, degraded: true });
  }

  const { data: hist } = await db.from("studio_request_messages")
    .select("role,body").eq("request_id", requestId).order("created_at").limit(60);
  // consecutive same-role messages are merged: the API wants strict alternation,
  // and a builder note followed by a staff reply is two user-side turns in a row
  const messages: any[] = [];
  for (const m of hist ?? []) {
    const role = m.role === "claude" ? "assistant" : "user";
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += "\n\n" + m.body; else messages.push({ role, content: m.body });
  }
  if (messages.length && messages[0].role === "assistant") messages.unshift({ role: "user", content: "(earlier in this thread)" });

  const { data: snap } = await db.rpc("studio_chat_snapshot", { p_client_slug: ctx.client ?? null });
  const { data: idx } = await db.rpc("bestly_memory_index");
  const memIndex = ((idx ?? []) as any[]).map((m) => `${m.area}/${m.key} — ${m.title}`).join("\n") || "(empty)";
  const system = [
    { type: "text", text: SYSTEM_FIXED, cache_control: { type: "ephemeral" } },
    { type: "text", text: SYSTEM_MEMORY(memIndex), cache_control: { type: "ephemeral" } },
    { type: "text", text: SYSTEM_LIVE(ctx, staff, snap ?? {}) },
  ];
  let used: string[] = [], queued = false, reply = "";
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await ask(messages, system, apiKey);
      const calls = (res.content ?? []).filter((c: any) => c.type === "tool_use");
      const said = (res.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      if (!calls.length) { reply = said; break; }
      messages.push({ role: "assistant", content: res.content });
      const results = [];
      for (const c of calls) {
        used.push(c.name);
        if (c.name === "queue_build") queued = true;
        const out = await runTool(c.name, c.input ?? {}, token, ctx, requestId, staff.id);
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out).slice(0, 12000) });
      }
      messages.push({ role: "user", content: results });
      if (turn === MAX_TURNS - 1) reply = said || "I got part-way through that and ran out of steps. Tell me which bit to finish.";
    }
  } catch (e) {
    const why = `I could not reach the model: ${(e as Error).message}`.replace(/sk-ant-[A-Za-z0-9_\-]+/g, "sk-ant-…");
    await db.from("studio_request_messages").insert({ request_id: requestId, role: "claude", body: why });
    return J({ ok: false, error: (e as Error).message, request_id: requestId, reply: why }, 200);
  }

  if (!reply) reply = "Done.";
  await db.from("studio_request_messages").insert({ request_id: requestId, role: "claude", body: reply });
  await db.from("studio_requests").update({ updated_at: new Date().toISOString() }).eq("id", requestId);
  return J({ ok: true, request_id: requestId, reply, tools: used, queued });
});
