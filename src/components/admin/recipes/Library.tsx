import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { Ico, Glyph, type IconName } from "./Ico";
import { addDays, call, catOf, dayDiff, fmtDate, pacificDay, startLabel, todayPacific, type FermentRow, type GroceryRow, type HaSettings, type Overview, type RecipeRow } from "./rx";
import { pantryReport, listWords } from "@/lib/recipes/pantry";
import { nowrapSegs, servesLine, timeBits } from "@/lib/recipes/scale";
import { Segs } from "./rx";

/** Hero background for a recipe: its category gradient, or its photo when it has one. */
export function heroStyle(r: Pick<RecipeRow, "doc">, photoUrl?: string) {
  const h = catOf(r.doc.category).h;
  const s: Record<string, string | number> = { "--h": h };
  if (photoUrl) s.backgroundImage = `linear-gradient(0deg, transparent, transparent), url("${photoUrl}")`;
  return s as React.CSSProperties;
}

export function SrcLine({ r, f }: { r: RecipeRow; f: number }) {
  const bits: string[] = [r.source === "printed card" ? "Printed card" : r.source_url ? hostOf(r.source_url) : r.source === "photo" ? "Photo of a card" : r.source ?? "Saved"];
  const tb = timeBits(r.doc);
  if (tb.length) bits.push(tb.join(" + "));
  if (r.doc.yield) bits.push(servesLine(r.doc, f));
  return (
    <>
      {bits.map((b, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span><Segs segs={nowrapSegs(b)} /></span>
        </Fragment>
      ))}
    </>
  );
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "Web link"; } };

export function PantryChip({ r }: { r: RecipeRow }) {
  const p = pantryReport(r.doc, r.pantry);
  if (p.out.length) return <span className="pchip miss"><Ico n="cart" /><span>Missing {p.out.length}: {listWords(p.out)}</span></span>;
  if (p.unknown.length) return <span className="pchip miss"><Ico n="info" /><span>Not in Basil's list: {listWords(p.unknown)}</span></span>;
  if (p.low.length) return <span className="pchip miss"><Ico n="cart" /><span>Low on {listWords(p.low)}</span></span>;
  return <span className="pchip ok"><Ico n="check" /><span>You have everything</span></span>;
}

function RecipeCard({ r, photo, onOpen }: { r: RecipeRow; photo?: string; onOpen: () => void }) {
  const icon = catOf(r.doc.category).icon as IconName;
  return (
    <article
      className="card rcard" tabIndex={0} role="button" aria-label={`Open ${r.doc.title}`} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <div className={"ph" + (photo ? " hasimg" : "")} style={heroStyle(r, photo)}>
        <Glyph n={icon} />
        <span className="tcat">{r.doc.category}</span>
        <h3>{r.doc.title}</h3>
        <div className="src"><SrcLine r={r} f={1} /></div>
      </div>
      <div className="cbody">
        {r.doc.blurb ? <p className="blurb">{r.doc.blurb}</p> : null}
        {(r.doc.tags?.length ?? 0) > 0 && <div className="mrow">{r.doc.tags!.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
        <PantryChip r={r} />
      </div>
    </article>
  );
}

const PT = "America/Los_Angeles";
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: PT });

function FermentCard({ f, r, busy, onStep }: { f: FermentRow; r: RecipeRow | undefined; busy: boolean; onStep: (id: string, step: "taste" | "bottle" | "burp" | "finish") => void }) {
  const F = r?.doc.ferment;
  if (!r || !F) return null;
  const today = todayPacific();
  const day = dayDiff(today, pacificDay(f.started_at)) + 1;
  const maxD = Math.max(F.ready_days[1], day);
  if (f.state === "fermenting") {
    const ready = day >= F.check_from_day;
    const tasted = f.tasted_on === todayStr();
    const next = ready ? (tasted ? "Tasted. Bottle it when you like it." : "Taste today") : "Stir or swirl once today";
    return (
      <div className="card ferm">
        <div className="fhead">
          <div><h3>{r.doc.title}</h3><div className="muted">Started {startLabel(f.started_at)}</div></div>
          <div className="row"><span className="mchip">Day {day} of {F.ready_days[0]}–{F.ready_days[1]}</span><span className="mchip">{F.temp_f[0]}–{F.temp_f[1]}°F</span></div>
        </div>
        <div className="days" aria-hidden="true">
          {Array.from({ length: maxD }, (_, i) => <span key={i} className={"dot " + (i + 1 < day ? "done" : i + 1 === day ? "now" : "")} />)}
        </div>
        <div className={"next " + (tasted ? "good" : "")}><Ico n={tasted ? "check" : "bell"} size={20} /><span>{next}</span></div>
        <p className="muted">Basil reminds you each morning from day {F.check_from_day}.</p>
        <div className="row">
          {ready && <button className="btn soft" disabled={busy} onClick={() => onStep(f.id, "taste")}>{tasted ? "Tasted today" : "I tasted it"}</button>}
          <button className="btn primary" disabled={busy} onClick={() => onStep(f.id, "bottle")}>Bottle it</button>
        </div>
      </div>
    );
  }
  const b = pacificDay(f.bottled_at ?? f.started_at);
  const from = addDays(b, F.after_bottling.drink_within_days[0]);
  const by = addDays(b, F.after_bottling.drink_within_days[1]);
  const burped = f.burped_on === todayStr();
  return (
    <div className="card ferm">
      <div className="fhead">
        <div><h3>{r.doc.title}</h3><div className="muted">Bottled {fmtDate(b)}, in the fridge</div></div>
        <span className="mchip">Bottled</span>
      </div>
      <div className={"next " + (burped ? "good" : "")}><Ico n={burped ? "check" : "bell"} size={20} /><span>Burp daily, drink by {fmtDate(by)}</span></div>
      <p className="muted">Best between <span className="nw">{fmtDate(from)}</span> and <span className="nw">{fmtDate(by)}</span>. Basil reminds you each morning to burp the lids.</p>
      <div className="row">
        <button className="btn soft" disabled={busy} onClick={() => onStep(f.id, "burp")}>{burped ? "Burped today" : "I burped the bottles"}</button>
        <button className="btn" disabled={busy} onClick={() => onStep(f.id, "finish")}>All gone</button>
      </div>
    </div>
  );
}

interface HaRow { key: keyof HaSettings | "lights"; label: string; note?: string; off?: string }
const HA_ROWS: HaRow[] = [
  { key: "speaker", label: "Timers announce on the kitchen speakers", note: "Basil speaks on the HomePods through Home Assistant." },
  { key: "timer_push", label: "Basil sends a notification when a timer ends", note: "Signed Basil, so you see it even away from the kitchen." },
  { key: "voice", label: "Say next, back, repeat or timer to Hey Scout while cooking", note: "Works while cook mode is open." },
  { key: "kitchen_auto", label: "Open cook mode when you walk into the kitchen", off: "Not available yet: the room sensor reports unknown." },
  { key: "lights", label: "Turn on a Cooking lights scene", off: "Not available yet: Home Assistant has no Cooking scene." },
];

export function Library(props: {
  ov: Overview; photos: Record<string, string>; onOpen: (id: number) => void; onAdd: () => void;
  onFerment: (id: string, step: "taste" | "bottle" | "burp" | "finish") => Promise<void>; onSetting: (k: keyof HaSettings, v: boolean) => Promise<void>;
}) {
  const { ov, photos } = props;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [busy, setBusy] = useState(false);
  const cats = useMemo(() => ["All", ...Array.from(new Set(ov.recipes.map((r) => r.doc.category)))], [ov.recipes]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ov.recipes.filter((r) => (cat === "All" || r.doc.category === cat) && (!s || [r.doc.title, r.doc.category, r.doc.blurb ?? "", (r.doc.tags ?? []).join(" "), r.doc.ingredients.map((i) => i.name).join(" ")].join(" ").toLowerCase().includes(s)));
  }, [ov.recipes, q, cat]);
  const byId = (id: number) => ov.recipes.find((r) => r.id === id);
  const ferments = ov.ferments.filter((f) => f.state !== "done");

  return (
    <div>
      {ferments.length > 0 && (
        <>
          <h2 className="sect" style={{ marginTop: 6 }}>Ferments</h2>
          <div className="grid">
            {ferments.map((f) => (
              <FermentCard key={f.id} f={f} r={byId(f.recipe_id)} busy={busy} onStep={async (id, step) => { setBusy(true); try { await props.onFerment(id, step); } finally { setBusy(false); } }} />
            ))}
          </div>
        </>
      )}
      <div className="toolbar">
        <label className="search">
          <Ico n="search" />
          <input type="search" placeholder="Search recipes, ingredients, tags" aria-label="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <div className="chips">
          {cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      </div>
      {list.length ? (
        <div className="grid" id="lib-grid">
          {list.map((r) => <RecipeCard key={r.id} r={r} photo={r.photo_path ? photos[r.photo_path] : undefined} onOpen={() => props.onOpen(r.id)} />)}
        </div>
      ) : (
        <p className="muted" style={{ padding: "20px 4px" }}>
          {ov.recipes.length ? "No recipes match. Try a different word." : "No recipes yet."} Tap Add to save one from a photo or a link.
        </p>
      )}

      <h2 className="sect">Home Assistant</h2>
      <div className="card ha">
        <h3>Kitchen and Home Assistant</h3>
        {HA_ROWS.map((h) => {
          const off = !!h.off;
          const on = off ? false : !!ov.settings[h.key as keyof HaSettings];
          return (
            <div key={h.key} className={"hrow" + (off ? " off" : "")}>
              <span id={`lb-${h.key}`}>{h.label}<small>{off ? h.off : h.note}</small></span>
              <button
                className="hit" role="switch" aria-checked={on} aria-labelledby={`lb-${h.key}`} disabled={off}
                onClick={() => void props.onSetting(h.key as keyof HaSettings, !on)}
              >
                <span className="switch" aria-checked={on} aria-disabled={off} />
              </button>
            </div>
          );
        })}
      </div>

      {ov.legacy.length > 0 && (
        <>
          <h2 className="sect">Dinner ideas Basil has cooked up</h2>
          <p className="muted" style={{ marginBottom: 8 }}>These are quick ideas from the chef. Open them from the Pantry tab; they are not full recipes yet.</p>
          <div className="mrow">{ov.legacy.slice(0, 12).map((l) => <span key={l.name} className="tag">{l.name}</span>)}</div>
        </>
      )}
    </div>
  );
}

export function GroceriesList({ items, onToggle }: { items: GroceryRow[]; onToggle: (g: GroceryRow) => void }) {
  if (!items.length) return <p className="muted">Nothing here yet. Open a recipe and tap Add to groceries.</p>;
  return (
    <ul className="ing">
      {items.map((g) => (
        <li key={g.id}>
          <button className="irow" aria-pressed={false} onClick={() => onToggle(g)}>
            <span className="ibox"><Ico n="check" /></span>
            <span className="itext"><span className="iname">{g.name}</span>{g.recipe_title ? <span className="inote">For {g.recipe_title}</span> : null}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export { toast };
void call;
