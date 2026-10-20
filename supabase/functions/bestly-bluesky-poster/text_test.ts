import { blueskyText, glen, blen, AI_LINE, MORE_LINE } from "./text.ts";
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL", m, a, b); Deno.exit(1); } else console.log("ok  ", m); };
const sliceBytes = (t: string, s: number, e: number) => new TextDecoder().decode(new TextEncoder().encode(t).slice(s, e));

// 1 real MN02 caption: source line is long -> compacted, More added, AI label last, fits 300
const mn02 = 'South Florida will host the G20 Leaders Summit in December, bringing heightened security and road closures managed by federal, state, and local agencies.\n\nSource: CBS Miami, "Residents should expect road closures near Doral as agencies coordinate G20 summit security" on YouTube. Full video: https://youtu.be/ROtdpI7T-28\n\n#news #minutenewsdaily #security #travel';
let r = blueskyText(mn02, true, { ensureMore: true });
console.log(r.text);
eq(r.graphemes <= 300, true, "<= 300 graphemes (" + r.graphemes + ")");
eq(r.text.endsWith("\n" + AI_LINE), true, "AI voice is the last line");
eq(r.text.includes(MORE_LINE), true, "More line kept");
eq(r.text.includes("..."), false, "no ellipsis");
eq(r.text.includes("https://youtu.be/ROtdpI7T-28"), true, "short source keeps the video link");

// 2 facets: More link, url link, byte offsets
const f = r.facets;
const more = f.find((x) => x.features[0].$type.endsWith("#link") && (x.features[0] as any).uri === "https://minutenewsdaily.com");
eq(!!more, true, "minutenewsdaily.com is a link facet");
eq(sliceBytes(r.text, more!.index.byteStart, more!.index.byteEnd), "minutenewsdaily.com", "facet bytes cover the domain");
const yt = f.find((x) => (x.features[0] as any).uri === "https://youtu.be/ROtdpI7T-28");
eq(sliceBytes(r.text, yt!.index.byteStart, yt!.index.byteEnd), "https://youtu.be/ROtdpI7T-28", "facet bytes cover the url");

// 3 short caption: everything fits, tags become tag facets (max 2)
r = blueskyText("Hello world.\n\nMore: minutenewsdaily.com\n\n#news #minutenewsdaily #security", false);
eq(r.text, "Hello world.\n\nMore: minutenewsdaily.com\n#news #minutenewsdaily", "tags capped at 2, no AI line");
eq(r.facets.filter((x) => (x.features[0] as any).$type.endsWith("#tag")).map((x) => (x.features[0] as any).tag), ["news", "minutenewsdaily"], "two tag facets");

// 4 emoji: facet offsets are UTF-8 bytes, not characters
r = blueskyText("Big news 😀 today.\n\nMore: minutenewsdaily.com", true);
const m2 = r.facets[0];
eq(sliceBytes(r.text, m2.index.byteStart, m2.index.byteEnd), "minutenewsdaily.com", "offsets right after an emoji");
eq(blen("😀"), 4, "emoji is 4 bytes");
eq(glen("👨‍👩‍👧"), 1, "family emoji is one grapheme");

// 5 very long first paragraph is cut at a sentence end, never with dots, tail intact
const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ") + "\n\nMore: minutenewsdaily.com";
r = blueskyText(long, true);
eq(r.graphemes <= 300, true, "long: <= 300 (" + r.graphemes + ")");
eq(r.text.includes("..."), false, "long: no ellipsis");
eq(r.text.endsWith("More: minutenewsdaily.com\nAI voice"), true, "long: tail intact");
eq(/\.\n\nMore/.test(r.text), true, "long: cut at a sentence end");
eq(r.trimmed, true, "long: reports trimmed");

// 6 extra paragraphs are dropped before the source
r = blueskyText("First part is short.\n\n" + "Second paragraph is very long. ".repeat(12) + "\n\nSource: BBC News, \"x\" on YouTube. Full video: https://youtu.be/abc", false, { ensureMore: true });
eq(r.text.includes("Second paragraph"), false, "extra paragraph dropped");
eq(r.text.includes("Source: BBC News https://youtu.be/abc") || r.text.includes("Source: BBC News, "), true, "source kept");

// 7 an existing AI line is not duplicated; no AI label when not needed
r = blueskyText("Body.\nAI voice", true);
eq(r.text, "Body.\n\nAI voice", "AI line not duplicated");
eq(blueskyText("Body.", false).text, "Body.", "no AI line when not needed");
console.log("all bluesky text tests passed");
