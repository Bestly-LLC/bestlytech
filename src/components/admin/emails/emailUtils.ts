import { buildEml, renderEmail, renderText, blockId, type Block, type EmailDoc, type Kit } from "@/lib/email/render";
import type { Attachment, EmailApi, LibraryRow } from "@/lib/email/api";

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
  /** Files that go with the email. */
  attachments: Attachment[];
}

export const emptyDraft = (kit: string): Draft => ({ kit, title: "", subject: "", preheader: "", blocks: [], brief: "", recipient_name: "", recipient_email: "", source: "built", status: "draft", attachments: [] });

export const draftFromRow = (r: LibraryRow): Draft => ({
  id: r.id, kit: r.brand_kit, title: r.title, subject: r.subject, preheader: r.preheader ?? "", blocks: (r.blocks ?? []) as Block[], brief: r.brief ?? "",
  recipient_name: r.recipient_name ?? "", recipient_email: r.recipient_email ?? "", source: r.source, status: r.status,
  sentAt: r.status === "sent" ? (r.sent_at ?? r.updated_at) : undefined,
  fixedHtml: r.source === "template" || !(r.blocks ?? []).length ? r.html : undefined,
  attachments: Array.isArray(r.attachments) ? r.attachments : [],
});

/** "2.4 MB" — the number and unit are joined by a no-break space so they never split across lines. */
export function fileSize(n: number): string {
  if (n < 1024) return `${n}\u00a0B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}\u00a0KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)}\u00a0MB`;
}

const b64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");
};
const quoteName = (n: string) => (/^[\x20-\x7e]*$/.test(n) ? n.replace(/["\\\r\n]/g, "_") : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(n)))}?=`);

/** Wraps a built .eml in multipart/mixed so the files ride along as real attachments (Apple Mail keeps them in the draft). */
export async function emlWithAttachments(eml: string, files: { name: string; type: string; blob: Blob }[]): Promise<string> {
  if (!files.length) return eml;
  const cut = eml.indexOf("\r\n\r\n");
  const head = eml.slice(0, cut), body = eml.slice(cut + 4);
  const lines = head.split("\r\n");
  const ct = lines.findIndex((l) => /^content-type:/i.test(l));
  const inner = ct >= 0 ? lines[ct] : 'Content-Type: text/plain; charset="utf-8"';
  const mix = "=_mix_" + Math.random().toString(36).slice(2, 12);
  const outHead = lines.map((l, i) => (i === ct ? `Content-Type: multipart/mixed; boundary="${mix}"` : l));
  if (ct < 0) outHead.push(`Content-Type: multipart/mixed; boundary="${mix}"`);
  let out = outHead.join("\r\n") + "\r\n\r\n" + `--${mix}\r\n${inner}\r\n\r\n${body}\r\n`;
  for (const f of files) {
    const n = quoteName(f.name);
    out += `--${mix}\r\nContent-Type: ${f.type || "application/octet-stream"}; name="${n}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${n}"\r\n\r\n${await b64(f.blob)}\r\n`;
  }
  return out + `--${mix}--\r\n`;
}

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
  const files = await attachmentFiles(api, d.attachments);
  if (r.ok && r.eml) return { eml: await emlWithAttachments(r.eml, files), note: r.skipped?.length ? `${r.skipped.length} picture${r.skipped.length === 1 ? "" : "s"} could not be embedded.` : undefined };
  const from = kit.default_sender?.from_email ? `${kit.default_sender.from_name ?? "Jared Best"} <${kit.default_sender.from_email}>` : "Jared Best <jared@bestly.tech>";
  return { eml: await emlWithAttachments(buildEml({ from, to, subject: d.subject, html, text }), files), note: "Pictures are linked, not embedded (the picture service did not answer). Apple Mail may hide them." };
}

async function attachmentFiles(api: EmailApi, list: Attachment[]) {
  if (!list.length) return [];
  if (!api.fetchAttachment) throw new Error("Attachments cannot be read here.");
  return Promise.all(list.map(async (a) => ({ name: a.name, type: a.type, blob: await api.fetchAttachment!(a.path) })));
}
