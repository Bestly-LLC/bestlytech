// A small in-memory stand-in for the supabase-js query builder, enough for the claims-closer edge modules. Test-only.
type Row = Record<string, any>;
let seq = 0;
export const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

class Query {
  private filters: ((r: Row) => boolean)[] = []; private op: "select" | "insert" | "update" | "delete" = "select"; private payload: any; private embed: string[] = [];
  private ord: { k: string; asc: boolean } | null = null; private lim = Infinity; private wantRows = false; private mode: "many" | "one" | "maybe" = "many";
  constructor(private db: FakeDb, private table: string) {}
  select(cols?: string) { this.wantRows = true; if (this.op === "select") for (const m of String(cols ?? "").matchAll(/(\w+)\(/g)) this.embed.push(m[1]); return this; }
  insert(p: any) { this.op = "insert"; this.payload = p; return this; }
  update(p: any) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
  is(k: string, v: any) { this.filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return this; }
  not(k: string, _o: string, v: any) { this.filters.push((r) => (v === null ? r[k] != null : r[k] !== v)); return this; }
  in(k: string, vs: any[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  gte(k: string, v: any) { this.filters.push((r) => r[k] != null && r[k] >= v); return this; }
  gt(k: string, v: any) { this.filters.push((r) => r[k] != null && r[k] > v); return this; }
  order(k: string, o?: { ascending?: boolean }) { this.ord = { k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "one"; return this; }
  private run() {
    const t = (this.db.tables[this.table] ??= []);
    let rows: Row[];
    if (this.op === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p) => ({ id: uid(), ...p }));
      t.push(...list); rows = list;
    } else {
      rows = t.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") for (const r of rows) Object.assign(r, this.payload);
      if (this.op === "delete") this.db.tables[this.table] = t.filter((r) => !rows.includes(r));
    }
    if (this.ord) { const { k, asc } = this.ord; rows = [...rows].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)); }
    rows = rows.slice(0, this.lim);
    if (this.embed.length) rows = rows.map((r) => ({ ...r, ...Object.fromEntries(this.embed.map((e) => [e, (this.db.tables[e] ?? []).find((x) => x.id === r.shop_id) ?? null])) }));
    const out = this.op === "select" || this.wantRows ? rows : null;
    if (this.mode === "one") return { data: out?.[0] ?? null, error: out?.length ? null : { message: "no rows" } };
    if (this.mode === "maybe") return { data: out?.[0] ?? null, error: null };
    return { data: out, error: null };
  }
  then(res: (v: any) => any, rej?: (e: any) => any) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).catch(rej as any); } }
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, (args: Row) => any> = {};
  files: Record<string, Uint8Array> = {};
  from(t: string) { return new Query(this, t); }
  rpc(name: string, args: Row = {}) {
    const f = this.rpcs[name];
    return Promise.resolve({ data: f ? f(args) : null, error: null });
  }
  storage = { from: (_b: string) => ({
    download: async (p: string) => ({ data: this.files[p] ? new Blob([this.files[p] as any]) : null }),
    upload: async () => ({ error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/x" } }),
  }) };
  seed(table: string, rows: Row[]): Row[] { const made: Row[] = rows.map((r) => ({ id: uid(), ...r })); (this.tables[table] ??= []).push(...made); return made; }
}

export class LlmUnavailable extends Error {}
export function makeCtx(db: FakeDb, o: { llm?: (a: any) => Promise<any> } = {}) {
  const events: Row[] = []; const notices: Row[] = [];
  const ctx: any = {
    db, LlmUnavailable, llm: o.llm ?? (async () => { throw new LlmUnavailable("no model in tests"); }),
    notify: async (title: string, body: string, dedupe: string, severity = "info") => { notices.push({ title, body, dedupe, severity }); },
    event: async (c: Row, kind: string, title: string, detail: unknown = null) => { db.tables.claim_events ??= []; db.tables.claim_events.push({ id: uid(), case_id: c.id, kind, title, detail }); events.push({ kind, title, detail }); },
    fmt: (iso?: string | null) => (iso ? new Date(iso).toISOString() : null), money: (n: number) => `$${n}`, supabaseUrl: "https://example.supabase.test", serviceKey: "svc",
  };
  return { ctx, events, notices };
}

/** captures every Resend email and Ava call the code under test would make */
export function captureNetwork() {
  const mails: Row[] = []; const calls: Row[] = [];
  const g: any = globalThis;
  g.Deno = { env: { get: (k: string) => (k === "RESEND_API_KEY" ? "re_test" : undefined) } };
  g.fetch = async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (String(url).includes("api.resend.com")) { mails.push(body); return { ok: true, status: 200, json: async () => ({ id: `re_${mails.length}` }) }; }
    if (String(url).includes("ava-assistant")) { calls.push(body); return { ok: true, status: 200, json: async () => ({ ok: true, call_id: `call_${calls.length}` }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { mails, calls };
}
