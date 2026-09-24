// bestly-content-gen — HOKU content engine
// Generates captions with OpenAI, blocks drug claims, fills hoku_content_bank,
// and moves approved items onto the social_posts calendar.
//
// Actions: health | generate | queue | run | alarm | list | approve | reject
//          post_now | rewrite
// Auth (any one):
//   x-gen-key header                       hoku-clean.com's server-side proxy
//                                          (checked against Vault by RPC)
//   Authorization: Bearer <service_role>   direct service calls
//   x-proxy-key                            pg_cron via invoke_edge_function
//                                          (checked against the vault by RPC)
//   x-staff-token                          a signed-in Bestly Studio staff
//                                          member; read actions for anyone,
//                                          writes need can_promote
//
// v9 (2026-09-23): no keys in this file any more. The x-gen-key's sha256 lives in
// Vault as content_gen_key_sha256 and edge_key_ok() (service-role only) checks it.
// The burned legacy key (accepted until 2026-09-10) is gone for good.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const AI_MODEL = "gpt-4o";
const BRAND = "hoku";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-gen-key, x-proxy-key, x-staff-token",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// ---------------------------------------------------------------- truth sheet
const TRUTH = `
PRODUCT: HOKU Hypochlorous Acid Facial Mist. 4 fl oz / 118 mL. GTIN 884400675606.

WHAT IT IS
- Run an electric current through salt water and it becomes hypochlorous acid.
- The body already makes hypochlorous acid on its own.
- The entire ingredient list is: water, salt, hypochlorous acid. 200 ppm.
- No alcohol. No fragrance. No oils. No preservatives. Nothing added to make it last.

THE CAN
- Bag-on-valve aerosol, not a pump bottle.
- The liquid sits in a sealed bag; propellant surrounds the bag and never touches it.
- A pump has to let air back in to refill itself. This never does.
- That is why it needs no preservative: nothing gets in.
- Sprays at any angle, including upside down.
- Continuous fine mist, not a jet.

HOW IT IS USED
- Mist the face, let it air dry. Do not wipe it off.
- Use it whenever: after cleansing, after the gym, after a mask, over or under other products.

TONE
- Plain, specific, calm, a little dry. Sentence fragments are good. Confident without hype.
- Explain the mechanism; let the mechanism be the selling point.
- Never exclamation marks. Never emoji. Never "game-changer", "holy grail", "obsessed".
- Never filler like "exactly as skincare should be", "seamlessly", "elevate your routine".

VOICE -- these are real HOKU posts. Match this register exactly:
  "No pump. No straw down the middle. No air getting back in.\n\nFour ounces, sealed shut."
  "Most face sprays come in a pump bottle. A pump has to let air in -- that is how it
   refills itself between sprays.\n\nWe went a different way. Here is why it matters."
  "That tight, squeaky feeling got marketed to us as \"clean\" for about forty years.\n\n
   It isn't. It's just a stripped barrier."
  "Building something we'd actually want on our own counter."

HARD RULES — HOKU IS A COSMETIC, NOT A DRUG
- Never say it heals, cures, treats, or prevents anything.
- Never name a skin condition (acne, eczema, dermatitis, rosacea, wounds, rashes).
- Never say antibacterial, antimicrobial, disinfect, sanitize, sterilize, or kills anything.
- Never mention bacteria, germs, viruses, pathogens, or infection at all.
- Never say medical-grade, FDA approved, clinically proven, dermatologist tested,
  hypoallergenic, non-irritating, or non-cytotoxic.
- Never claim it reduces redness or inflammation.
- Describe what the product IS and HOW IT IS BUILT, never what it does to a condition.

ALSO BANNED -- benefits HOKU has never claimed, or efficacy we cannot prove
- hydrate, moisturize, nourish, restore, renew, rejuvenate, revitalize, brighten,
  firm, anti-aging, wrinkles, pores, detox, purify
- effective, efficacy, potent, powerful, proven, results, transforms your skin
- immune, immunity, defense system, "your skin's own mechanisms"
- all-natural, natural ingredients, naturally derived, chemical-free, non-toxic
The product is water, salt, and hypochlorous acid in a sealed can. Say that.
Do not tell anyone what it will do for them.
`.trim();

// Only tags the brand actually uses. The model hallucinates tags otherwise
// (it produced "#novalentines" on the first run).
const HASHTAGS = [
  "hoku", "hypochlorousacid", "hocl", "facemist", "skinbarrier", "barrierrepair",
  "sensitiveskin", "sensitiveskincare", "fragrancefree", "minimalskincare",
  "cleanbeauty", "skincarescience", "skincareroutine", "skintok",
  "ingredientlist", "newbrand",
];

function cleanHashtags(raw: string): string {
  const found = (raw.match(/#([A-Za-z0-9_]+)/g) ?? [])
    .map((t) => t.slice(1).toLowerCase())
    .filter((t) => HASHTAGS.includes(t));
  const tags = [...new Set(["hoku", ...found])].slice(0, 6);
  return tags.map((t) => "#" + t).join(" ");
}

const PHOTOS = [
  "bottle", "bottle2", "bottle3",
  "cap3", "cap4", "cap5",
  "body3", "body5", "lifestyle",
];

const POST_FIELDS = {
  theme: { type: "string", description: "2-4 word internal label for the angle" },
  eyebrow: { type: "string", description: "2-4 words set small in gold caps above the headline. A spec or plain tag: '4 fl oz', '200 ppm', 'three ingredients', 'sealed can'. Never an internal label." },
  headline: { type: "string", description: "3-8 words, set large on the image" },
  subhead: { type: "string", description: "optional, up to 14 words under the headline" },
  caption: { type: "string", description: "25-70 words, the Instagram caption" },
  hashtags: { type: "string" },
  layout: { type: "string", enum: ["photo", "type", "detail"] },
  photo_key: { type: "string", enum: PHOTOS },
  image_brief: { type: "string" },
};

// ---------------------------------------------------------------- helpers
function alertEmail(o: {
  title: string; severity: string; summary: string;
  stats?: { label: string; value: unknown }[];
  items?: { label: string; detail?: string }[];
  timestamp: string;
}): string {
  const color = o.severity === "danger" ? "#dc2626" : "#d97706";
  const stats = (o.stats || []).map((s) =>
    `<td style="padding:8px 14px;border:1px solid #eee;text-align:center"><div style="font-size:20px;font-weight:700">${s.value}</div><div style="font-size:11px;color:#888">${s.label}</div></td>`
  ).join("");
  const items = (o.items || []).map((i) =>
    `<li><strong>${i.label}</strong>${i.detail ? ": " + i.detail : ""}</li>`
  ).join("");
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;color:#222"><h2 style="color:${color}">${o.title}</h2><p>${o.summary}</p>${stats ? `<table style="border-collapse:collapse;margin:12px 0"><tr>${stats}</tr></table>` : ""}${items ? `<ul>${items}</ul>` : ""}<p style="font-size:11px;color:#aaa">${o.timestamp}</p></div>`;
}

async function sendAlert(subject: string, html: string) {
  const user = Deno.env.get("PRIVATEMAIL_EMAIL");
  const pass = Deno.env.get("PRIVATEMAIL_PASSWORD");
  if (!user || !pass) return;
  try {
    const client = new SMTPClient({
      connection: { hostname: "mail.privateemail.com", port: 465, tls: true, auth: { username: user, password: pass } },
    });
    try {
      await client.send({
        from: user,
        to: Deno.env.get("EMAIL_TO") || "jaredbest@icloud.com",
        subject, html,
      });
    } finally { await client.close(); }
  } catch (e) {
    console.error("alert email failed:", (e as Error).message);
  }
}

async function callOpenAI(apiKey: string, system: string, user: string, schema: unknown, fnName: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{ type: "function", function: { name: fnName, description: "Submit results.", parameters: schema } }],
      tool_choice: { type: "function", function: { name: fnName } },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("no tool call in OpenAI response");
  return { parsed: JSON.parse(call.function.arguments), usage: data.usage ?? {} };
}

interface Draft {
  theme: string; eyebrow?: string; headline: string; subhead?: string;
  caption: string; hashtags: string;
  layout: "photo" | "type" | "detail"; photo_key: string; image_brief: string;
}

async function generate(apiKey: string, count: number, avoid: string[], retryNote?: string) {
  const system =
    `You write Instagram posts for HOKU, a single-product skincare brand. ` +
    `You only ever state facts from the truth sheet you are given. You never ` +
    `invent an ingredient, a number, a certification, or a benefit. Your copy ` +
    `must survive FDA cosmetic-claim review: HOKU is a cosmetic, and any ` +
    `sentence implying it treats a condition would make it an unapproved drug.` +
    `\n\n${TRUTH}`;

  const user = [
    `Write ${count} distinct Instagram posts for HOKU.`,
    ``,
    `hashtags: 4-6 tags on one line, chosen ONLY from: ${HASHTAGS.map((t) => "#" + t).join(" ")}`,
    `Vary the angle across the set: how it is made, why the can matters,`,
    `what is not in it, how it is used, what the brand believes.`,
    avoid.length
      ? `\nALREADY USED — do not repeat these angles or reuse their phrasing:\n${avoid.map((a) => "- " + a).join("\n")}`
      : ``,
    retryNote ? `\n${retryNote}` : ``,
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: POST_FIELDS,
          required: ["theme", "eyebrow", "headline", "caption", "hashtags", "layout", "photo_key", "image_brief"],
          additionalProperties: false,
        },
      },
    },
    required: ["posts"],
    additionalProperties: false,
  };

  const { parsed, usage } = await callOpenAI(apiKey, system, user, schema, "submit_posts");
  return { drafts: (parsed.posts ?? []) as Draft[], usage };
}

// ---------------------------------------------------------------- handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);

  const genKey = req.headers.get("x-gen-key") || "";
  let ok = isSvc(req);
  // hoku-clean.com's proxy: its x-gen-key is checked against the sha256 in Vault.
  if (!ok && genKey) {
    const { data } = await db.rpc("edge_key_ok", { p_name: "content_gen_key_sha256", p_key: genKey });
    ok = data === true;
  }
  // pg_cron (invoke_edge_function) carries the vault's proxy key. The vault's
  // service key is no longer the same string as this function's env key, so
  // the bearer check above stopped matching it; the proxy key is checked by
  // a service-role-only RPC instead of a literal here.
  if (!ok) {
    const pk = req.headers.get("x-proxy-key") || "";
    if (pk) { const { data } = await db.rpc("internal_proxy_key_ok", { p_key: pk }); ok = data === true; }
  }
  // Bestly Studio: a staff session. Read for anyone signed in; writes only
  // for staff who can promote.
  let staff: { id: string; slug: string; can_promote: boolean } | null = null;
  if (!ok) {
    const st = req.headers.get("x-staff-token") || "";
    if (st) {
      const { data } = await db.rpc("studio_resolve_staff", { p_token: st });
      const s = Array.isArray(data) ? data[0] : data;
      if (s?.id) { staff = s; ok = true; }
    }
  }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const action = String(body.action ?? "health");
  if (staff && !staff.can_promote && !["health", "list"].includes(action)) {
    return json({ error: "not_permitted" }, 403);
  }

  // shared compliance check -> returns offending phrase or null
  const check = async (prose: string, tags = "") => {
    const { data: hard } = await db.rpc("hoku_compliance_violation", { _text: prose + " " + tags });
    if (hard) return String(hard);
    const { data: soft } = await db.rpc("hoku_soft_claim_violation", { _text: prose });
    return soft ? String(soft) : null;
  };

  try {
    if (action === "health") {
      const { data } = await db.from("v_hoku_queue_health").select("*").eq("brand", BRAND).maybeSingle();
      return json({ ok: true, health: data });
    }

    if (action === "alarm") {
      const { data: h } = await db.from("v_hoku_queue_health").select("*").eq("brand", BRAND).maybeSingle();
      await sendAlert("HOKU: posting queue is running out", alertEmail({
        title: "HOKU posting queue is running out",
        severity: (h?.runway_days ?? 0) <= 3 ? "danger" : "warning",
        summary: `The Instagram queue has <strong>${h?.runway_days ?? 0} day(s)</strong> of posts left. ` +
          `When it empties, posting stops with no error. Approve drafts in the bank to refill it.`,
        stats: [
          { label: "Days left", value: h?.runway_days ?? 0 },
          { label: "Queued", value: h?.queued_posts ?? 0 },
          { label: "Approved in bank", value: h?.bank_approved ?? 0 },
          { label: "Awaiting review", value: h?.bank_awaiting_review ?? 0 },
        ],
        timestamp: new Date().toISOString(),
      }));
      return json({ ok: true, alarmed: true, health: h });
    }

    if (action === "list") {
      const { data: pending } = await db.from("hoku_content_bank")
        .select("id,theme,eyebrow,headline,subhead,caption,hashtags,layout,photo_key,image_brief,media_urls,approved,rejected,reject_reason,queued_at,created_at")
        .eq("brand", BRAND).is("queued_at", null)
        .order("created_at", { ascending: false });
      const { data: queue } = await db.from("social_posts")
        .select("id,caption,media_url,scheduled_at,status,permalink")
        .eq("brand", BRAND).in("status", ["queued", "posting"])
        .order("scheduled_at").limit(60);
      const { data: health } = await db.from("v_hoku_queue_health")
        .select("*").eq("brand", BRAND).maybeSingle();
      return json({ ok: true, pending: pending ?? [], queue: queue ?? [], health });
    }

    if (action === "approve" || action === "reject") {
      const ids = (body.ids as string[]) ?? [];
      if (!ids.length) return json({ error: "no ids" }, 400);
      const patch = action === "approve"
        ? { approved: true, rejected: false, reject_reason: null }
        : { approved: false, rejected: true, reject_reason: String(body.reason ?? (staff ? `rejected in Studio by ${staff.slug}` : "rejected in admin")) };
      const { error } = await db.from("hoku_content_bank").update(patch).in("id", ids);
      if (error) throw error;

      let queued: unknown[] = [];
      if (action === "approve") {
        // _force: a human pressing approve schedules now, even in proposal mode.
        // The cron path still respects hoku_content_settings.enabled.
        const { data } = await db.rpc("hoku_queue_from_bank", { _brand: BRAND, _force: true });
        queued = data ?? [];
      }
      return json({ ok: true, action, count: ids.length, queued, by: staff?.slug ?? null });
    }

    if (action === "post_now") {
      const postId = String(body.post_id ?? "");
      if (!postId) return json({ error: "post_id required" }, 400);
      const { error } = await db.from("social_posts")
        .update({ scheduled_at: new Date().toISOString() })
        .eq("id", postId).eq("status", "queued");
      if (error) throw error;
      await db.rpc("invoke_edge_function", {
        function_slug: "bestly-ig-poster",
        payload: { action: "drain" },
      });
      return json({ ok: true, posted: postId, note: "handed to bestly-ig-poster drain" });
    }

    if (action === "queue") {
      const { data, error } = await db.rpc("hoku_queue_from_bank", {
        _brand: BRAND, _force: Boolean(body.force ?? false),
      });
      if (error) throw error;
      await db.from("hoku_content_log").insert({
        phase: "queue", status: (data?.length ?? 0) > 0 ? "ok" : "noop",
        caption_preview: `queued ${data?.length ?? 0} post(s)`,
      });
      return json({ ok: true, queued: data ?? [] });
    }

    // ---------------------------------------------------------- rewrite
    // The 29 hand-made posts carry no lockup at all. This derives image
    // parameters from each caption's OWN language (never new claims) so they
    // can be re-rendered through /api/og with the brand mark on them.
    if (action === "rewrite") {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

      const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 30);
      const apply = Boolean(body.apply ?? false);

      const { data: posts } = await db.from("social_posts")
        .select("id,caption,media_url,scheduled_at")
        .eq("brand", BRAND).in("status", ["queued", "posted"])
        .order("scheduled_at");
      const { data: already } = await db.from("hoku_post_render").select("post_id");
      const done = new Set((already ?? []).map((r: { post_id: string }) => r.post_id));
      const todo = (posts ?? []).filter((p: { id: string }) => !done.has(p.id)).slice(0, limit);
      if (!todo.length) return json({ ok: true, note: "nothing left to rewrite", remaining: 0 });

      const system =
        `You turn an existing, already-approved HOKU Instagram caption into image ` +
        `parameters. Use ONLY words and facts already present in that caption. ` +
        `Never introduce a claim, benefit, or number the caption does not contain. ` +
        `If the caption is vague, pick a plain factual eyebrow from the truth sheet.` +
        `\n\n${TRUTH}`;

      const user =
        `For each caption below, return image parameters.\n` +
        `- eyebrow: 2-4 words, a spec or plain tag ('4 fl oz', '200 ppm', 'three ingredients')\n` +
        `- headline: 3-8 words, lifted or lightly condensed from the caption itself\n` +
        `- subhead: up to 14 words, also from the caption\n` +
        `- layout: 'photo' if it is about the product object, 'type' if it is a statement or idea, 'detail' for a spec\n` +
        `- photo_key: one of ${PHOTOS.join(", ")}\n\n` +
        todo.map((p: { id: string; caption: string }, i: number) =>
          `[${i}] id=${p.id}\n${p.caption.replace(/#[A-Za-z0-9_]+/g, "").trim()}`).join("\n\n");

      const schema = {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                eyebrow: { type: "string" },
                headline: { type: "string" },
                subhead: { type: "string" },
                layout: { type: "string", enum: ["photo", "type", "detail"] },
                photo_key: { type: "string", enum: PHOTOS },
              },
              required: ["id", "eyebrow", "headline", "layout", "photo_key"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      };

      const { parsed } = await callOpenAI(apiKey, system, user, schema, "submit_renders");
      const items = (parsed.items ?? []) as Record<string, string>[];

      const written: unknown[] = [];
      const blocked: unknown[] = [];
      for (const it of items) {
        const src = todo.find((p: { id: string }) => p.id === it.id);
        if (!src) continue;
        const violation = await check([it.headline, it.subhead, it.eyebrow].filter(Boolean).join(" "));
        if (violation) {
          blocked.push({ id: it.id, phrase: violation });
          await db.from("hoku_content_log").insert({
            phase: "compliance", status: "blocked", theme: "rewrite",
            caption_preview: (it.headline ?? "").slice(0, 200),
            blocked_phrase: violation, ai_model: AI_MODEL,
          });
          continue;
        }
        const { data: ogUrl } = await db.rpc("hoku_og_url", {
          _headline: it.headline, _subhead: it.subhead ?? null,
          _eyebrow: it.eyebrow ?? null, _layout: it.layout, _photo: it.photo_key,
        });
        await db.from("hoku_post_render").upsert({
          post_id: it.id, eyebrow: it.eyebrow, headline: it.headline,
          subhead: it.subhead ?? null, layout: it.layout, photo_key: it.photo_key,
          og_url: ogUrl, original_url: src.media_url,
        });
        if (apply) {
          await db.from("social_posts")
            .update({ media_url: ogUrl, media_urls: [ogUrl] })
            .eq("id", it.id).eq("status", "queued");
        }
        written.push({ id: it.id, headline: it.headline, eyebrow: it.eyebrow, layout: it.layout });
      }

      const remaining = (posts ?? []).length - done.size - written.length - blocked.length;
      return json({ ok: true, applied: apply, written: written.length, blocked, items: written, remaining });
    }

    // ---------------------------------------------------------- generate
    if (action === "generate" || action === "run") {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

      const want = Math.min(Math.max(Number(body.count ?? 6), 1), 12);

      const { data: bankRows } = await db.from("hoku_content_bank")
        .select("theme").eq("brand", BRAND).order("created_at", { ascending: false }).limit(60);
      const { data: postRows } = await db.from("social_posts")
        .select("caption").eq("brand", BRAND).order("scheduled_at", { ascending: false }).limit(40);
      const avoid = [
        ...new Set([
          ...(bankRows ?? []).map((r: { theme: string }) => r.theme),
          ...(postRows ?? []).map((r: { caption: string }) => r.caption.split("\n")[0].slice(0, 80)),
        ]),
      ].filter(Boolean).slice(0, 50);

      const accepted: Record<string, unknown>[] = [];
      const blocked: { theme: string; phrase: string }[] = [];
      let usage: Record<string, number> = {};

      for (let attempt = 0; attempt < 2; attempt++) {
        const need = want - accepted.length;
        if (need <= 0) break;

        const note = attempt === 0 ? undefined :
          `A previous attempt was REJECTED by the compliance gate for using: ` +
          `${blocked.map((b) => b.phrase).join("; ")}. Do not use those words or ` +
          `any word describing what the product does to a skin condition.`;

        const { drafts, usage: u } = await generate(apiKey, need, avoid, note);
        usage = u;

        for (const d of drafts) {
          d.hashtags = cleanHashtags(d.hashtags ?? "");
          const prose = [d.caption, d.headline, d.subhead, d.eyebrow].filter(Boolean).join(" ");
          const violation = await check(prose, d.hashtags);

          if (violation) {
            blocked.push({ theme: d.theme, phrase: violation });
            await db.from("hoku_content_log").insert({
              phase: "compliance", status: "blocked", theme: d.theme,
              caption_preview: d.caption.slice(0, 200),
              blocked_phrase: violation, ai_model: AI_MODEL,
            });
            continue;
          }

          accepted.push({
            brand: BRAND, theme: d.theme, eyebrow: d.eyebrow ?? null,
            headline: d.headline, subhead: d.subhead ?? null, caption: d.caption,
            hashtags: d.hashtags, layout: d.layout, photo_key: d.photo_key,
            image_brief: d.image_brief, source: "ai",
            approved: false, media_urls: [],
          });
          avoid.push(d.theme);
        }
      }

      if (accepted.length) {
        const { error } = await db.from("hoku_content_bank").insert(accepted);
        if (error) throw error;
        await db.from("hoku_content_log").insert({
          phase: "generate", status: "ok",
          caption_preview: `${accepted.length} draft(s) into the bank, awaiting review`,
          ai_model: AI_MODEL,
          prompt_tokens: usage.prompt_tokens ?? null,
          completion_tokens: usage.completion_tokens ?? null,
        });
      }

      if (blocked.length >= 2) {
        await sendAlert("HOKU: compliance gate blocked generated copy", alertEmail({
          title: "HOKU compliance gate fired",
          severity: blocked.length >= 4 ? "danger" : "warning",
          summary: `The content generator produced <strong>${blocked.length}</strong> caption(s) containing claims that would make HOKU an unapproved drug. They were blocked and never stored.`,
          stats: [
            { label: "Accepted", value: accepted.length },
            { label: "Blocked", value: blocked.length },
          ],
          items: blocked.map((b) => ({ label: b.theme, detail: b.phrase })),
          timestamp: new Date().toISOString(),
        }));
      }

      let queued: unknown[] = [];
      if (action === "run") {
        const { data } = await db.rpc("hoku_queue_from_bank", { _brand: BRAND, _force: false });
        queued = data ?? [];
      }

      return json({
        ok: true,
        generated: accepted.length,
        blocked: blocked.length,
        blocked_detail: blocked,
        queued,
        note: "Drafts are unapproved. Nothing reaches Instagram until approved:true.",
      });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await db.from("hoku_content_log").insert({
      phase: "error", status: "failed", error_message: msg.slice(0, 500),
    });
    await sendAlert("HOKU content generator error", alertEmail({
      title: "HOKU content generator failed",
      severity: "danger",
      summary: "The content generator hit an unhandled error and did not complete.",
      items: [{ label: "Error", detail: msg }],
      timestamp: new Date().toISOString(),
    }));
    return json({ error: msg }, 500);
  }
});
