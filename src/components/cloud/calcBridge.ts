/**
 * Bridge between the Bestly Cloud savings calculator (InteractivePricingCalculator) and Maya.
 *
 * The calculator registers itself while it is on screen. Maya's cloud_calculator tool (presenter.ts) waits for it,
 * drives it like a person would (moves the slider, checks the apps the visitor pays for, flips billing and plan) and
 * reads back the exact numbers the page shows, so she never quotes a figure the visitor can't see.
 *
 * When the visitor changes the calculator by hand, it announces the new numbers as `maya:calc-changed`, and the Maya
 * screen passes them to her as context, so she keeps up with what they did.
 */

export type CalcChange = {
  teamSize?: number;
  /** Replace the checked apps with exactly these (names as the visitor says them). */
  only?: string[];
  add?: string[];
  remove?: string[];
  billing?: "annual" | "monthly";
  plan?: "managed" | "selfhosted";
};

export type CalcResult = {
  /** One plain paragraph for Maya, with every number as the page shows it. */
  say: string;
  /** Names the visitor gave that the calculator does not cover (Bestly Cloud does not replace them). */
  notCovered: string[];
};

export type CalcApi = {
  apply: (change: CalcChange) => Promise<CalcResult>;
  read: () => CalcResult;
  /** The block to bring into view and highlight. */
  element: () => HTMLElement | null;
};

let current: CalcApi | null = null;
let waiting: ((a: CalcApi) => void)[] = [];

export function registerCalc(api: CalcApi): () => void {
  current = api;
  const ws = waiting;
  waiting = [];
  ws.forEach((w) => w(api));
  return () => {
    if (current === api) current = null;
  };
}

/** The calculator if it is on screen now, or once it mounts (up to `ms`). */
export function getCalc(ms = 4000): Promise<CalcApi | null> {
  if (current) return Promise.resolve(current);
  return new Promise((resolve) => {
    const done = (a: CalcApi | null) => {
      clearTimeout(t);
      waiting = waiting.filter((w) => w !== ok);
      resolve(a);
    };
    const ok = (a: CalcApi) => done(a);
    const t = setTimeout(() => done(null), ms);
    waiting.push(ok);
  });
}

export const CALC_CHANGED = "maya:calc-changed";
