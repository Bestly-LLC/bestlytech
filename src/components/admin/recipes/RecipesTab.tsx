import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { Ico } from "./Ico";
import { Library } from "./Library";
import { RecipePage } from "./RecipePage";
import { CookMode } from "./CookMode";
import { AddRecipeSheet } from "./AddRecipeSheet";
import { GroceriesSheet, HealthLogSheet, HealthSetupSheet, TimersBar } from "./Overlays";
import { hasHealthShortcut } from "./health";
import { unlockAudio, useTimers } from "./useTimers";
import { call, newWork, type GroceryRow, type HaSettings, type Overview, type RecipeCommand, type WorkState } from "./rx";
import { pantryReport } from "@/lib/recipes/pantry";
import { planOf, servesLine } from "@/lib/recipes/scale";
import type { HaStatus } from "@/lib/recipes/ha";

const EMPTY_SETTINGS: HaSettings = { speaker: true, timer_push: true, kitchen_auto: false, voice: true, lights: true };

/** The Recipes side of Kitchen: library, one recipe, cook mode, Add (photo or link), ferments, groceries and timers. */
export default function RecipesTab() {
  const [sp, setSp] = useSearchParams();
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ha, setHa] = useState<HaStatus | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [works, setWorks] = useState<Record<number, WorkState>>({});
  const [cooking, setCooking] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [presetLink, setPresetLink] = useState<string | null>(null);
  const [grocOpen, setGrocOpen] = useState(false);
  const [healthStage, setHealthStage] = useState<"closed" | "setup" | "log">("closed");
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches);
  const cmdRef = useRef<((c: RecipeCommand) => void) | null>(null);
  const signing = useRef<Set<string>>(new Set());

  const recipeId = Number(sp.get("recipe")) || null;
  const tm = useTimers({ speakerOn: (ov?.settings ?? EMPTY_SETTINGS).speaker });

  /* ---------- load ---------- */
  const load = useCallback(async () => {
    try {
      const o = await call<Overview>("recipes_overview");
      setOv(o); setErr(null);
      tm.hydrate(o.timers ?? [], o.now);
    } catch (e) { setErr((e as Error).message); }
    // What Home Assistant really has right now. If this call fails the two Home Assistant toggles show "did not answer", never "on".
    try { setHa(await call<HaStatus>("recipes_ha_status")); } catch { setHa(null); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
    const iv = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    const vis = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, [load]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  /* ---------- photos (private bucket, so signed links) ---------- */
  useEffect(() => {
    if (!ov) return;
    for (const r of ov.recipes) {
      const p = r.photo_path;
      if (!p || photos[p] || signing.current.has(p)) continue;
      signing.current.add(p);
      void supabase.storage.from("recipe-photos").createSignedUrl(p, 3600).then(({ data }) => {
        if (data?.signedUrl) setPhotos((cur) => ({ ...cur, [p]: data.signedUrl }));
        else signing.current.delete(p);
      });
    }
  }, [ov, photos]);

  /* ---------- voice commands from Hey Scout (only while cook mode is open) ---------- */
  useEffect(() => {
    const ch = supabase.channel("recipe-commands")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "recipe_commands" }, (pl) => {
        const c = pl.new as unknown as RecipeCommand;
        if (c?.id) cmdRef.current?.(c);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  /* ---------- URL: ?recipe=ID, ?cook=1, ?link=https://... ---------- */
  useEffect(() => {
    const link = sp.get("link");
    if (link) {
      setPresetLink(link); setAddOpen(true);
      setSp((prev) => { const n = new URLSearchParams(prev); n.delete("link"); return n; }, { replace: true });
    }
  }, [sp, setSp]);
  useEffect(() => {
    if (sp.get("cook") === "1" && recipeId && ov?.recipes.some((r) => r.id === recipeId)) {
      unlockAudio(); setCooking(true);
      setSp((prev) => { const n = new URLSearchParams(prev); n.delete("cook"); return n; }, { replace: true });
    }
  }, [sp, recipeId, ov, setSp]);
  // Start Cooking (button, iPad handoff or walk-in) turns the Cooking lights scene on. The database checks the toggle and that the scene exists.
  useEffect(() => {
    if (!cooking) return;
    void call("recipe_cook_lights").catch((e: Error) => toast.error(`The Cooking lights did not turn on. ${e.message}`));
  }, [cooking]);
  useEffect(() => {
    document.body.classList.toggle("cooking", cooking);
    return () => document.body.classList.remove("cooking");
  }, [cooking]);

  const openRecipe = (id: number | null) => {
    setSp((prev) => { const n = new URLSearchParams(prev); if (id) n.set("recipe", String(id)); else n.delete("recipe"); return n; });
  };

  const recipe = useMemo(() => ov?.recipes.find((r) => r.id === recipeId) ?? null, [ov, recipeId]);
  const work = recipe ? works[recipe.id] ?? newWork() : newWork();
  const setWork = (patch: Partial<WorkState>) => { if (recipe) setWorks((w) => ({ ...w, [recipe.id]: { ...(w[recipe.id] ?? newWork()), ...patch } })); };
  const fermenting = !!(recipe && ov?.ferments.some((f) => f.recipe_id === recipe.id && f.state !== "done"));
  const onList = useMemo(() => new Set((ov?.groceries ?? []).map((g) => g.name.toLowerCase())), [ov]);
  const onlyOnList = useMemo(() => {
    if (!recipe) return false;
    const buy = pantryReport(recipe.doc, recipe.pantry).toBuy;
    return buy.length > 0 && buy.every((n) => onList.has(n.toLowerCase()));
  }, [recipe, onList]);

  /* ---------- actions ---------- */
  const guard = async (what: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { toast.error(`${what} ${(e as Error).message}`); throw e; }
  };

  const onLog = async (note: string) => {
    if (!recipe) return;
    const pl = planOf(recipe.doc, work);
    await guard("Basil could not log that cook.", async () => {
      await call("recipe_cook_log", { p_id: recipe.id, p_factor: work.factor, p_summary: servesLine(recipe.doc, pl.eff) + (work.omni ? ", OmniCook" : ""), p_note: note, p_omni: work.omni });
      toast("Cook logged", { description: `${recipe.doc.title} is in your cook log.` });
      await load();
    });
  };
  const onPhoto = async (f: File) => {
    if (!recipe) return;
    try {
      const ext = /png/i.test(f.type) ? "png" : /webp/i.test(f.type) ? "webp" : "jpg";
      const path = `recipes/${recipe.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("recipe-photos").upload(path, f, { contentType: f.type || "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      await call("recipe_photo_set", { p_id: recipe.id, p_path: path });
      toast("Photo saved");
      await load();
    } catch (e) { toast.error(`Could not save the photo. ${(e as Error).message}`); }
  };
  const onNotes = (body: string) => { if (recipe) void call("recipe_notes_set", { p_id: recipe.id, p_body: body }).catch((e: Error) => toast.error(`Notes did not save. ${e.message}`)); };
  const onFermentStart = async () => {
    if (!recipe) return;
    await guard("Could not start the ferment.", async () => {
      await call("recipe_ferment_start", { p_recipe_id: recipe.id });
      const F = recipe.doc.ferment;
      toast("Ferment started", { description: F ? `Basil reminds you each morning from day ${F.check_from_day}.` : undefined });
      await load();
    });
  };
  const onFermentStep = async (id: string, step: "taste" | "bottle" | "burp" | "finish") => {
    await guard("Could not update the ferment.", async () => { await call("recipe_ferment_step", { p_id: id, p_step: step }); await load(); });
  };
  const onAddToGroceries = async (names: string[]) => {
    if (!recipe) return;
    await guard("Could not add to groceries.", async () => {
      const r = await call<{ added: number; open: number }>("recipe_groceries_add", { p_recipe_id: recipe.id, p_names: names });
      toast(r.added ? `Added ${r.added} to groceries` : "Already on the groceries list", { description: `${r.open} on the list` });
      await load();
    });
  };
  const onSendToIpad = async () => {
    if (!recipe) return;
    await guard("Could not send it.", async () => {
      await call("recipe_handoff_send", { p_kind: "cook", p_recipe_id: recipe.id, p_url: null, p_source: "iPhone" });
      toast("Sent to the iPad", { description: "It will ask to start cooking." });
    });
  };
  const onSetting = async (k: keyof HaSettings, v: boolean) => {
    setOv((o) => (o ? { ...o, settings: { ...o.settings, [k]: v } } : o));
    try { await call("recipes_settings_set", { p_key: k, p_value: v }); }
    catch (e) { toast.error(`Could not save that setting. ${(e as Error).message}`); await load(); }
  };
  const onGroceryDone = async (g: GroceryRow) => {
    setOv((o) => (o ? { ...o, groceries: o.groceries.filter((x) => x.id !== g.id) } : o));
    try { await call("pantry_groceries_set", { p_id: g.id, p_done: true }); }
    catch (e) { toast.error(`Could not update the list. ${(e as Error).message}`); await load(); }
  };
  const sendLinkToIpad = async (url: string) => {
    await call("recipe_handoff_send", { p_kind: "link", p_recipe_id: null, p_url: url, p_source: "iPhone" });
  };
  const onHealth = () => setHealthStage(hasHealthShortcut() ? "log" : "setup");

  /* ---------- render ---------- */
  const groceryCount = ov?.groceries.length ?? 0;
  return (
    <div className="rx" onPointerDownCapture={unlockAudio}>
      {!recipe && (
        <PageHeader
          title="Recipes"
          description="Saved recipes, ferments and the cook log. Basil keeps them with the pantry."
          actions={
            <>
              <button className="btn" onClick={() => setGrocOpen(true)}><Ico n="cart" size={20} />Groceries{groceryCount ? <span className="nw">{` (${groceryCount})`}</span> : null}</button>
              <button className="btn primary" onClick={() => { setPresetLink(null); setAddOpen(true); }}><Ico n="plus" size={20} />Add</button>
            </>
          }
        />
      )}

      {err && !ov && (
        <div className="hout err" role="alert">
          Could not load recipes. {err} <button className="btn" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {!ov && !err && <p className="muted" style={{ padding: "24px 4px" }}>Loading recipes</p>}

      {ov && !recipe && (
        <Library ov={ov} ha={ha} photos={photos} onOpen={openRecipe} onAdd={() => setAddOpen(true)} onFerment={onFermentStep} onSetting={onSetting} />
      )}
      {ov && recipeId && !recipe && (
        <p className="muted" style={{ padding: "24px 4px" }}>That recipe is not in the library. <button className="btn" onClick={() => openRecipe(null)}>Back to recipes</button></p>
      )}
      {ov && recipe && (
        <RecipePage
          r={recipe} photo={recipe.photo_path ? photos[recipe.photo_path] : undefined} work={work} setWork={setWork}
          phone={phone} onlyOnList={onlyOnList} fermenting={fermenting}
          onBack={() => openRecipe(null)} onCook={() => { unlockAudio(); setCooking(true); }}
          onPhoto={(f) => void onPhoto(f)} onNotes={onNotes} onLog={onLog}
          onFermentStart={onFermentStart} onAddToGroceries={onAddToGroceries} onSendToIpad={onSendToIpad}
          startTimer={(k, l, s, m, id) => void tm.start(k, l, s, m, id)} timers={tm.timers}
          onHealth={onHealth}
        />
      )}

      {ov && recipe && cooking && (
        <CookMode
          r={recipe} work={work} setWork={setWork} voiceOn={ov.settings.voice}
          onClose={() => setCooking(false)} onLog={async (n) => { await onLog(n); }}
          startTimer={(k, l, s, m, id) => void tm.start(k, l, s, m, id)} stopTimer={tm.stopLatest}
          onFermentStart={onFermentStart} register={(h) => { cmdRef.current = h; }}
        />
      )}

      <TimersBar timers={tm.timers} remaining={tm.remaining} onPlus={tm.plus} onStop={tm.stop} />
      <AddRecipeSheet
        open={addOpen} presetLink={presetLink} phone={phone}
        onClose={() => { setAddOpen(false); setPresetLink(null); }}
        onSaved={(name) => { setAddOpen(false); setPresetLink(null); toast("Recipe saved", { description: `${name} is in your library.` }); void load(); }}
        onSendLinkToIpad={sendLinkToIpad}
      />
      <GroceriesSheet open={grocOpen} items={ov?.groceries ?? []} onClose={() => setGrocOpen(false)} onDone={(g) => void onGroceryDone(g)} />
      <HealthSetupSheet open={healthStage === "setup"} onClose={() => setHealthStage("closed")} onGetShortcut={() => setHealthStage("log")} />
      <HealthLogSheet
        open={healthStage === "log"} n={recipe?.doc.nutrition ?? null} title={recipe?.doc.title ?? ""}
        onClose={() => setHealthStage("closed")} onLogged={(msg) => toast(msg)}
      />
    </div>
  );
}
