import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { KITS } from "../../../scripts/email-builder/kits.mjs";
import { elizabethDoc } from "../../../scripts/email-builder/elizabeth-blocks.mjs";
import {
  bindUnits, buildEml, imageUrlsIn, lintDoc, normalizeDoc, qp, renderEmail, renderText, resolveKit, rewriteImagesToCid, stripEmoji,
  type EmailDoc, type Kit,
} from "./email-render.ts";

const rows = Object.fromEntries((KITS as any[]).map((k) => [k.slug, k])) as Record<string, any>;
const kit = (slug: string): Kit => resolveKit(rows[slug], rows);
const doc = elizabethDoc() as EmailDoc;

describe("renderer: Elizabeth letter in the Bestly kit", () => {
  const html = renderEmail(kit("bestly"), doc);

  it("uses the exact Bestly template shell", () => {
    const src = readFileSync("public/email-templates/bestly-letter.html", "utf8");
    // same dark-mode block, header gif, card padding, footer text and rainbow hairline as the shipped template
    for (const needle of [
      ".bg { background:#0b0d14 !important; }", "https://www.bestly.tech/email-templates/assets/bestly-header.gif",
      "padding:36px 36px 32px", "max-width:560px", "Bestly LLC · Gay-owned · Built in Los Angeles", "See what we make",
      "linear-gradient(90deg,rgba(228,3,3,0),#e40303 14%", "border-left:2px solid #7a8be0", "font:400 32px/36px 'Newsreader'",
    ]) { expect(src).toContain(needle); expect(html).toContain(needle); }
  });

  it("renders buttons as <a href> inside a table cell, never a <button>", () => {
    expect(html).not.toMatch(/<button/i);
    const anchors = [...html.matchAll(/<table[^>]*>\s*<tr><td[^>]*>\s*<a href="(https:[^"]+)" target="_blank"[^>]*>([^<]+)<\/a>/g)];
    expect(anchors.map((m) => m[2])).toEqual(["Open my board", "Join our usual call", "Try it on my board"]);
    expect(anchors[1][1]).toBe("https://cloud.bestly.tech/call/fyqvdsa4");
    expect(html).toContain("border:1.5px solid #3b4a9c"); // outlined button
    expect(html).toContain("background:#3b4a9c;border-radius:12px"); // solid indigo button
  });

  it("keeps bold, the signature and no emoji", () => {
    expect(html).toContain('<b style="font-weight:600">Join</b>');
    expect(html).toContain("jared-headshot.gif");
    expect(html).toContain("(816)&nbsp;500&#8209;7236");
    expect(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html)).toBe(false);
  });

  it("matches the committed snapshot", () => {
    expect(html).toMatchSnapshot();
  });

  it("plain text twin lists every button link", () => {
    const t = renderText(kit("bestly"), doc);
    expect(t).toContain("Open my board: https://");
    expect(t).toContain("Join our usual call: https://cloud.bestly.tech/call/fyqvdsa4");
    expect(t).toContain("Jared Best");
  });
});

describe("kits are data", () => {
  it("InventoryProof renders its own shell from data, not Bestly's", () => {
    const html = renderEmail(kit("inventoryproof"), { subject: "Hi", blocks: [{ id: "a", type: "headline", text: "You haven't been charged." }, { id: "b", type: "paragraph", text: "Hi Sam," }, { id: "c", type: "signature" }] });
    expect(html).toContain("#0661d0");
    expect(html).toContain("inventoryproof-icon.png");
    expect(html).toContain("Manrope");
    expect(html).toContain("InventoryProof Support");
    expect(html).not.toContain("bestly-header.gif");
    expect(html).not.toContain("linear-gradient(90deg,rgba(228,3,3,0)"); // no rainbow for this kit
  });
  it("child kits inherit from their parent and override only what they set", () => {
    const cy = kit("centering-you");
    expect(cy.theme?.accent).toBe("#2A6566");
    expect(cy.signature?.name).toBe("Jared Best"); // inherited from bestly
    expect(cy.ai_images).toBe("never");
    expect(kit("cookie-yeti").header?.name).toBe("Cookie Yeti");
    expect(renderEmail(kit("cookie-yeti"), doc)).toContain("#3b4a9c");
  });
  it("renders every seeded kit without throwing", () => {
    for (const k of KITS as any[]) expect(renderEmail(kit(k.slug), doc).length).toBeGreaterThan(1500);
  });
});

describe("product ads", () => {
  const bestly = kit("bestly");
  it("full ad block renders outside the card with the Bestly Agent hero", () => {
    const h = renderEmail(bestly, { subject: "x", blocks: [{ id: "h", type: "headline", text: "Hi" }, { id: "s", type: "signature" }, { id: "a", type: "product_ads", keys: ["bestly-agent", "cookie-yeti"], variant: "full" }] });
    expect(h).toContain("More from Bestly");
    expect(h).toContain("og-agent.png");
    expect(h).toContain("https://bestly.tech/cookie-yeti");
  });
  it("soft ad is one quiet line inside the card", () => {
    const h = renderEmail(bestly, { subject: "x", blocks: [{ id: "h", type: "headline", text: "Hi" }, { id: "a", type: "product_ads", keys: ["bestly-studio"], variant: "soft" }] });
    expect(h).toContain("From Bestly:");
    expect(h).toContain("https://bestly.tech/studio");
    expect(h).not.toContain("More from Bestly");
  });
  it("ensure-mode kits get a soft Bestly line even when the model forgot", () => {
    const n = normalizeDoc({ subject: "s", blocks: [{ type: "headline", text: "Hello" }, { type: "paragraph", text: "Hi" }] }, { kit: kit("centering-you") });
    const last = n.doc.blocks.at(-1)!;
    expect(last.type).toBe("product_ads");
    expect(n.doc.blocks.some((b) => b.type === "signature")).toBe(true);
  });
  it("never-mode kits drop ads", () => {
    const n = normalizeDoc({ subject: "s", blocks: [{ type: "headline", text: "H" }, { type: "product_ads", keys: ["cookie-yeti"] }] }, { kit: kit("inventoryproof") });
    expect(n.doc.blocks.some((b) => b.type === "product_ads")).toBe(false);
  });
});

describe("normalizeDoc repairs model output", () => {
  const bestly = kit("bestly");
  it("drops links the person never gave, keeps ones they did", () => {
    const n = normalizeDoc({ subject: "s", blocks: [
      { type: "headline", text: "H" },
      { type: "button", label: "Good", url: "https://studio.bestly.tech/deck" },
      { type: "button", label: "Invented", url: "https://evil.example/pay" },
    ] }, { kit: bestly, allowedUrls: ["https://studio.bestly.tech/deck"] });
    const labels = n.doc.blocks.filter((b) => b.type === "button").map((b: any) => b.label);
    expect(labels).toEqual(["Good"]);
    expect(n.warnings.join(" ")).toContain("Invented");
  });
  it("strips emoji, clamps, removes unknown types, and flags a missing headline for retry", () => {
    const n = normalizeDoc({ subject: "Hi \u{1F600}", blocks: [{ type: "paragraph", text: "Nice \u{1F389} day" }, { type: "script", text: "x" }] }, { kit: bestly });
    expect(n.doc.subject).toBe("Hi");
    expect((n.doc.blocks[0] as any).text).toBe("Nice day");
    expect(n.problems).toContain("no headline");
  });
  it("refuses javascript: and other non-https links", () => {
    const n = normalizeDoc({ subject: "s", blocks: [{ type: "headline", text: "H" }, { type: "button", label: "x", url: "javascript:alert(1)" }] }, { kit: bestly, allowAnyUrl: true });
    expect(n.doc.blocks.some((b) => b.type === "button")).toBe(false);
  });
  it("blocks AI pictures for brands that do not use them", () => {
    const n = normalizeDoc({ subject: "s", blocks: [{ type: "headline", text: "H" }, { type: "image", kind: "ai", prompt: "a sunrise", alt: "x" }] }, { kit: kit("centering-you") });
    expect(n.doc.blocks.some((b) => b.type === "image")).toBe(false);
  });
  it("resolves asset pictures from the kit and rejects unknown keys", () => {
    const n = normalizeDoc({ subject: "s", blocks: [{ type: "headline", text: "H" }, { type: "image", kind: "asset", asset_key: "bestly-agent", alt: "" }, { type: "image", kind: "asset", asset_key: "nope", alt: "" }] }, { kit: bestly });
    const imgs = n.doc.blocks.filter((b) => b.type === "image") as any[];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].url).toContain("og-agent.png");
  });
  it("lints 24-hour times and metric units", () => {
    expect(lintDoc({ subject: "s", blocks: [{ id: "a", type: "paragraph", text: "Call at 15:30 for 5 km" }] }).length).toBe(2);
    expect(lintDoc({ subject: "s", blocks: [{ id: "a", type: "paragraph", text: "Call at 3:30 PM for 3 mi" }] })).toEqual([]);
  });
});

describe("numbers stay with their units", () => {
  it("binds with a non-breaking space", () => {
    expect(bindUnits("It is 9 MB at 3:05 PM and 65 mph, 72 °F")).toBe("It is 9 MB at 3:05 PM and 65 mph, 72 °F");
  });
  it("rendered html carries &nbsp; not a plain space", () => {
    const h = renderEmail(kit("bestly"), { subject: "s", blocks: [{ id: "p", type: "paragraph", text: "The file is 9 MB." }] });
    expect(h).toContain("9&nbsp;MB");
  });
});

describe(".eml export", () => {
  const html = renderEmail(kit("bestly"), doc);
  const urls = imageUrlsIn(html);
  it("finds the remote images", () => {
    expect(urls).toContain("https://www.bestly.tech/email-templates/assets/bestly-header.gif");
    expect(urls).toContain("https://www.bestly.tech/email-templates/assets/jared-headshot.gif");
  });
  it("rewrites every image to a cid: and embeds each as a related part", () => {
    const map = Object.fromEntries(urls.map((u, i) => [u, `img${i + 1}@bestly.tech`]));
    const cidHtml = rewriteImagesToCid(html, map);
    expect(cidHtml).not.toMatch(/<img[^>]+src="https?:/);
    expect(cidHtml).toContain('src="cid:img1@bestly.tech"');
    const eml = buildEml({
      from: "Jared Best <jared@bestly.tech>", to: "Elizabeth <e@example.com>", subject: "Two new things on your board", html: cidHtml, text: renderText(kit("bestly"), doc),
      images: urls.map((u, i) => ({ cid: `img${i + 1}@bestly.tech`, contentType: "image/gif", data: new Uint8Array([71, 73, 70, 56, 57, 97, i]) })),
      date: new Date("2026-10-19T12:00:00Z"),
    });
    expect(eml.startsWith("X-Unsent: 1\r\n")).toBe(true);
    expect(eml).toContain("From: Jared Best <jared@bestly.tech>");
    expect(eml).toContain("To: Elizabeth <e@example.com>");
    expect(eml).toContain("Subject: Two new things on your board");
    expect(eml).toContain('Content-Type: multipart/related; type="text/html"');
    expect(eml).toContain("Content-ID: <img1@bestly.tech>");
    expect(eml).toContain("Content-ID: <img2@bestly.tech>");
    expect(eml.match(/Content-Disposition: inline/g)).toHaveLength(2);
    expect(eml).toContain("Content-Type: text/plain");
    expect((eml.match(/--=_alt_/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("without images it is a plain alternative", () => {
    const eml = buildEml({ from: "a@b.co", subject: "Plain", html: "<p>x</p>", text: "x" });
    expect(eml).not.toContain("multipart/related");
    expect(eml).toContain("X-Unsent: 1");
  });
  it("encodes non-ASCII subjects and quoted-printable bodies", () => {
    expect(buildEml({ from: "a@b.co", subject: "Café", html: "<p>é</p>", text: "é" })).toContain("Subject: =?UTF-8?B?");
    expect(qp("café =")).toBe("caf=C3=A9 =3D");
    expect(qp("a".repeat(100)).split("\r\n").every((l) => l.length <= 76)).toBe(true);
  });
});
