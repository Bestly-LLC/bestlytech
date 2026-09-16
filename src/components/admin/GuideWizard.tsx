import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, Loader2, Monitor, MousePointerClick, RotateCcw, Smartphone, Undo2, XCircle,
} from "lucide-react";

/*
 * Guide it: Jared shows the robot browser which buttons close a cookie banner.
 * The robot (cy-guide -> /api/cy-render, Frankfurt) loads the page and returns a screenshot
 * plus every clickable element. Tap one, label it, and either continue to the next screen
 * or test the whole sequence. Save re-tests server-side before the pattern goes live.
 */

type Action = "reject" | "necessary" | "accept" | "save" | "close" | "next";
type Box = { selector: string; text: string; x: number; y: number; w: number; h: number; likely: boolean; guess: Action | null };
type Step = { selector: string; text: string; action: Action };
type Inspect = { url: string; shot: string; vw: number; vh: number; elements: Box[]; failedStep: number | null; frames?: string[]; shadow?: boolean };
type TestResult = { dismissed: boolean; failedStep: number | null; before: string; after: string; saved?: boolean };

const ACTIONS: { value: Action; label: string; tone: string }[] = [
  { value: "reject", label: "Reject", tone: "emerald" },
  { value: "necessary", label: "Necessary only", tone: "emerald" },
  { value: "save", label: "Save choices", tone: "sky" },
  { value: "close", label: "Close", tone: "sky" },
  { value: "accept", label: "Accept", tone: "amber" },
  { value: "next", label: "Next step", tone: "violet" },
];
const actionLabel = (a: Action) => ACTIONS.find((x) => x.value === a)?.label ?? a;

async function callGuide<T>(body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke("cy-guide", { body });
  if (error) {
    let msg = error.message;
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep message */ }
    return { error: msg };
  }
  if ((data as any)?.error) return { error: (data as any).error };
  return { data: data as T };
}

export function GuideWizard({
  domain, startUrl, open, onOpenChange, onSaved,
}: {
  domain: string | null;
  startUrl?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Phone view by default on small screens: its buttons are big enough to tap in the screenshot.
  const [viewport, setViewport] = useState<"desktop" | "phone">(
    () => (typeof window !== "undefined" && window.innerWidth < 640 ? "phone" : "desktop"),
  );
  const [steps, setSteps] = useState<Step[]>([]);
  const [view, setView] = useState<Inspect | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Box | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [pendingFinal, setPendingFinal] = useState<Step | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);

  const inspect = useCallback(async (nextSteps: Step[], vp = viewport) => {
    if (!domain) return;
    setLoading(true); setError(null); setPicked(null); setAction(null); setTest(null); setPendingFinal(null);
    const { data, error: err } = await callGuide<Inspect>({
      action: "inspect", domain, url: startUrl || undefined, viewport: vp, steps: nextSteps.map((s) => ({ selector: s.selector })),
    });
    setLoading(false);
    if (err || !data) { setError(err ?? "No response"); return; }
    if (data.failedStep !== null && data.failedStep !== undefined) {
      setError(`The robot couldn't find step ${data.failedStep + 1} (“${nextSteps[data.failedStep]?.text || "button"}”) this time. Undo it and pick again.`);
    }
    setView(data);
    setShowAll(!data.elements.some((e) => e.likely));
  }, [domain, startUrl, viewport]);

  // Fresh start every time the wizard opens.
  useEffect(() => {
    if (open && domain) { setSteps([]); setView(null); inspect([], viewport); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, domain]);

  const pick = (b: Box) => { setPicked(b); setAction(b.guess); };

  const continueNext = () => {
    if (!picked) return;
    const next = [...steps, { selector: picked.selector, text: picked.text, action: "next" as Action }];
    setSteps(next);
    inspect(next);
  };

  const runTest = async () => {
    if (!picked || !action || action === "next" || !domain) return;
    const final: Step = { selector: picked.selector, text: picked.text, action };
    const all = [...steps, final];
    setBusy("test"); setError(null);
    const { data, error: err } = await callGuide<TestResult>({ action: "test", domain, url: startUrl || undefined, viewport, steps: all });
    setBusy(null);
    if (err || !data) { setError(err ?? "No response"); return; }
    setPendingFinal(final);
    setTest(data);
  };

  const save = async (force = false) => {
    if (!pendingFinal || !domain) return;
    setBusy("save"); setError(null);
    const all = [...steps, pendingFinal];
    const { data, error: err } = await callGuide<TestResult>({ action: "save", domain, url: startUrl || undefined, viewport, steps: all, force });
    setBusy(null);
    if (err || !data) { setError(err ?? "No response"); return; }
    if (!data.saved) { setTest(data); setError("The robot's re-test didn't close the banner, so nothing was saved."); return; }
    toast.success(`${domain} fixed`, {
      description: all.length > 1
        ? `Saved ${all.length} clicks, robot-tested. The extension replays sequences once it supports them.`
        : `Saved: ${actionLabel(pendingFinal.action)} on “${pendingFinal.text || pendingFinal.selector}”.${data.dismissed ? " Robot-tested." : ""}`,
    });
    onSaved();
    onOpenChange(false);
  };

  const undo = () => {
    const next = steps.slice(0, -1);
    setSteps(next);
    inspect(next);
  };

  const switchViewport = (vp: "desktop" | "phone") => {
    if (vp === viewport) return;
    setViewport(vp);
    setSteps([]);
    inspect([], vp);
  };

  const boxes = useMemo(() => (view?.elements ?? []).filter((b) => showAll || b.likely), [view, showAll]);
  const phone = viewport === "phone";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[calc(100vw-1rem)] h-[calc(100dvh-1rem)] sm:h-[92vh] p-0 gap-0 flex flex-col overflow-hidden border-white/10 bg-[#0b0d12]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 pr-12">
          <MousePointerClick className="h-5 w-5 text-cyan-300 flex-none" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[0.9375rem] font-semibold text-white truncate">Guide the robot · {domain}</DialogTitle>
            <DialogDescription className="text-xs text-white/55 truncate">
              Tap the button that closes the banner. The robot clicks it on the real page.
            </DialogDescription>
          </div>
          <div className="hidden sm:flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Screen size">
            {(["desktop", "phone"] as const).map((vp) => (
              <button key={vp} type="button" onClick={() => switchViewport(vp)} disabled={loading || !!busy}
                aria-pressed={viewport === vp}
                className={`flex items-center gap-1.5 rounded-md px-2.5 h-8 text-xs ${viewport === vp ? "bg-white/10 text-white" : "text-white/55 hover:text-white"}`}>
                {vp === "desktop" ? <Monitor className="h-3.5 w-3.5" aria-hidden="true" /> : <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />}
                {vp === "desktop" ? "Desktop" : "Phone"}
              </button>
            ))}
          </div>
        </div>

        {/* Step trail */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-white/[0.06] px-4 py-2 text-xs">
          <span className="text-white/55 flex-none">Clicks:</span>
          {steps.length === 0 && !(pendingFinal && test) && <span className="text-white/45 flex-none">none yet</span>}
          {steps.map((s, i) => (
            <span key={i} className="flex-none flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-1 text-violet-200">
              {i + 1}. {s.text || "button"} <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </span>
          ))}
          {pendingFinal && test && (
            <span className="flex-none rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
              {steps.length + 1}. {pendingFinal.text || "button"} · {actionLabel(pendingFinal.action)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1 flex-none">
            <button type="button" onClick={() => switchViewport(phone ? "desktop" : "phone")} disabled={loading || !!busy}
              className="sm:hidden flex items-center gap-1 rounded-md px-2 h-8 text-white/60 hover:text-white">
              {phone ? <Monitor className="h-3.5 w-3.5" aria-hidden="true" /> : <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />}
              {phone ? "Desktop" : "Phone"}
            </button>
            {steps.length > 0 && !test && (
              <Button size="sm" variant="ghost" className="h-8 text-white/70 hover:text-white" onClick={undo} disabled={loading}>
                <Undo2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Undo
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        {test ? (
          <TestView
            test={test} final={pendingFinal!} steps={steps} phone={phone} busy={busy} error={error}
            onBack={() => { setTest(null); setPendingFinal(null); setError(null); }}
            onSave={() => save(false)} onSaveAnyway={() => save(true)}
          />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
            {/* Screenshot with tappable boxes */}
            <div className="relative flex-1 min-h-0 overflow-auto bg-black/40 p-3">
              {view ? (
                <div className={`relative mx-auto ${phone ? "max-w-[24rem]" : "max-w-full"}`}>
                  <img src={`data:image/jpeg;base64,${view.shot}`} alt={`Screenshot of ${domain}`} className="block w-full h-auto rounded-md select-none" draggable={false} />
                  {!loading && boxes.map((b) => {
                    const on = picked?.selector === b.selector;
                    return (
                      <button
                        key={b.selector} type="button" onClick={() => pick(b)}
                        aria-label={`Pick “${b.text || b.selector}”`}
                        style={{ left: `${(b.x / view.vw) * 100}%`, top: `${(b.y / view.vh) * 100}%`, width: `${(b.w / view.vw) * 100}%`, height: `${(b.h / view.vh) * 100}%` }}
                        className={`absolute rounded-sm transition ${on
                          ? "ring-[0.1875rem] ring-cyan-300 bg-cyan-300/25"
                          : b.likely ? "ring-2 ring-cyan-400/80 bg-cyan-400/10 hover:bg-cyan-400/25" : "ring-1 ring-white/50 bg-white/5 hover:bg-white/20"}`}
                      />
                    );
                  })}
                </div>
              ) : !error && (
                <div className="h-full grid place-items-center text-sm text-white/60">Starting the robot browser…</div>
              )}
              {loading && (
                <div className="absolute inset-0 grid place-items-center bg-black/55">
                  <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-sm text-white">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Robot is loading the page, about 10 seconds
                  </div>
                </div>
              )}
            </div>

            {/* Side panel: selection + list */}
            <aside className="lg:w-[22rem] flex-none border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col min-h-0 max-h-[45dvh] lg:max-h-none">
              <div className="p-4 space-y-3 border-b border-white/[0.06]">
                {error && (
                  <div role="alert" className="flex gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3 text-xs text-red-200">
                    <AlertTriangle className="h-4 w-4 flex-none" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p>{error}</p>
                      <button type="button" className="mt-1.5 underline" onClick={() => inspect(steps)}>Try again</button>
                    </div>
                  </div>
                )}
                {picked ? (
                  <>
                    <p className="text-sm text-white">
                      <span className="text-white/55">Picked </span>“{picked.text || "unlabeled button"}”
                    </p>
                    <div>
                      <p className="text-xs text-white/55 mb-1.5">What does it do?</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ACTIONS.map((a) => (
                          <button key={a.value} type="button" onClick={() => setAction(a.value)} aria-pressed={action === a.value}
                            className={`h-8 rounded-full border px-3 text-xs transition ${action === a.value
                              ? "border-cyan-300 bg-cyan-300/15 text-white"
                              : "border-white/15 text-white/70 hover:text-white hover:border-white/30"}`}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                      {action === "accept" && <p className="text-[0.6875rem] text-amber-200/80 mt-1.5">Accept means users agree to tracking. Use it only if there's no reject or necessary-only option.</p>}
                    </div>
                    {action === "next" ? (
                      <Button className="w-full h-10" onClick={continueNext} disabled={loading || steps.length >= 5}>
                        Click it and show the next screen <ArrowRight className="h-4 w-4 ml-1.5" aria-hidden="true" />
                      </Button>
                    ) : (
                      <Button className="w-full h-10" onClick={runTest} disabled={!action || loading || busy === "test"}>
                        {busy === "test"
                          ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> Robot is testing, about 15 seconds</>
                          : <>Test this fix</>}
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-white/65">
                    {view && !loading
                      ? view.elements.length ? "Tap a highlighted box, or pick from the list." : "No buttons found on this screen."
                      : " "}
                  </p>
                )}
                {view && (view.frames?.length || view.shadow) && !loading ? (
                  <p className="text-[0.6875rem] text-white/50">
                    This banner may live in an embedded frame the robot can't click. If its buttons aren't outlined, use Report a missed banner instead.
                  </p>
                ) : null}
              </div>

              {view && !loading && view.elements.length > 0 && (
                <div className="flex-1 min-h-0 overflow-y-auto p-2">
                  <div className="flex items-center justify-between px-2 py-1">
                    <p className="text-xs text-white/55">{showAll ? "All buttons" : "Banner buttons"}</p>
                    <button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? "Banner only" : `Show all ${view.elements.length}`}
                    </button>
                  </div>
                  <ul>
                    {boxes.map((b) => (
                      <li key={b.selector}>
                        <button type="button" onClick={() => pick(b)}
                          className={`w-full text-left rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${picked?.selector === b.selector ? "bg-cyan-300/15 text-white" : "text-white/75 hover:bg-white/5"}`}>
                          <span className="min-w-0 flex-1 truncate">{b.text || <span className="text-white/45">{b.selector}</span>}</span>
                          {b.guess && <span className="text-[0.6875rem] text-white/45 flex-none">{actionLabel(b.guess)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TestView({
  test, final, steps, phone, busy, error, onBack, onSave, onSaveAnyway,
}: {
  test: TestResult; final: Step; steps: Step[]; phone: boolean; busy: "test" | "save" | null; error: string | null;
  onBack: () => void; onSave: () => void; onSaveAnyway: () => void;
}) {
  const total = steps.length + 1;
  const stuckAt = test.failedStep;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${test.dismissed ? "border-emerald-500/25 bg-emerald-500/[0.07]" : "border-red-500/25 bg-red-500/[0.07]"}`}>
        {test.dismissed
          ? <CheckCircle2 className="h-5 w-5 text-emerald-300 flex-none mt-0.5" aria-hidden="true" />
          : <XCircle className="h-5 w-5 text-red-300 flex-none mt-0.5" aria-hidden="true" />}
        <div className="text-sm">
          <p className={`font-semibold ${test.dismissed ? "text-emerald-100" : "text-red-100"}`}>
            {test.dismissed ? "Banner gone. This fix works." : stuckAt !== null ? `The robot couldn't find click ${stuckAt + 1} on a fresh load.` : "The banner was still there after the clicks."}
          </p>
          <p className="text-xs text-white/60 mt-0.5">
            {total} click{total === 1 ? "" : "s"}, ending with {actionLabel(final.action)} on “{final.text || "button"}”.
            {total > 1 && " Multi-screen fixes need the extension's sequence support to play back for users."}
          </p>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-red-200">{error}</p>}

      <div className={`grid gap-3 ${phone ? "grid-cols-2 max-w-[40rem]" : "sm:grid-cols-2"}`}>
        {(["before", "after"] as const).map((k) => (
          <figure key={k} className="space-y-1.5">
            <figcaption className="text-xs text-white/55">{k === "before" ? "Before" : "After the clicks"}</figcaption>
            <img src={`data:image/jpeg;base64,${test[k]}`} alt={`${k} screenshot`} className="w-full h-auto rounded-md border border-white/10" />
          </figure>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 sticky bottom-0 bg-[#0b0d12] py-2">
        {test.dismissed ? (
          <Button className="h-10" onClick={onSave} disabled={!!busy}>
            {busy === "save" ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> Re-testing and saving</> : "Save fix for everyone"}
          </Button>
        ) : (
          <Button className="h-10" onClick={onBack} disabled={!!busy}>
            <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" /> Pick a different button
          </Button>
        )}
        {test.dismissed ? (
          <Button variant="ghost" className="h-10 text-white/70 hover:text-white" onClick={onBack} disabled={!!busy}>
            <RotateCcw className="h-4 w-4 mr-1.5" aria-hidden="true" /> Back
          </Button>
        ) : (
          <Button variant="ghost" className="h-10 text-white/60 hover:text-white" onClick={onSaveAnyway} disabled={!!busy}>
            {busy === "save" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> : null}
            Save anyway (low confidence)
          </Button>
        )}
      </div>
    </div>
  );
}
