// studio-notify — empties the outbox. Called by pg_cron every two minutes
// (drain), or by hand. Triggers in the database decide WHAT gets sent and to
// WHOM; this only turns rows into emails, and only rows that carry an address.
//
//   drain   {}   send up to 20 waiting rows via Resend, then post whatever
//                the talk_outbox holds to Talk.
//
// v6: each Talk line goes to the room of the client it is about
// (talk_outbox.room, resolved in the database). A line with no room is never
// posted. It used to go to one hard-coded room (Centering YOU's), so Listings
// and demo alerts landed in her channel.
// v7: an email can carry a list of TASKS — one block per thing waiting on her,
// each with its own large button straight to the work.
// v8 (2026-09-23): the x-notify-key is no longer in this file. It lives in Vault
// as studio_notify_key; edge_key_ok() (service-role only) checks it, and the
// studio-notify-drain cron reads the same Vault secret to send it.

import { createClient } from "jsr:@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const FROM = "Bestly Studio <studio@bestly.tech>";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

async function keyOk(k: string): Promise<boolean> {
  if (!k) return false;
  const { data } = await db.rpc("edge_key_ok", { p_name: "studio_notify_key", p_key: k });
  return data === true;
}
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// "3 posts are waiting" is only true at send time, so the count is taken then
async function liveSubject(row: Record<string, any>): Promise<{ subject: string; body: string }> {
  if (row.kind === "client_posts" && row.client_id) {
    const { count } = await db.from("approval_items").select("id", { count: "exact", head: true })
      .eq("client_id", row.client_id).eq("stage", "client").eq("status", "pending");
    const n = count ?? 0;
    if (n === 0) return { subject: "", body: "" };   // she already answered them all
    return { subject: n === 1 ? "A post is waiting for you" : `${n} posts are waiting for you`, body: row.body };
  }
  return { subject: row.subject, body: row.body };
}

// One look for every email Bestly Studio sends: the site's lockup up top,
// a white card, one action, a quiet footer. Inline styles only.
const LOGO = "https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/app/studio-mark.4505937442.gif";
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif";
function layout(opts: { title: string; intro?: string; body: string; blocks?: string; cta?: { href: string; label: string }; note?: string; footer?: string }): string {
  const { title, intro, body, blocks, cta, note, footer } = opts;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F5F5F7;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F5F7"><tr><td align="center" style="padding:36px 16px 48px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px">
  <tr><td style="padding:0 6px 18px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="vertical-align:middle;padding-right:10px"><img src="${LOGO}" width="28" height="28" alt="Bestly Studio" style="display:block;width:28px;height:28px;border-radius:7px"></td>
      <td style="vertical-align:middle;font:600 17px/1 ${FONT};letter-spacing:-.01em;color:#1D1D1F">Bestly <span style="font-weight:400;color:#A1A1A6;padding:0 5px">|</span><span style="font-weight:500;color:#1F7F77">Studio</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#FFFFFF;border-radius:18px;padding:34px 34px 30px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 10px 30px -18px rgba(0,0,0,.18)">
    <h1 style="margin:0 0 ${intro ? "10px" : "18px"};font:600 24px/1.25 ${FONT};letter-spacing:-.02em;color:#1D1D1F">${esc(title)}</h1>
    ${intro ? `<p style="margin:0 0 20px;font:400 15px/1.55 ${FONT};color:#6E6E73">${esc(intro)}</p>` : ""}
    ${blocks ?? ""}
    <div style="font:400 15.5px/1.6 ${FONT};color:#1D1D1F">${body}</div>
    ${cta ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 8px"><tr><td style="border-radius:12px;background:#1F7F77"><a href="${esc(cta.href)}" style="display:inline-block;padding:14px 24px;font:600 15px/1 ${FONT};color:#FFFFFF;text-decoration:none;border-radius:12px">${esc(cta.label)}</a></td></tr></table>` : ""}
    ${note ? `<p style="margin:16px 0 0;font:400 13px/1.55 ${FONT};color:#6E6E73">${note}</p>` : ""}
  </td></tr>
  <tr><td style="padding:18px 8px 0;font:400 12px/1.6 ${FONT};color:#A1A1A6;text-align:center">${footer ?? "Bestly Studio · the review desk behind your posts"}</td></tr>
</table></td></tr></table></body></html>`;
}
const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;

/* A row of count boxes — the shape a status mail wants: numbers, not prose. */
type Tone = "stop" | "warn" | "accent" | "client" | "mute";
const TONES: Record<Tone, [string, string]> = {
  stop:   ["#B8432F", "#FAEFEC"],
  warn:   ["#8F5A15", "#FAF4EA"],
  accent: ["#1F7F77", "#EDF5F4"],
  client: ["#2F5FD0", "#EEF2FC"],
  mute:   ["#6E6E73", "#F2F2F4"],
};
type Count = { n: number | string; label: string; tone?: Tone };
function isCounts(v: unknown): v is Count[] {
  return Array.isArray(v) && v.length > 0 &&
    v.every((c) => c && typeof c === "object" && "n" in c && "label" in c);
}
function box(c: Count, pad: string): string {
  const [ink, bg] = TONES[(c.tone ?? "mute") as Tone] ?? TONES.mute;
  return `<td width="50%" style="padding:${pad}">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${bg};border-radius:14px"><tr><td style="padding:18px 18px 16px;border-left:4px solid ${ink};border-radius:14px">
      <div style="font:600 38px/1 ${FONT};letter-spacing:-.03em;color:${ink}">${esc(String(c.n))}</div>
      <div style="font:400 13.5px/1.4 ${FONT};color:#1D1D1F;padding-top:7px">${esc(c.label)}</div>
    </td></tr></table></td>`;
}
function counts(cs: Count[]): string {
  let out = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">`;
  for (let i = 0; i < cs.length; i += 2) {
    const last = i + 2 >= cs.length;
    out += `<tr>${box(cs[i], `0 5px ${last ? "0" : "10px"} 0`)}`;
    out += cs[i + 1] ? box(cs[i + 1], `0 0 ${last ? "0" : "10px"} 5px`) : `<td width="50%"></td>`;
    out += `</tr>`;
  }
  return out + `</table>`;
}
const countsText = (cs: Count[]) => cs.map((c) => `${c.n}  ${c.label}`).join("\n");

/* Things waiting ON her, one block each, with its own large button. Jared,
   2026-09-23: "links directly to action work, easy to understand, stupid easy
   copy and large buttons." A count tells her there is work; a button takes her
   to it. This is the second one. Tables and inline styles only — Outlook. */
type Task = { title: string; line?: string; href: string; label: string; late?: boolean };
function isTasks(v: unknown): v is Task[] {
  return Array.isArray(v) && v.length > 0 &&
    v.every((t) => t && typeof t === "object" && "title" in t && "href" in t && "label" in t);
}
function taskBlock(t: Task): string {
  const ink = t.late ? "#B8432F" : "#1F7F77";
  const bg  = t.late ? "#FAEFEC" : "#F7F7F9";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px">
  <tr><td style="background:${bg};border-radius:14px;padding:18px 18px 16px;border-left:4px solid ${ink}">
    ${t.late ? `<div style="font:700 11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${ink};padding-bottom:9px">Overdue</div>` : ""}
    <div style="font:600 17px/1.3 ${FONT};letter-spacing:-.01em;color:#1D1D1F">${esc(t.title)}</div>
    ${t.line ? `<div style="font:400 14.5px/1.55 ${FONT};color:#6E6E73;padding-top:6px">${esc(t.line)}</div>` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px">
      <tr><td align="center" style="border-radius:12px;background:${ink}">
        <a href="${esc(t.href)}" style="display:block;padding:15px 20px;font:600 16px/1 ${FONT};color:#FFFFFF;text-decoration:none;border-radius:12px">${esc(t.label)}</a>
      </td></tr></table>
  </td></tr></table>`;
}
const tasksHTML = (ts: Task[]) => ts.map(taskBlock).join("");
const tasksText = (ts: Task[]) =>
  ts.map((t) => `${t.late ? "OVERDUE - " : ""}${t.title}${t.line ? "\n" + t.line : ""}\n${t.label}: ${t.href}`).join("\n\n");

function html(subject: string, body: string, link: string | null, audience: string, payload?: unknown) {
  const pay = payload as Record<string, any> | null;
  const ts = pay?.tasks;
  if (isTasks(ts)) {
    return layout({
      title: subject,
      intro: body || undefined,
      blocks: tasksHTML(ts),
      body: "",
      cta: link ? { href: link, label: "Open my board" } : undefined,
      note: audience === "client"
        ? "This is just what you said you would do, in one place. Reply to this email if anything should come off the list."
        : "Switch these off under Settings › People in Studio.",
    });
  }
  const cs = pay?.counts;
  return layout({
    title: subject,
    intro: isCounts(cs) ? (body || undefined) : undefined,
    blocks: isCounts(cs) ? counts(cs) : undefined,
    body: isCounts(cs) ? "" : p(esc(body).replace(/\n/g, "<br>")),
    cta: link ? { href: link, label: audience === "client" ? "Open my board" : "Open Studio" } : undefined,
    note: audience === "client"
      ? "You get these because your producer set up a board for you. Ask them to switch emails off if you would rather just check the board."
      : "Switch these off under Settings › People in Studio.",
  });
}

async function talk(room: string, message: string): Promise<string | null> {
  try {
    const { data } = await db.rpc("get_nextcloud_credentials");
    const row = Array.isArray(data) ? data[0] : data;
    const base = String(row?.base_url ?? "").replace(/\/+$/, "");
    const user = String(row?.username ?? ""), pass = String(row?.app_password ?? "");
    if (!base || !user || !pass) return "no nextcloud credentials";
    const r = await fetch(`${base}/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${user}:${pass}`), "OCS-APIRequest": "true",
                 Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    return r.ok ? null : `talk ${r.status}`;
  } catch (e) { return (e as Error).message.slice(0, 120); }
}

async function drainTalk(): Promise<{ posted: number; failed: number; unrouted: number }> {
  const { data, error } = await db.rpc("talk_outbox_take");
  if (error || !data) return { posted: 0, failed: 0, unrouted: 0 };
  let posted = 0, failed = 0, unrouted = 0;
  for (const g of data as { kind: string; line: string; ids: string[]; room: string | null }[]) {
    if (!g.room) {
      await db.rpc("talk_outbox_done", { p_ids: g.ids, p_ok: true, p_error: "no client room" });
      unrouted++; continue;
    }
    const err = await talk(g.room, g.line);
    await db.rpc("talk_outbox_done", { p_ids: g.ids, p_ok: !err, p_error: err });
    if (err) failed++; else posted++;
  }
  return { posted, failed, unrouted };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const k = req.headers.get("x-notify-key") ?? "";
  if (!(await keyOk(k))) return J({ ok: false, error: "unauthorized" }, 401);
  const resend = Deno.env.get("RESEND_API_KEY");
  if (!resend) return J({ ok: false, error: "no RESEND_API_KEY" }, 500);

  const { data: rows, error } = await db.rpc("notify_outbox_take", { p_limit: 20 });
  if (error) return J({ ok: false, error: error.message }, 500);
  let sent = 0, skipped = 0, failed = 0;
  for (const row of (rows ?? []) as Record<string, any>[]) {
    try {
      const { subject, body } = await liveSubject(row);
      if (!subject) { await db.rpc("notify_outbox_done", { p_id: row.id, p_ok: true, p_error: "nothing left to say" }); skipped++; continue; }
      const cs = row.payload?.counts;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [row.to_email], subject,
          text: [body,
                 isTasks(row.payload?.tasks) ? tasksText(row.payload.tasks) : "",
                 isCounts(cs) ? countsText(cs) : "",
                 row.link ?? ""].filter(Boolean).join("\n\n"),
          html: html(subject, body, row.link, row.audience, row.payload) }),
      });
      if (r.ok) { await db.rpc("notify_outbox_done", { p_id: row.id, p_ok: true }); sent++; }
      else { await db.rpc("notify_outbox_done", { p_id: row.id, p_ok: false, p_error: `resend ${r.status}: ${(await r.text()).slice(0, 200)}` }); failed++; }
    } catch (e) {
      await db.rpc("notify_outbox_done", { p_id: row.id, p_ok: false, p_error: (e as Error).message.slice(0, 200) }); failed++;
    }
  }
  const t = await drainTalk();
  return J({ ok: true, sent, skipped, failed, took: (rows ?? []).length, talk: t });
});
