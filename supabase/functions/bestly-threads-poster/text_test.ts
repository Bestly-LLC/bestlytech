import { threadsText, tlen, AI_LINE } from "./text.ts";
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL", m, a, b); Deno.exit(1); } else console.log("ok  ", m); };

// 1 short caption with AI label, hashtags -> topic only
let r = threadsText('South Florida will host the G20.\n\nSource: CBS Miami on YouTube. Full video: https://youtu.be/abc\n\n#news #minutenewsdaily', true);
eq(r.text.endsWith("\n\n" + AI_LINE), true, "AI voice is the last line");
eq(r.topic, "news", "first hashtag becomes topic");
eq(r.text.includes("#"), false, "no hashtags left in text");
// 2 More line is kept and sits above the AI line
r = threadsText("Hello world.\n\nMore: minutenewsdaily.com", true);
eq(r.text, "Hello world.\n\nMore: minutenewsdaily.com\nAI voice", "More kept, AI last");
// 3 no AI label
r = threadsText("Hello world.\nMore: minutenewsdaily.com", false);
eq(r.text, "Hello world.\n\nMore: minutenewsdaily.com", "no AI line when not needed");
// 4 long caption is trimmed to <= 500, never with dots, tail intact
const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ") + "\n\nMore: minutenewsdaily.com";
r = threadsText(long, true);
eq(tlen(r.text) <= 500, true, "<= 500 chars (" + tlen(r.text) + ")");
eq(r.text.includes("..."), false, "no ellipsis");
eq(r.text.endsWith("More: minutenewsdaily.com\nAI voice"), true, "tail intact after trim");
eq(r.trimmed, true, "reports trimmed");
eq(/\.\n\nMore/.test(r.text), true, "cut at a sentence end");
// 5 an existing AI line is not duplicated
r = threadsText("Body.\nAI voice", true);
eq(r.text, "Body.\n\nAI voice", "AI line not duplicated");
// 6 emoji count as 4
eq(tlen("a😀"), 5, "emoji counted as 4 bytes");
// 7 tag cleaning
r = threadsText("x\n#Breaking_News2", false);
eq(r.topic, "Breaking_News2", "topic tag kept clean");
console.log("all text tests passed");
