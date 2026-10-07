/**
 * Scout AI page (/admin/scout-ai): the free AI Scout runs on.
 *   - "Free AI keys": paste a provider key, FreeLLM on the Pi picks it up within a minute. More keys = Scout stays
 *     fast when one runs out. The key goes to Vault through the freellm-keys function and is never shown again.
 *   - "Models Scout trusts": the daily tool-call test (Model Prober). A model that fails it is benched.
 * Pattern: ChargingCard (write-only secrets, a page can save a key but never read one back).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, ExternalLink, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Section, btnPrimary, card, field, label, pill, secondary, separator, tertiary, tint } from "./laxUi";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

interface Prov { provider: string; name: string; keyless: boolean; keys: number; enabled_keys: number; healthy_keys: number; last_error: string | null }
interface Status {
  providers: Prov[]; queue: { id: string; provider: string; status: string; error: string | null; created_at: string }[];
  synced_at: string | null; total_keys: number; providers_with_keys: number;
}
interface Health { model: string; ok_tool_calls: boolean | null; last_probe_at: string | null; benched_until: string | null; strikes: number; note: string | null }

/** Free signup pages for the providers people ask about most. Others show no link. */
const SIGNUP: Record<string, string> = {
  google: "https://aistudio.google.com/apikey", groq: "https://console.groq.com/keys", cerebras: "https://cloud.cerebras.ai/",
  openrouter: "https://openrouter.ai/keys", mistral: "https://console.mistral.ai/api-keys", nvidia: "https://build.nvidia.com/",
  github: "https://github.com/settings/personal-access-tokens", cohere: "https://dashboard.cohere.com/api-keys",
  huggingface: "https://huggingface.co/settings/tokens", cloudflare: "https://dash.cloudflare.com/profile/api-tokens",
  zhipu: "https://open.bigmodel.cn/usercenter/apikeys", siliconflow: "https://cloud.siliconflow.com/account/ak",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ScoutAI() {
  const [s, setS] = useState<Status | null>(null);
  const [health, setHealth] = useState<Health[]>([]);
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("freellm-keys", { body: { action: "status" } });
    if (error || !(data as any)?.ok) { toast.error("Couldn't read the free AI keys."); return; }
    setS(data as Status);
    const h = await rpc("llm_model_health_admin");
    if (!h.error) setHealth((h.data as Health[]) ?? []);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, [load]);

  const choices = useMemo(() => (s?.providers ?? []).filter((p) => !p.keyless), [s]);
  const add = async () => {
    if (!provider || !key.trim()) { toast.error("Pick a provider and paste the key."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("freellm-keys", { body: { action: "add", provider, key: key.trim() } });
    setBusy(false);
    if (error || !(data as any)?.ok) { toast.error((data as any)?.error || "Couldn't save the key."); return; }
    setKey("");
    toast.success("Saved. Scout can use it within a minute.");
    await load();
  };

  const trusted = health.filter((h) => h.ok_tool_calls === true && !(h.benched_until && Date.parse(h.benched_until) > Date.now()));
  const benched = health.filter((h) => h.ok_tool_calls === false || (h.benched_until && Date.parse(h.benched_until) > Date.now()));
  const sel = choices.find((p) => p.provider === provider);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 pb-24 pt-6">
      <header className="space-y-1">
        <h1 className={cn("text-[28px] font-bold leading-tight tracking-[-0.02em]", label)}>Scout AI</h1>
        <p className={cn("text-[15px] leading-snug", secondary)}>The free AI Scout works on, and how to give it more room.</p>
      </header>

      <Section title="Free AI keys" footer="A key stays in Vault until the Pi adds it to FreeLLM, then it is deleted from Vault. This page can save a key, never read one back.">
        <div className={cn(card, "space-y-4")}>
          <div className="flex items-baseline justify-between gap-3">
            <p className={cn("text-[17px] font-semibold", label)}>Add a free AI key</p>
            {s && <span className={cn("whitespace-nowrap text-[13px]", secondary)}>{s.total_keys} keys on {s.providers_with_keys} providers</span>}
          </div>
          <p className={cn("text-[15px] leading-snug", secondary)}>More keys = Scout stays fast when one runs out.</p>
          {!s ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /> : (
            <>
              <label className="block space-y-1.5">
                <span className={cn("text-[13px] font-medium", secondary)}>Provider</span>
                <select className={field} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider">
                  <option value="">Choose a provider</option>
                  {choices.map((p) => <option key={p.provider} value={p.provider}>{p.name} ({p.keys} {p.keys === 1 ? "key" : "keys"})</option>)}
                </select>
              </label>
              {provider && SIGNUP[provider] && (
                <a className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium sm:min-h-0", tint.blue)} href={SIGNUP[provider]} target="_blank" rel="noreferrer">
                  Get a free {sel?.name} key <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              )}
              <label className="block space-y-1.5">
                <span className={cn("text-[13px] font-medium", secondary)}>Key</span>
                <input className={field} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key" aria-label="API key" />
              </label>
              <button className={btnPrimary} disabled={busy || !provider || !key.trim()} onClick={() => void add()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />} Save key
              </button>
            </>
          )}
          {s?.queue?.length ? (
            <ul className={cn("divide-y pt-1", separator)}>
              {s.queue.slice(0, 4).map((q) => (
                <li key={q.id} className="flex items-start justify-between gap-3 py-2.5 text-[15px]">
                  <span className={label}>{q.provider}</span>
                  <span className={cn("flex items-center gap-1.5 text-right text-[13px]", q.status === "failed" ? tint.red : q.status === "added" ? tint.green : tint.orange)}>
                    {q.status === "added" ? <Check className="h-4 w-4" aria-hidden /> : <CircleAlert className="h-4 w-4" aria-hidden />}
                    {q.status === "added" ? "Added" : q.status === "failed" ? `Failed: ${q.error ?? "unknown"}` : "Waiting for the Pi"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className={cn(card, "p-0")}>
          <ul className={cn("divide-y", separator)}>
            {(s?.providers ?? []).filter((p) => p.keys > 0).map((p) => (
              <li key={p.provider} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className={cn("text-[15px]", label)}>{p.name}</span>
                <span className="flex items-center gap-2">
                  <span className={cn("whitespace-nowrap text-[13px]", secondary)}>{p.keys} {p.keys === 1 ? "key" : "keys"}</span>
                  <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium", p.healthy_keys > 0 ? pill.green : pill.orange)}>
                    {p.healthy_keys > 0 ? "Working" : "Check it"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {s?.synced_at && <p className={cn("px-5 pb-3 pt-2 text-[12px]", tertiary)}>Updated {when(s.synced_at)}</p>}
        </div>
      </Section>

      <Section title="Models Scout trusts" footer="Every day a test asks each model to use a tool and answer from the result. A model that writes the call as plain text, or ignores the result, is benched.">
        <div className={cn(card, "space-y-3")}>
          <p className={cn("text-[15px]", label)}>{trusted.length} passing, {benched.length} benched</p>
          <p className={cn("text-[13px] leading-snug", secondary)}>{trusted.map((h) => h.model).join(", ") || "No test results yet."}</p>
          {benched.length > 0 && (
            <p className={cn("text-[13px] leading-snug", tertiary)}>Benched: {benched.filter((h) => h.note !== "denylist").map((h) => `${h.model} (${h.note ?? "failed"})`).join(", ") || "none"}</p>
          )}
        </div>
      </Section>
    </div>
  );
}
