import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CalendarCheck, Check, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createFillGuard, describeForm, noteManualEdit, registerForm, runSteps, spoken,
  type FillStep, type FormApi,
} from "@/components/maya/formBridge";
import { INTEGRATIONS, searchIntegrations } from "@/components/agentDemo/integrations";
import { KICKOFF_URL } from "@/lib/kickoff";

/**
 * /agent/welcome?o=<token>: where a buyer lands after paying for Bestly Agent (docs/maya-sales-opusplan.md, part 7).
 * Talks to the agent-onboard edge function (token-bound, like /intake/:token). The page registers itself with formBridge as
 * "agent-setup", so Maya's agent_setup tool can fill it live; the visitor can always type instead.
 * States: waiting for the payment to confirm, the nine questions, "answers are in" with the kickoff button, or a plain dead end.
 */
const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-onboard`;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const PHONE_DISPLAY = "(213) 641-0074";
const PHONE_TEL = "tel:+12136410074";
const nw = (s: string) => <span className="whitespace-nowrap">{s}</span>;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Answers = {
  company: string; website: string; current_phone: string; phone_plan: "" | "forward" | "new"; hours: string; timezone: string;
  call_goal: string[]; transfer_name: string; transfer_phone: string; apps: string[]; faqs: string; never: string;
  voice: "" | "warm" | "calm" | "upbeat"; agent_name: string;
};
const EMPTY: Answers = {
  company: "", website: "", current_phone: "", phone_plan: "", hours: "", timezone: "", call_goal: [], transfer_name: "",
  transfer_phone: "", apps: [], faqs: "", never: "", voice: "", agent_name: "Maya",
};
type Order = { plan: string; plan_name: string; price: string | null; company: string | null; first_name: string | null; status: string; setup: Partial<Answers>; setup_done_at: string | null };
type Load = "loading" | "notfound" | "error" | "pending" | "slow" | "ready" | "done" | "inactive";

const GOALS: { id: string; label: string }[] = [
  { id: "book", label: "Book an appointment" },
  { id: "message", label: "Take a message" },
  { id: "ticket", label: "Open a ticket" },
  { id: "transfer", label: "Transfer to a person" },
];
const VOICES: { id: "warm" | "calm" | "upbeat"; label: string }[] = [
  { id: "warm", label: "Warm" }, { id: "calm", label: "Calm" }, { id: "upbeat", label: "Upbeat" },
];
const ZONES = ["Pacific Time", "Mountain Time", "Central Time", "Eastern Time", "Alaska Time", "Hawaii Time", "Arizona Time"];
const FIELD_ID = {
  company: "setup_company", website: "setup_website", current_phone: "setup_current_phone", hours: "setup_hours", timezone: "setup_timezone",
  transfer_name: "setup_transfer_name", transfer_phone: "setup_transfer_phone", faqs: "setup_faqs", never: "setup_never", agent_name: "setup_agent_name",
} as const;

/** "book an appointment, take messages" -> ["book", "message"]. */
function goalsFrom(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  if (/book|appoint|schedul|reserv/.test(t)) out.push("book");
  if (/message|voicemail/.test(t)) out.push("message");
  if (/ticket|case|request/.test(t)) out.push("ticket");
  if (/transfer|person|human|forward|hand ?off|connect/.test(t)) out.push("transfer");
  return out;
}

const timeNow = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const inputCls = "mt-1.5 h-11";
const labelCls = "block text-sm font-medium text-foreground";

function Row({ n, title, hint, required, children }: { n: number; title: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`q${n}`} className="rounded-2xl border border-border bg-card p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{n}</span>
        <div className="min-w-0 flex-1">
          <h2 id={`q${n}`} className="font-modern text-lg font-semibold tracking-[-0.012em] text-foreground sm:text-xl">
            {title}
            {required && <span className="ml-2 align-middle text-xs font-semibold uppercase tracking-wider text-primary">Required</span>}
          </h2>
          {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div className="mt-5 space-y-5 sm:pl-10">{children}</div>
    </section>
  );
}

function Choice({ type, name, checked, onChange, children, id }: { type: "radio" | "checkbox"; name: string; checked: boolean; onChange: () => void; children: React.ReactNode; id?: string }) {
  return (
    <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-foreground transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 motion-reduce:transition-none ${checked ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-secondary/60"}`}>
      <input id={id} type={type} name={name} checked={checked} onChange={onChange} className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))] focus-visible:outline-none" />
      <span>{children}</span>
    </label>
  );
}

export default function AgentWelcome() {
  const [params] = useSearchParams();
  const token = params.get("o") ?? "";
  const [load, setLoad] = useState<Load>(token ? "loading" : "notfound");
  const [order, setOrder] = useState<Order | null>(null);
  const [a, setA] = useState<Answers>(EMPTY);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [appQuery, setAppQuery] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const live = useRef({ a, load });
  live.current = { a, load };
  const guard = useRef(createFillGuard()).current;
  const waiter = useRef<((r: { ok: boolean; say: string }) => void) | null>(null);
  const dirty = useRef<Partial<Answers>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const inflight = useRef(false);

  // ---- load, and wait for the payment to confirm ----
  const fetchOrder = useCallback(async (): Promise<Order | "notfound" | "error"> => {
    try {
      const r = await fetch(`${FN}?token=${encodeURIComponent(token)}`, { headers: { apikey: KEY } });
      if (r.status === 404) return "notfound";
      if (!r.ok) return "error";
      const j = await r.json();
      return j?.ok ? (j.order as Order) : "error";
    } catch {
      return "error";
    }
  }, [token]);

  const apply = useCallback((o: Order) => {
    setOrder(o);
    if (o.status === "setup_done") setLoad("done");
    else if (o.status === "paid") {
      setA((prev) => ({ ...EMPTY, ...prev, ...(o.setup as Partial<Answers>), company: (o.setup.company as string) || o.company || "" }));
      setLoad("ready");
    } else if (o.status === "checkout_started") setLoad("pending");
    else setLoad("inactive");
  }, []);

  useEffect(() => {
    if (!token) return;
    let stop = false;
    (async () => {
      const t0 = Date.now();
      for (;;) {
        const r = await fetchOrder();
        if (stop) return;
        if (r === "notfound") { setLoad("notfound"); return; }
        if (r === "error") { setLoad("error"); return; }
        apply(r);
        if (r.status !== "checkout_started") return;
        if (Date.now() - t0 > 60_000) { setLoad("slow"); return; }
        await wait(5000);
        if (stop) return;
      }
    })();
    return () => { stop = true; };
  }, [token, fetchOrder, apply]);

  // ---- auto-save (700 ms after the last change) ----
  const flush = useCallback(async () => {
    if (inflight.current || live.current.load !== "ready") return;
    const data = dirty.current;
    if (!Object.keys(data).length) return;
    dirty.current = {};
    inflight.current = true;
    try {
      const r = await fetch(FN, { method: "PATCH", headers: { "Content-Type": "application/json", apikey: KEY }, body: JSON.stringify({ token, data }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        dirty.current = { ...data, ...dirty.current };
        setSaveErr("We couldn't save just now. Your answers are still here. We'll try again.");
      } else {
        setSaveErr(null);
        setSavedAt(timeNow());
      }
    } catch {
      dirty.current = { ...data, ...dirty.current };
      setSaveErr("We couldn't save just now. Your answers are still here. We'll try again.");
    } finally {
      inflight.current = false;
      if (Object.keys(dirty.current).length) { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => void flush(), 4000); }
    }
  }, [token]);

  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => {
    setA((p) => ({ ...p, [k]: v }));
    dirty.current = { ...dirty.current, [k]: v };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 700);
  };

  // ---- reading the form (for Maya and for validation) ----
  const valueOf = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  const readNow = (): { say: string; missing: string[] } => {
    const cur = live.current.a;
    const company = valueOf(FIELD_ID.company), phone = valueOf(FIELD_ID.current_phone);
    const missing: string[] = [];
    if (!company.trim()) missing.push("business name");
    if (!phone.trim()) missing.push("the phone number callers use");
    if (!cur.call_goal.length) missing.push("what most calls should end in");
    const goals = cur.call_goal.map((g) => GOALS.find((x) => x.id === g)?.label.toLowerCase() ?? g).join(", ");
    const say = describeForm(
      [
        { label: "business name", value: company },
        { label: "website", value: valueOf(FIELD_ID.website) },
        { label: "phone number callers use", value: phone ? spoken("phone", phone) : "" },
        { label: "phone plan", value: cur.phone_plan === "forward" ? "forward the current number" : cur.phone_plan === "new" ? "get a new number" : "" },
        { label: "hours", value: valueOf(FIELD_ID.hours) },
        { label: "time zone", value: valueOf(FIELD_ID.timezone) },
        { label: "calls end in", value: goals },
        { label: "transfer to", value: valueOf(FIELD_ID.transfer_name) },
        { label: "transfer number", value: valueOf(FIELD_ID.transfer_phone) ? spoken("phone", valueOf(FIELD_ID.transfer_phone)) : "" },
        { label: "apps", value: cur.apps.join(", ") },
        { label: "common questions", value: valueOf(FIELD_ID.faqs) },
        { label: "never say or do", value: valueOf(FIELD_ID.never) },
        { label: "voice", value: cur.voice },
        { label: "agent name", value: valueOf(FIELD_ID.agent_name) },
      ],
      missing,
      ["website", "phone plan", "hours", "time zone", "transfer to", "apps", "common questions", "never say or do", "voice"],
    );
    return { say, missing };
  };

  // ---- submit ----
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finish = (r: { ok: boolean; say: string }) => { const w = waiter.current; waiter.current = null; w?.(r); };
    if (sending) return;
    const miss = readNow().missing;
    if (miss.length) {
      setSendErr(`Please add ${miss.join(", ")}.`);
      finish({ ok: false, say: `Not sent yet. Still needed: ${miss.join(", ")}.` });
      return;
    }
    setSendErr(null);
    setSending(true);
    try {
      clearTimeout(saveTimer.current);
      // Make sure everything typed is saved first; the server submits what it has.
      dirty.current = { ...dirty.current, ...live.current.a };
      for (let i = 0; i < 20 && inflight.current; i++) await wait(100);
      await flush();
      const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY }, body: JSON.stringify({ token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        setSendErr(typeof j?.error === "string" && j.error ? j.error : `We couldn't send that. Try again, or call ${PHONE_DISPLAY}.`);
        finish({ ok: false, say: `The site couldn't send it just now. Offer to try once more, or they can call ${PHONE_DISPLAY}.` });
        return;
      }
      setLoad("done");
      window.scrollTo({ top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      finish({ ok: true, say: "Sent. Their setup answers are with the team, and the page now offers a Book your kickoff call button. Point them to it." });
    } catch {
      setSendErr(`We couldn't send that. Try again, or call ${PHONE_DISPLAY}.`);
      finish({ ok: false, say: `The site couldn't send it just now. Offer to try once more, or they can call ${PHONE_DISPLAY}.` });
    } finally {
      setSending(false);
    }
  }

  // ---- Maya (formBridge.ts): agent_setup fills this form, then presses Send after a clear yes ----
  useEffect(() => {
    if (load !== "ready") return;
    const api: FormApi = {
      id: "agent-setup",
      element: () => formRef.current,
      read: () => readNow(),
      fill: async (v) => {
        if (live.current.load !== "ready" || !formRef.current) return { say: "The setup form isn't on screen right now.", missing: [] };
        const one = (k: keyof typeof v, max: number) => (v[k] == null ? undefined : String(v[k]).replace(/\s+/g, " ").trim().slice(0, max));
        const many = (k: keyof typeof v, max: number) => (v[k] == null ? undefined : String(v[k]).replace(/\r\n?/g, "\n").trim().slice(0, max));
        const steps: FillStep[] = [];
        const text = (key: keyof typeof FIELD_ID, label: string, next: string | undefined) => {
          if (!next) return;
          const id = FIELD_ID[key];
          steps.push({ id, label, el: () => document.getElementById(id), get: () => valueOf(id), next, text: true });
        };
        text("company", "business name", one("company", 120));
        text("website", "website", one("website", 200));
        text("current_phone", "phone number callers use", one("current_phone", 40));
        text("hours", "hours", one("hours", 400));
        text("timezone", "time zone", one("timezone", 60));
        text("transfer_name", "transfer to", one("transfer_name", 100));
        text("transfer_phone", "transfer number", one("transfer_phone", 40));
        text("faqs", "common questions", many("faqs", 4000));
        text("never", "never say or do", many("never", 2000));
        text("agent_name", "agent name", one("agent_name", 60));

        const pick = (id: string, label: string, next: string | undefined, get: () => string, apply: (s: string) => void) => {
          if (!next) return;
          steps.push({ id, label, el: () => document.getElementById(`${id}_group`), get, next, text: false, apply });
        };
        const plan = one("phone_plan", 60)?.toLowerCase();
        const planId = plan ? (/new|different|get a|another/.test(plan) ? "new" : /forward|keep|existing|current|same|port/.test(plan) ? "forward" : "") : undefined;
        pick("phone_plan", "phone plan", planId || undefined, () => live.current.a.phone_plan, (s) => set("phone_plan", s as Answers["phone_plan"]));
        const voice = one("voice", 60)?.toLowerCase();
        const voiceId = voice ? (VOICES.find((x) => voice.includes(x.id))?.id ?? "") : undefined;
        pick("voice", "voice", voiceId || undefined, () => live.current.a.voice, (s) => set("voice", s as Answers["voice"]));
        const goals = one("call_goal", 200);
        const goalIds = goals ? goalsFrom(goals) : [];
        if (goalIds.length) pick("call_goal", "what calls end in", goalIds.join(","), () => live.current.a.call_goal.join(","), (s) => set("call_goal", s.split(",")));
        const apps = many("apps", 1500);
        if (apps) {
          const list = [...new Set(apps.split(/[,\n;]/).map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 40);
          if (list.length) pick("apps", "apps", list.join("\u0001"), () => live.current.a.apps.join("\u0001"), (s) => set("apps", s.split("\u0001")));
        }

        const out = await runSteps(guard, steps);
        await wait(40);
        const r = readNow();
        const bits = [
          out.filled.length ? `Typed into the form: ${out.filled.join(", ")}.` : "Nothing new to type.",
          out.replaced.length ? `That replaced what the visitor had typed in ${out.replaced.join(", ")}; say so.` : "",
          out.kept.length ? `Left ${out.kept.join(", ")} as the visitor typed it.` : "",
          r.say,
        ];
        return { say: bits.filter(Boolean).join(" "), missing: r.missing };
      },
      submit: async () => {
        if (live.current.load === "done") return { ok: false, say: "Their setup answers were already sent." };
        const r = readNow();
        if (r.missing.length) return { ok: false, say: `Not sent yet. Still needed: ${r.missing.join(", ")}.` };
        const formEl = formRef.current;
        if (!formEl) return { ok: false, say: "The form isn't on screen right now." };
        if (waiter.current) return { ok: false, say: "It is already sending." };
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (waiter.current === done) { waiter.current = null; resolve({ ok: false, say: "It didn't confirm in time. Ask the visitor to check the page, or try once more." }); }
          }, 15000);
          const done = (res: { ok: boolean; say: string }) => { clearTimeout(timer); resolve(res); };
          waiter.current = done;
          formEl.requestSubmit();
        });
      },
    };
    return registerForm(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // ---- the apps picker ----
  const matches = useMemo(() => {
    const q = appQuery.trim();
    if (!q) return [] as string[];
    const names = searchIntegrations(q, INTEGRATIONS).flatMap((g) => g.names);
    const have = new Set(a.apps.map((x) => x.toLowerCase()));
    return [...new Set(names)].filter((n) => !have.has(n.toLowerCase())).slice(0, 8);
  }, [appQuery, a.apps]);
  const addApp = (name: string) => {
    const n = name.trim().slice(0, 60);
    if (!n || a.apps.some((x) => x.toLowerCase() === n.toLowerCase()) || a.apps.length >= 40) return;
    set("apps", [...a.apps, n]);
    noteManualEdit(guard, "apps", () => readNow().say);
    setAppQuery("");
  };

  const textProps = (key: keyof typeof FIELD_ID, field: keyof Answers) => ({
    id: FIELD_ID[key],
    value: a[field] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      set(field, e.target.value as never);
      noteManualEdit(guard, FIELD_ID[key], () => readNow().say);
    },
  });

  // ---------- the screens ----------
  const head = (
    <Helmet>
      <title>Set up your Bestly Agent | Bestly</title>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="referrer" content="no-referrer" />
    </Helmet>
  );
  const shell = (children: React.ReactNode) => (
    <div className="bg-background">
      {head}
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">{children}</div>
    </div>
  );

  if (load === "loading") {
    return shell(
      <p role="status" className="flex items-center gap-3 text-lg text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Opening your setup page</p>,
    );
  }
  if (load === "notfound" || load === "error" || load === "inactive") {
    return shell(
      <div>
        <h1 className="font-modern text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
          {load === "error" ? "We couldn't open your setup page." : load === "inactive" ? "This order isn't active." : "This link isn't working."}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          {load === "error"
            ? "Try again in a minute."
            : load === "inactive" ? "If that's a surprise, we're glad to help."
            : "Use the button in the email we sent after you paid. It has your private link."}{" "}
          Or call us at <a href={PHONE_TEL} className="whitespace-nowrap font-semibold text-foreground underline underline-offset-4">{PHONE_DISPLAY}</a>.
        </p>
      </div>,
    );
  }
  if (load === "pending" || load === "slow") {
    return shell(
      <div>
        <h1 className="font-modern text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
          {load === "pending" ? "Confirming your payment." : "Payment is still confirming."}
        </h1>
        <p role="status" className="mt-4 flex items-start gap-3 text-lg text-muted-foreground">
          {load === "pending" && <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          <span>
            {load === "pending"
              ? "This usually takes a few seconds. Keep this page open."
              : "You'll get an email in a minute with a link back to this page. If it doesn't come, call us and we'll sort it out."}
            {load === "slow" && <> <a href={PHONE_TEL} className="whitespace-nowrap font-semibold text-foreground underline underline-offset-4">{PHONE_DISPLAY}</a>.</>}
          </span>
        </p>
        {load === "slow" && <Button className="mt-6 min-h-[44px]" variant="outline" onClick={() => window.location.reload()}>Check again</Button>}
      </div>,
    );
  }
  if (load === "done") {
    return shell(
      <div>
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-primary"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Answers received</p>
        <h1 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">Thank you. Now we build your agent.</h1>
        <p className="mt-4 text-lg text-muted-foreground">We have everything we need to start. Want to talk it through first? Book a short kickoff call.</p>
        <Button size="lg" className="mt-6 min-h-[48px]" asChild>
          <a href={KICKOFF_URL} target="_blank" rel="noopener noreferrer"><CalendarCheck className="mr-2 h-4 w-4" aria-hidden="true" /> Book your kickoff call</a>
        </Button>
        <h2 className="mt-12 font-modern text-xl font-semibold tracking-[-0.012em] text-foreground">What happens next</h2>
        <ol className="mt-4 space-y-3">
          {[
            ["We build it.", "We set up your agent, connect your phone and your apps, and run practice calls."],
            ["You try her.", "Call her yourself and tell us anything you'd change."],
            ["She goes live.", "Usually within a few days."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-2xl border border-border bg-card p-5">
              <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
              <p className="text-foreground"><strong className="font-semibold">{t}</strong> <span className="text-muted-foreground">{d}</span></p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-muted-foreground">
          Questions? Call <a href={PHONE_TEL} className="whitespace-nowrap font-semibold text-foreground underline underline-offset-4">{PHONE_DISPLAY}</a> or reply to your welcome email. Your 30-day money-back promise is in that email too.
        </p>
      </div>,
    );
  }

  // ready: the nine questions
  return shell(
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-label="Bestly Agent setup questions" data-testid="agent-setup">
      <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">You're in</p>
      <h1 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
        {order?.first_name ? `Welcome, ${order.first_name}.` : "Welcome."} Let's set up your agent.
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        {order?.plan_name && <>You're on {nw(`${order.plan_name}${order.price ? `, ${order.price}` : ""}`)}. </>}
        Nine short questions. Skip anything you're not sure about; we'll ask on the kickoff call. Your answers save as you type.
      </p>
      <p aria-live="polite" className="mt-3 min-h-[1.5rem] text-sm text-muted-foreground">
        {saveErr ? <span className="text-destructive">{saveErr}</span> : savedAt ? <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" aria-hidden="true" /> Saved at {nw(savedAt)}</span> : " "}
      </p>

      <div className="mt-6 space-y-5">
        <Row n={1} title="Your business name and website" required>
          <div>
            <label htmlFor={FIELD_ID.company} className={labelCls}>Business name</label>
            <Input {...textProps("company", "company")} autoComplete="organization" className={inputCls} />
          </div>
          <div>
            <label htmlFor={FIELD_ID.website} className={labelCls}>Website <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Input {...textProps("website", "website")} autoComplete="url" inputMode="url" placeholder="example.com" className={inputCls} />
          </div>
        </Row>

        <Row n={2} title="The phone number your callers use today" hint="This is the number customers already call." required>
          <div>
            <label htmlFor={FIELD_ID.current_phone} className={labelCls}>Phone number</label>
            <Input {...textProps("current_phone", "current_phone")} type="tel" autoComplete="tel" inputMode="tel" className={inputCls} />
          </div>
          <div id="phone_plan_group" role="radiogroup" aria-label="Forward your number or get a new one" className="space-y-2">
            <Choice type="radio" name="phone_plan" checked={a.phone_plan === "forward"} onChange={() => { set("phone_plan", "forward"); noteManualEdit(guard, "phone_plan", () => readNow().say); }}>Keep my number and forward calls to my agent</Choice>
            <Choice type="radio" name="phone_plan" checked={a.phone_plan === "new"} onChange={() => { set("phone_plan", "new"); noteManualEdit(guard, "phone_plan", () => readNow().say); }}>Give my agent a new number</Choice>
          </div>
        </Row>

        <Row n={3} title="Your business hours and time zone" hint="So she knows when you're open and when to take messages.">
          <div>
            <label htmlFor={FIELD_ID.hours} className={labelCls}>Hours</label>
            <Textarea {...textProps("hours", "hours")} rows={3} placeholder="Monday to Friday, 9 AM to 5 PM. Closed weekends." className="mt-1.5 min-h-[88px] text-base" />
          </div>
          <div>
            <label htmlFor={FIELD_ID.timezone} className={labelCls}>Time zone</label>
            <Input {...textProps("timezone", "timezone")} list="setup_zones" placeholder="Pacific Time" className={inputCls} />
            <datalist id="setup_zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
          </div>
        </Row>

        <Row n={4} title="What should most calls end in?" hint="Pick all that apply." required>
          <div id="call_goal_group" role="group" aria-label="What most calls should end in" className="grid gap-2 sm:grid-cols-2">
            {GOALS.map((g) => (
              <Choice key={g.id} type="checkbox" name="call_goal" checked={a.call_goal.includes(g.id)}
                onChange={() => { set("call_goal", a.call_goal.includes(g.id) ? a.call_goal.filter((x) => x !== g.id) : [...a.call_goal, g.id]); noteManualEdit(guard, "call_goal", () => readNow().say); }}>
                {g.label}
              </Choice>
            ))}
          </div>
        </Row>

        <Row n={5} title="Who should she transfer to, and their number?" hint="For callers who need a real person. Leave blank if you don't want transfers.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={FIELD_ID.transfer_name} className={labelCls}>Name</label>
              <Input {...textProps("transfer_name", "transfer_name")} autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label htmlFor={FIELD_ID.transfer_phone} className={labelCls}>Phone number</label>
              <Input {...textProps("transfer_phone", "transfer_phone")} type="tel" inputMode="tel" autoComplete="off" className={inputCls} />
            </div>
          </div>
        </Row>

        <Row n={6} title="Which apps should she use?" hint="Your calendar, customer list, help desk, payments. Type a name and pick it.">
          <div id="apps_group">
            <label htmlFor="setup_apps_search" className={labelCls}>Search apps</label>
            <Input
              id="setup_apps_search"
              value={appQuery}
              onChange={(e) => setAppQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (matches[0]) addApp(matches[0]); else if (appQuery.trim()) addApp(appQuery); } }}
              placeholder="Google Calendar, HubSpot, Jobber"
              autoComplete="off"
              className={inputCls}
            />
            {appQuery.trim() && (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Matching apps">
                {matches.map((n) => (
                  <li key={n}>
                    <button type="button" onClick={() => addApp(n)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border bg-background px-4 text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Plus className="h-4 w-4 text-primary" aria-hidden="true" /> {n}
                    </button>
                  </li>
                ))}
                {!matches.some((n) => n.toLowerCase() === appQuery.trim().toLowerCase()) && (
                  <li>
                    <button type="button" onClick={() => addApp(appQuery)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-dashed border-primary/50 bg-primary/5 px-4 text-foreground hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Plus className="h-4 w-4 text-primary" aria-hidden="true" /> Add &ldquo;{appQuery.trim().slice(0, 40)}&rdquo;
                    </button>
                  </li>
                )}
              </ul>
            )}
            {a.apps.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Apps you chose" data-testid="chosen-apps">
                {a.apps.map((n) => (
                  <li key={n} className="inline-flex min-h-[44px] items-center gap-1 rounded-full bg-primary/10 pl-4 pr-1 text-foreground">
                    <span>{n}</span>
                    <button type="button" aria-label={`Remove ${n}`} onClick={() => { set("apps", a.apps.filter((x) => x !== n)); noteManualEdit(guard, "apps", () => readNow().say); }}
                      className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Row>

        <Row n={7} title="The top 5 questions callers ask, with the answers" hint="Write each question, then the answer you'd give. One question per paragraph.">
          <div>
            <label htmlFor={FIELD_ID.faqs} className="sr-only">Common questions and answers</label>
            <Textarea {...textProps("faqs", "faqs")} rows={7} placeholder={"Do you take walk-ins? Yes, Monday to Friday until 4 PM.\n\nHow much is a cleaning? $120 for adults, $90 for kids."} className="min-h-[168px] text-base" />
          </div>
        </Row>

        <Row n={8} title="Anything she must never say or do?" hint="For example: never quote a price over the phone, never promise a same-day visit.">
          <div>
            <label htmlFor={FIELD_ID.never} className="sr-only">Things she must never say or do</label>
            <Textarea {...textProps("never", "never")} rows={4} className="min-h-[112px] text-base" />
          </div>
        </Row>

        <Row n={9} title="How should she sound, and what's her name?">
          <div id="voice_group" role="radiogroup" aria-label="Voice" className="grid gap-2 sm:grid-cols-3">
            {VOICES.map((v) => (
              <Choice key={v.id} type="radio" name="voice" checked={a.voice === v.id} onChange={() => { set("voice", v.id); noteManualEdit(guard, "voice", () => readNow().say); }}>{v.label}</Choice>
            ))}
          </div>
          <div>
            <label htmlFor={FIELD_ID.agent_name} className={labelCls}>Her name</label>
            <Input {...textProps("agent_name", "agent_name")} autoComplete="off" className={inputCls} />
          </div>
        </Row>
      </div>

      {sendErr && <p role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{sendErr}</p>}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={sending} className="min-h-[48px]">
          {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Sending</> : "Send my answers"}
        </Button>
        <p className="text-sm text-muted-foreground">You can change anything later on the kickoff call.</p>
      </div>
    </form>,
  );
}
