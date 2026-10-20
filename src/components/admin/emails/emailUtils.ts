import { buildEml, renderEmail, renderText, blockId, type Block, type EmailDoc, type Kit } from "@/lib/email/render";
import type { EmailApi, LibraryRow } from "@/lib/email/api";

export const slugify = (s: string) => (s || "email").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "email";

export function download(name: string, body: string | Blob, type: string) {
  const blob = body instanceof Blob ? body : new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export interface Draft {
  id?: string; kit: string; title: string; subject: string; preheader: string; blocks: Block[];
  brief: string; recipient_name: string; recipient_email: string; source: "built" | "template"; status: "draft" | "sent";
  /** Imported template files have no blocks; their saved HTML is shown as is. */
  fixedHtml?: string;
  /** When it was last sent (ISO), for the "Sent to ..." banner. */
  sentAt?: string;
}

export const emptyDraft = (kit: string): Draft => ({ kit, title: "", subject: "", preheader: "", blocks: [], brief: "", recipient_name: "", recipient_email: "", source: "built", status: "draft" });

export const draftFromRow = (r: LibraryRow): Draft => ({
  id: r.id, kit: r.brand_kit, title: r.title, subject: r.subject, preheader: r.preheader ?? "", blocks: (r.blocks ?? []) as Block[], brief: r.brief ?? "",
  recipient_name: r.recipient_name ?? "", recipient_email: r.recipient_email ?? "", source: r.source, status: r.status,
  sentAt: r.status === "sent" ? (r.sent_at ?? r.updated_at) : undefined,
  fixedHtml: r.source === "template" || !(r.blocks ?? []).length ? r.html : undefined,
});

export const docOf = (d: Draft): EmailDoc => ({ subject: d.subject, preheader: d.preheader || undefined, blocks: d.blocks });
export const cleanHtml = (kit: Kit, d: Draft) => d.fixedHtml ?? renderEmail(kit, docOf(d));
export const previewSource = (kit: Kit, d: Draft) => d.fixedHtml ?? renderEmail(kit, docOf(d), { editable: true });
export const textOf = (kit: Kit, d: Draft) => (d.fixedHtml ? "" : renderText(kit, docOf(d)));

export const newBlock = (type: Block["type"]): Block => {
  const id = blockId();
  switch (type) {
    case "paragraph": return { id, type, text: "New paragraph." };
    case "subheading": return { id, type, text: "New heading" };
    case "button": return { id, type, label: "Open it", url: "https://", style: "solid" };
    case "callout": return { id, type, text: "A short boxed note." };
    case "list": return { id, type, items: ["First point", "Second point"] };
    case "divider": return { id, type };
    case "image": return { id, type, kind: "asset", alt: "Picture" };
    case "product_ads": return { id, type, keys: [], variant: "soft" };
    default: return { id, type: "paragraph", text: "New paragraph." };
  }
};

export const BLOCK_LABEL: Record<Block["type"], string> = {
  eyebrow: "Small heading", headline: "Headline", paragraph: "Paragraph", subheading: "Heading", list: "List", button: "Button",
  callout: "Boxed note", image: "Picture", panel: "Summary box", divider: "Divider line", signature: "Signature", product_ads: "Bestly product line",
};

/** The .eml: images are fetched by the edge function and embedded (cid:), so Apple Mail's draft window keeps them. */
export async function makeEml(api: EmailApi, kit: Kit, d: Draft, html: string): Promise<{ eml: string; note?: string }> {
  const text = textOf(kit, d) || d.subject;
  const to = d.recipient_email ? (d.recipient_name ? `${d.recipient_name} <${d.recipient_email}>` : d.recipient_email) : undefined;
  const r = await api.exportEml({ html, text, subject: d.subject, to });
  if (r.ok && r.eml) return { eml: r.eml, note: r.skipped?.length ? `${r.skipped.length} picture${r.skipped.length === 1 ? "" : "s"} could not be embedded.` : undefined };
  const from = kit.default_sender?.from_email ? `${kit.default_sender.from_name ?? "Jared Best"} <${kit.default_sender.from_email}>` : "Jared Best <jared@bestly.tech>";
  return { eml: buildEml({ from, to, subject: d.subject, html, text }), note: "Pictures are linked, not embedded (the picture service did not answer). Apple Mail may hide them." };
}
