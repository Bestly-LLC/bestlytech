// Family Cookbook test harness: a pretend server for the cookbook's own calls, so the real app can be driven in a real
// browser as Mom, Jared or Mariah without touching production. Nothing here ships: the app never knows it is running
// against this. The visibility rule is re-implemented in one line (mom's are for everyone; jared's and mariah's are
// never mom's) so the harness can also prove the screen never asks for, or draws, something it should not have.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const kitchen = JSON.parse(fs.readFileSync(path.join(here, "kitchen-fixture.json"), "utf8"));

const NAMES = { mom: ["Mom", "Harris", false], jared: ["Jared", "Best", true], mariah: ["Mariah", "Best", true] };
export const TOKENS = { mom: "m".repeat(64), jared: "j".repeat(64), mariah: "a".repeat(64) };
const roleOf = (t) => Object.keys(TOKENS).find((k) => TOKENS[k] === t) || null;
const can = (viewer, owner) => owner === "mom" || viewer !== "mom";

const I = (id, name, amount, unit, x = {}) => ({ id, name, amount, unit, ...x });
const S = (title, text, x = {}) => ({ title, text, ...x });
const iso = (daysAgo, h = 9) => new Date(Date.now() - daysAgo * 864e5 + (h - 12) * 36e5).toISOString();

export const bananaBread = {
  id: "banana-bread", title: "Banana Bread", category: "Baking", yield: { amount: 10, unit: "slices" }, time: { prep_min: 15, bake_min: 55 }, omnicook: "none",
  ingredients: [I("ban", "ripe banana, mashed", 3, "count"), I("butter", "butter, melted", 1 / 3, "cup"), I("sugar", "sugar", 0.75, "cup"), I("egg", "egg, beaten", 1, "egg"), I("vanilla", "vanilla", 1, "tsp"), I("soda", "baking soda", 1, "tsp"), I("salt", "salt", 0.25, "tsp"), I("flour", "flour", 1.5, "cup")],
  steps: [S("Heat the oven", "Heat the oven to 350°F. Grease a loaf pan."), S("Mix the wet part", "Mash {ban} ripe bananas in a big bowl. Stir in {butter} melted butter, {sugar} sugar, {egg} and {vanilla} vanilla."),
    S("Add the dry part", "Sprinkle {soda} baking soda and {salt} salt over the bowl. Stir in {flour} flour until just mixed."),
    S("Bake", "Pour into the pan. Bake at 350°F for 55 minutes, until a toothpick comes out clean.", { timer_sec: 3300 }), S("Cool", "Cool in the pan for 10 minutes, then slice.", { timer_sec: 600 })],
};
export const potRoastFlagged = {
  id: "pot-roast", title: "Sunday Pot Roast", category: "Dinner", yield: { amount: 6, unit: "servings" }, time: { total_min: 300 }, omnicook: "none",
  ingredients: [I("roast", "chuck roast", 3, "lb", { unsure: { alts: [{ label: "3 lb", amount: 3, unit: "lb" }, { label: "5 lb", amount: 5, unit: "lb" }, { label: "2 lb", amount: 2, unit: "lb" }] } }), I("onion", "onion, cut in big pieces", 2, "count"), I("garlic", "garlic clove", 3, "count"), I("broth", "beef broth", 1, "cup")],
  steps: [S("Brown the roast", "Sprinkle the {roast} chuck roast with salt and pepper. Brown it in a hot heavy pot, about 4 minutes on each side."), S("Add the rest", "Add {onion} onions, {garlic} garlic cloves and {broth} beef broth."), S("Roast", "Cover and roast for [[w1|3 hours|2 hours|3½ hours]].", { timer_sec: 10800 })],
};
const scanDraft = () => ({
  id: "draft", title: "Lemon Bars", category: "Baking", yield: { amount: 16, unit: "bars" }, omnicook: "none",
  ingredients: [I("flour", "flour", 1, "cup"), I("butter", "butter, soft", 0.5, "cup"), I("sugar", "sugar", 1, "cup"), I("egg", "egg", 2, "egg"), I("lemon", "lemon juice", 3, "tbsp", { unsure: { alts: [{ label: "3 tbsp", amount: 3, unit: "tbsp" }, { label: "2 tbsp", amount: 2, unit: "tbsp" }] } })],
  steps: [S("Make the crust", "Mix {flour} flour and {butter} butter. Press into a pan. Bake at 350°F for 20 minutes."), S("Make the top", "Whisk {sugar} sugar, {egg} and {lemon} lemon juice. Pour over the hot crust."), S("Bake again", "Bake [[w1|20 minutes|25 minutes|15 minutes]] more, until set.")],
});

export function makeServer() {
  let seq = 100;
  const recs = [];
  const add = (by, doc, extra = {}) => { const r = { id: ++seq, by, doc: JSON.parse(JSON.stringify(doc)), added: iso(extra.daysAgo ?? 1), status: "approved", flaggedBy: null, flaggedAt: null, note: "", closer: false, deletedAt: null, deletedBy: null, photos: [], notes: {}, cooks: [], ...extra }; recs.push(r); return r; };
  const mb = add("mom", bananaBread, { note: "The one we make when the bananas go brown.", daysAgo: 2, photos: [{ id: "00000000-0000-4000-8000-000000000001", side: "front" }, { id: "00000000-0000-4000-8000-000000000002", side: "back" }] });
  add("mom", potRoastFlagged, { status: "review", flaggedBy: "mom", flaggedAt: iso(0, 9), closer: true, daysAgo: 0, photos: [{ id: "00000000-0000-4000-8000-000000000003", side: "front" }] });
  add("mariah", { ...bananaBread, id: "secret-mariah", title: "SECRETMARIAH Cake", category: "Baking" }, { daysAgo: 3 });
  const k = kitchen.find((x) => x.id === "almond-flour-cc-cookies");
  add("jared", { ...k, omnicook_capacity: { bowl_l: 2.2, max_dough_oz: 40, base_dough_oz: 22 } }, { daysAgo: 4 });
  add("jared", { ...bananaBread, id: "secret-jared", title: "SECRETJARED Stew" }, { daysAgo: 5 });
  const caps = [];
  const log = [];     // every call the app made: [name, role, args]
  const uploads = [];
  let nextPhoto = 500;

  const row = (r) => ({ id: String(r.id), title: r.doc.title, by: r.by, added: r.added, status: r.status, category: r.doc.category || "", flaggedBy: r.flaggedBy, flaggedAt: r.flaggedAt, note: r.note, closer: r.closer, deletedAt: r.deletedAt, deletedBy: r.deletedBy, yield: r.doc.yield, photos: r.photos,
    hay: [r.doc.title, r.note, r.doc.category, NAMES[r.by][0], ...r.doc.ingredients.map((i) => i.name)].join(" ").toLowerCase() });
  const capView = (c) => {
    const age = Date.now() - c.at;
    const st = c.discarded ? "discarded" : c.saved ? "saved" : age > 1800 ? "ready" : "reading";
    return { id: c.id, status: st, draft: st === "ready" ? c.draft : null, closer: false, lowconf: false, hasBack: !!c.back, error: null, created: new Date(c.at).toISOString(), photos: c.photos };
  };

  const rpc = (name, a) => {
    const role = roleOf(a.p_token);
    if (!role) return [400, { message: "not_signed_in" }];
    const me = NAMES[role];
    const vis = (r) => can(role, r.by);
    const need = (id, deleted = false) => { const r = recs.find((x) => x.id === Number(id)); if (!r || !vis(r) || (!!r.deletedAt !== deleted)) return null; return r; };
    switch (name) {
      case "family_me": return [200, { id: role, name: me[0], last: me[1], reviewer: me[2], activeRoles: ["jared", "mariah", "mom"] }];
      case "family_logout": return [200, null];
      case "family_recipes": return [200, { recipes: recs.filter((r) => vis(r) && !r.deletedAt).map(row).reverse() }];
      case "family_recipe": {
        const r = need(a.p_id); if (!r) return [400, { message: "not_found" }];
        return [200, { ...row(r), doc: r.doc, canEdit: r.by === role || role === "jared", notes: r.notes[role] || "", cooks: r.cooks }];
      }
      case "family_review_list": return [200, { recipes: me[2] ? recs.filter((r) => vis(r) && !r.deletedAt && r.status === "review").map((r) => ({ ...row(r), doc: r.doc })) : [] }];
      case "family_deleted_list": return [200, { recipes: recs.filter((r) => vis(r) && r.deletedAt).map(row) }];
      case "family_captures": return [200, { captures: caps.filter((c) => c.role === role).map(capView).filter((c) => ["reading", "closer", "ready", "failed"].includes(c.status)) }];
      case "family_capture_save": {
        const c = caps.find((x) => x.id === a.p_id && x.role === role); if (!c) return [400, { message: "not_found" }];
        const r = add(role, a.p_doc, { status: a.p_flag ? "review" : "approved", flaggedBy: a.p_flag ? role : null, flaggedAt: a.p_flag ? new Date().toISOString() : null, note: a.p_note || "", photos: c.photos, daysAgo: 0 });
        c.saved = true; return [200, row(r)];
      }
      case "family_capture_discard": { const c = caps.find((x) => x.id === a.p_id && x.role === role); if (!c) return [400, { message: "not_found" }]; c.discarded = true; return [204, null]; }
      case "family_approve": { const r = need(a.p_id); if (!r || !me[2]) return [400, { message: "not_allowed" }]; r.doc = a.p_doc; r.status = "approved"; r.flaggedBy = null; r.flaggedAt = null; r.closer = false; return [200, row(r)]; }
      case "family_delete": { const r = need(a.p_id); if (!r) return [400, { message: "not_found" }]; if (!(r.by === role || role === "jared")) return [400, { message: "not_allowed" }]; r.deletedAt = new Date().toISOString(); r.deletedBy = role; return [200, { ok: true }]; }
      case "family_restore": { const r = need(a.p_id, true); if (!r) return [400, { message: "not_found" }]; r.deletedAt = null; r.deletedBy = null; return [200, { ok: true }]; }
      case "family_edit": { const r = need(a.p_id); if (!r) return [400, { message: "not_found" }]; r.doc.title = a.p_title; r.note = a.p_note || ""; return [200, row(r)]; }
      case "family_set_notes": { const r = need(a.p_id); if (!r) return [400, { message: "not_found" }]; r.notes[role] = a.p_body; return [204, null]; }
      case "family_log_cook": { const r = need(a.p_id); if (!r) return [400, { message: "not_found" }]; r.cooks.push({ at: new Date().toISOString(), desc: a.p_summary, note: a.p_note, by: role }); return [200, { ok: true, omni: a.p_omni }]; }
      default: return [404, { message: "unknown " + name }];
    }
  };

  const cardSvg = (label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 420" width="700" height="420"><rect width="700" height="420" fill="#d9c7a3"/><rect x="20" y="20" width="660" height="380" rx="8" fill="#fffdf4"/><path d="M20 62H680" stroke="#d9544a" stroke-width="2"/>${[92, 122, 152, 182, 212, 242, 272, 302, 332, 362].map((y) => `<path d="M20 ${y}H680" stroke="#8fb4da" stroke-width="1.2"/>`).join("")}<text x="40" y="52" font-size="34" font-family="cursive" fill="#22344a">${label}</text><text x="40" y="115" font-size="24" font-family="cursive" fill="#22344a">3 ripe bananas  1/3 cup butter  3/4 cup sugar</text></svg>`;

  async function install(page, who) {
    await page.route("**/rest/v1/rpc/*", async (route) => {
      const req = route.request();
      const name = new URL(req.url()).pathname.split("/").pop();
      let a = {}; try { a = JSON.parse(req.postData() || "{}"); } catch { /* none */ }
      log.push([name, roleOf(a.p_token), a]);
      const [status, body] = rpc(name, a);
      await route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: body == null ? "" : JSON.stringify(body) });
    });
    await page.route("**/functions/v1/family-photo**", async (route) => {
      const req = route.request();
      const t = req.headers()["x-family-token"], role = roleOf(t);
      const id = new URL(req.url()).searchParams.get("p");
      log.push(["photo", role, { id }]);
      const owner = recs.find((r) => r.photos.some((p) => p.id === id));
      const cap = caps.find((c) => c.photos.some((p) => p.id === id));
      const ok = role && ((owner && can(role, owner.by)) || (cap && cap.role === role));
      if (!ok) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "not found" });
      await route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: cardSvg(owner ? owner.doc.title : "New card") });
    });
    await page.route("**/functions/v1/family-upload", async (route) => {
      const req = route.request();
      const buf = req.postDataBuffer() || Buffer.alloc(0);
      const txt = buf.toString("latin1");
      const side = /name="side"\r\n\r\n(front|back)/.exec(txt)?.[1] || "front";
      const cid = /name="capture_id"\r\n\r\n([0-9a-f-]{36})/.exec(txt)?.[1] || "";
      const token = /name="token"\r\n\r\n([^\r]+)/.exec(txt)?.[1] || "";
      const role = roleOf(token);
      uploads.push({ side, bytes: buf.length, role, capture: cid });
      if (!role) return route.fulfill({ status: 401, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: false, error: "Please sign in again." }) });
      let c = caps.find((x) => x.id === cid);
      const pid = "00000000-0000-4000-8000-" + String(++nextPhoto).padStart(12, "0");
      if (!c) { c = { id: "11111111-1111-4111-8111-" + String(++seq).padStart(12, "0"), role, at: Date.now(), photos: [], draft: scanDraft() }; caps.push(c); }
      else { c.at = Date.now(); c.back = true; }
      c.photos.push({ id: pid, side });
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true, capture_id: c.id, photo_id: pid }) });
    });
    await page.route("**/functions/v1/family-auth", async (route) => {
      let b = {}; try { b = JSON.parse(route.request().postData() || "{}"); } catch { /* none */ }
      const h = { "access-control-allow-origin": "*" };
      if (b.op === "start") return route.fulfill({ status: 200, contentType: "application/json", headers: h, body: JSON.stringify({ ok: true, url: new URL("/cookbook/callback?code=abcdef123456&state=" + "a".repeat(48), page.url()).toString() }) });
      const role = who || "mom";
      const me = NAMES[role];
      return route.fulfill({ status: 200, contentType: "application/json", headers: h, body: JSON.stringify({ ok: true, token: TOKENS[role], me: { id: role, name: me[0], last: me[1], reviewer: me[2], activeRoles: [] } }) });
    });
    // OPTIONS preflights
    await page.route("**/*", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      return route.fallback();
    });
  }
  return { install, recs, caps, log, uploads, mb };
}
