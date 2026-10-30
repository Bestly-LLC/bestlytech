import { useState } from "react";
import type { Nutrition } from "@/lib/recipes/types";

const DV = { protein_g: 50, carbs_g: 275, fat_g: 78, fiber_g: 28, sugar_g: 50, sodium_mg: 2300 } as const;
const pct = (v: number, dv: number) => Math.max(0, Math.min(100, Math.round((v / dv) * 100)));
const isIOS = () => typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

function Row({ label, v, unit, dv }: { label: string; v: number; unit: string; dv: number }) {
  return (
    <div className="nut-row">
      <span className="lb">{label}</span>
      <span className="val nw">{Math.round(v)} {unit}</span>
      <div className="bar"><i style={{ width: pct(v, dv) + "%" }} /></div>
    </div>
  );
}

/** Apple Health's own pink, not the Recipes tab's single accent: it is the signal that this button reaches Health. */
function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 22, height: 22, flex: "none" }}>
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 2.9 1.5-1.8 3.1-2.9 5.1-2.9 3.5 0 5.5 3.4 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="#ff5a6e" />
    </svg>
  );
}

/** Per-serving numbers never change with the servings stepper, so this reads straight off doc.nutrition, no scale factor involved. */
export function NutritionPanel({ n, onHealth }: { n?: Nutrition; onHealth?: () => void }) {
  const [more, setMore] = useState(false);
  if (!n) return null;
  const p = n.per_serving, isCard = n.source === "card";
  const per = `Per serving (1 ${n.serving_label})` + (isCard ? ", as printed on the card." : ". About, from the ingredients.");
  const foot = isCard
    ? "Numbers copied from the card. Changing how many it makes doesn't change one serving."
    : "Worked out from the ingredients with USDA food data. Changing how many it makes doesn't change one serving.";
  const showHealth = !!onHealth && isIOS();
  return (
    <div className="panel nut-panel">
      <div className="nut-head"><h2>Nutrition</h2><span className={"tag" + (isCard ? " card" : " est")}>{isCard ? "From the card" : "Estimated"}</span></div>
      <p className="nut-per muted">{per}</p>
      <div className="nut-cal"><b>{Math.round(p.kcal)}</b><span>Calories</span></div>
      <div className="nut-rows">
        <Row label="Protein" v={p.protein_g} unit="g" dv={DV.protein_g} />
        <Row label="Carbs" v={p.carbs_g} unit="g" dv={DV.carbs_g} />
        <Row label="Fat" v={p.fat_g} unit="g" dv={DV.fat_g} />
      </div>
      <button className="nut-more" type="button" onClick={() => setMore((x) => !x)} aria-expanded={more}>{more ? "Show less" : "Show more"}</button>
      {more && (
        <div className="nut-rows">
          <Row label="Fiber" v={p.fiber_g} unit="g" dv={DV.fiber_g} />
          <Row label="Sugar" v={p.sugar_g} unit="g" dv={DV.sugar_g} />
          <Row label="Sodium" v={p.sodium_mg} unit="mg" dv={DV.sodium_mg} />
        </div>
      )}
      <p className="nut-foot muted">{foot}</p>
      {n.low_confidence && <p className="nut-foot warn">Rough estimate: some ingredients were hard to read.</p>}
      {showHealth && <button className="btn primary nut-health" type="button" onClick={onHealth}><HeartIcon />Log to Health</button>}
    </div>
  );
}
