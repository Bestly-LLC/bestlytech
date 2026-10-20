// Offline harness for the Email Builder (dev server only, never in the production build).
// Canned data and a fake API, so the screen can be driven and photographed with no login or database.
//   ?filled=0        start with an empty draft
//   ?send=fail       the fake mail server answers "did not send"
//   ?open=sent       open an already-sent email (banner + "Send again")
//   ?view=library    start on the library
import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { EmailBuilder } from "@/components/admin/emails/EmailBuilder";
import { EmailLibrary, applyJustSent, type JustSent } from "@/components/admin/emails/EmailLibrary";
import { draftFromRow, emptyDraft, type Draft } from "@/components/admin/emails/emailUtils";
import type { ContactHit, EmailApi, LibraryRow } from "@/lib/email/api";
import { renderEmail, type Block } from "@/lib/email/render";
import { resolvedSeedKits } from "@/lib/email/seedKits";
import { btnPlain } from "@/pages/admin/laxUi";
import { elizabethDoc } from "../../../scripts/email-builder/elizabeth-blocks.mjs";

const CONTACTS: ContactHit[] = [
  { name: "Elizabeth O'Brien", email: "elizabeth@example.com", source: "client", detail: "Centering YOU" },
  { name: "Eli Cooper", email: "eli@example.com", source: "icloud", detail: null },
  { name: "Elena Marsh", email: "elena.marsh@example.com", source: "icloud", detail: null },
  { name: null, email: "elsie.k@example.com", source: "recent", detail: null },
  { name: "Dan", email: "dan@example.com", source: "recent", detail: null },
];

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

export default function EmailHarness() {
  const params = new URLSearchParams(window.location.search);
  const filled = params.get("filled") !== "0";
  const failSend = params.get("send") === "fail";
  const kits = useMemo(() => resolvedSeedKits(), []);
  const kit = kits[0];

  const makeRow = useCallback((over: Partial<LibraryRow> & { id: string; title: string; subject: string }): LibraryRow => {
    const doc = elizabethDoc();
    const blocks = doc.blocks as unknown as Block[];
    return {
      brand_kit: kit.slug, preheader: doc.preheader, blocks, html: renderEmail(kit, { subject: over.subject, preheader: doc.preheader, blocks }), text_body: "",
      source: "built", template_slug: null, brief: null, recipient_name: null, recipient_email: null, status: "draft", created_at: iso(900), updated_at: iso(600), ...over,
    };
  }, [kit]);

  const [rows, setRows] = useState<LibraryRow[]>(() => [
    makeRow({ id: "r1", title: "Welcome to Bestly", subject: "Welcome to Bestly", updated_at: iso(60 * 26), status: "sent", recipient_name: "Dan", recipient_email: "dan@example.com" }),
    makeRow({ id: "r2", title: "Deck page is ready", subject: "Your deck page is ready", updated_at: iso(60 * 5) }),
    makeRow({ id: "r3", title: "Thanks for the call", subject: "Thanks for the call", updated_at: iso(60 * 30) }),
  ]);
  const rowsRef = useRef(rows); rowsRef.current = rows;

  const [view, setView] = useState<"builder" | "library">(params.get("view") === "library" ? "library" : "builder");
  const [justSent, setJustSent] = useState<JustSent | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [draft] = useState<Draft>(() => {
    if (params.get("open") === "sent") return draftFromRow(rows[0]);
    const d = emptyDraft("bestly");
    if (!filled) return d;
    const doc = elizabethDoc();
    return { ...d, title: "Two new things on your board", subject: doc.subject, preheader: doc.preheader, blocks: doc.blocks as unknown as Block[], brief: "Tell Elizabeth about the call on her board and the new video comment tool.", recipient_name: "Elizabeth", recipient_email: "elizabeth@example.com" };
  });

  const api: EmailApi = useMemo(() => ({
    dbReady: true, kits, library: [], reload: async () => {},
    save: async (row) => {
      const id = row.id ?? "h1";
      const prev = rowsRef.current.find((r) => r.id === id);
      const saved = makeRow({ ...prev, ...(row as Partial<LibraryRow>), id, title: row.title, subject: (row.subject as string) ?? "", html: (row.html as string) ?? "", updated_at: new Date().toISOString() });
      setRows((rs) => (rs.some((r) => r.id === id) ? rs.map((r) => (r.id === id ? saved : r)) : [saved, ...rs]));
      return saved;
    },
    remove: async () => {}, versions: async () => [],
    generate: async () => ({ ok: false, error: "Offline harness: no AI here." }), revise: async () => ({ ok: false, error: "Offline harness: no AI here." }),
    makeImage: async () => ({ ok: false, error: "Offline harness" }), exportEml: async () => ({ ok: false, error: "Offline harness" }),
    send: () => new Promise((resolve) => setTimeout(() => resolve(failSend ? { ok: false, error: "The mail server did not answer. Nothing was sent." } : { ok: true, id: "harness" }), 900)),
    suggestContacts: (q) => new Promise((resolve) => {
      const n = q.toLowerCase();
      setTimeout(() => resolve(CONTACTS.filter((c) => (c.name ?? "").toLowerCase().includes(n) || c.email.toLowerCase().includes(n)).slice(0, 8)), 120);
    }),
  }), [kits, makeRow, failSend]);

  const shown = useMemo(() => applyJustSent(rows, justSent), [rows, justSent]);
  const kitName = useMemo(() => Object.fromEntries(kits.map((k) => [k.slug, k.name])), [kits]);

  if (view === "library") {
    return (
      <div className="min-h-screen bg-black px-4 py-6 text-white sm:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Emails</h1>
        </div>
        <EmailLibrary rows={shown} kitName={kitName} highlightId={flash} onOpen={() => {}} onStartFrom={() => {}} onDelete={() => {}} />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-black px-4 py-6 text-white sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{draft.id ? "Edit email" : "New email"}</h1>
        <button type="button" onClick={() => setView("library")} className={btnPlain}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to the library</button>
      </div>
      <EmailBuilder api={api} initial={draft} onSaved={() => {}}
        onSentDone={(row, to, name) => {
          setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: "sent", recipient_email: to, recipient_name: name || null } : r)));
          setJustSent({ id: row.id, to, name, at: new Date().toISOString() });
          setFlash(row.id); setView("library");
          window.setTimeout(() => setFlash(null), 2800);
        }} />
    </div>
  );
}
