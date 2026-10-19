// Offline harness for the Email Builder (dev server only, never in the production build).
// Canned data and a fake API, so the screen can be driven and photographed with no login or database.
import { useEffect, useMemo, useState } from "react";
import { EmailBuilder } from "@/components/admin/emails/EmailBuilder";
import { emptyDraft, type Draft } from "@/components/admin/emails/emailUtils";
import type { EmailApi } from "@/lib/email/api";
import { resolvedSeedKits } from "@/lib/email/seedKits";
import { elizabethDoc } from "../../../scripts/email-builder/elizabeth-blocks.mjs";

export default function EmailHarness() {
  const params = new URLSearchParams(window.location.search);
  const filled = params.get("filled") !== "0";
  const kits = useMemo(() => resolvedSeedKits(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    const d = emptyDraft("bestly");
    if (filled) {
      const doc = elizabethDoc();
      setDraft({ ...d, title: "Two new things on your board", subject: doc.subject, preheader: doc.preheader, blocks: doc.blocks, brief: "Tell Elizabeth about the call on her board and the new video comment tool.", recipient_name: "Elizabeth", recipient_email: "elizabeth@example.com" });
    } else setDraft(d);
  }, [filled]);
  const api: EmailApi = useMemo(() => ({
    dbReady: false, kits, library: [], reload: async () => {},
    save: async () => { throw new Error("harness"); }, remove: async () => {}, versions: async () => [],
    generate: async () => ({ ok: false, error: "Offline harness: no AI here." }), revise: async () => ({ ok: false, error: "Offline harness: no AI here." }),
    makeImage: async () => ({ ok: false, error: "Offline harness" }), exportEml: async () => ({ ok: false, error: "Offline harness" }),
    send: async () => ({ ok: false, error: "Offline harness" }),
  }), [kits]);
  if (!draft) return null;
  return (
    <div className="min-h-screen bg-black px-4 py-6 text-white sm:px-8">
      <h1 className="mb-6 text-3xl font-bold">New email</h1>
      <EmailBuilder api={api} initial={draft} onSaved={() => {}} />
    </div>
  );
}
