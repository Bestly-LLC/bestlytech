// Offline test for the owner-PIN spoken-form normalizer. Throwaway values only; the real PIN is never in the repo.
//   node --experimental-strip-types supabase/functions/_shared/ava-owner-pin.test.ts
//   deno test --no-lock --node-modules-dir=none supabase/functions/_shared/ava-owner-pin.test.ts   (the same checks, if you run it under deno)
import { countPlainPins, hasPlainPin, pinCandidates, redactDeep, redactPins } from "./ava-owner-pin.ts";

let fails = 0, total = 0;
const has = (said: string, want: string) => {
  total++; const got = pinCandidates(said);
  if (!got.includes(want)) { fails++; console.error(`FAIL: "${said}" -> [${got.join(",")}] wanted ${want}`); }
};
const none = (said: string) => { total++; const got = pinCandidates(said); if (got.length) { fails++; console.error(`FAIL: "${said}" should give nothing, got [${got.join(",")}]`); } };
const eq = (a: unknown, b: unknown, m: string) => { total++; if (a !== b) { fails++; console.error(`FAIL ${m}: expected ${b}, got ${a}`); } };

// the date form speech-to-text produces: 03/17/29 is "031729"
for (const s of ["03/17/29", "3/17/29", "03-17-29", "03.17.29", "3 17 29", "03/17/2029", "March 17 2029", "March 17th, 2029", "March seventeenth twenty twenty nine",
  "three seventeen twenty nine", "oh three seventeen twenty nine", "zero three seventeen twenty nine", "my pin is 03/17/29 thanks", "031729", "0 3 1 7 2 9",
  "zero three one seven two nine", "oh three one seven two nine", "o three one seven two nine", "03 17 2029", "three seventeen two thousand twenty nine",
  "0317 29", "03172029"]) has(s, "031729");
// a PIN that is not date-shaped
for (const s of ["482915", "4 8 2 9 1 5", "four eight two nine one five", "forty eight twenty nine fifteen", "48-29-15", "48 29 15"] ) has(s, "482915");
// double / triple
has("double four two three one five", "442315");
has("triple one two three four", "111234");
has("one one one two two two", "111222");
has("eleven twenty two thirty three", "112233");
has("seventeen forty nine twenty", "174920");
// junk gives nothing
none(""); none("hello there"); none("12345"); none("what is the pin"); none("the weather is nice today");
// bounded
eq(pinCandidates("1 2 3 4 5 6 7 8 9 0 1 2 3 4").length <= 6, true, "max 6");
eq(pinCandidates("x".repeat(5000)).length, 0, "long junk");
eq(pinCandidates("9".repeat(5000)).length <= 6, true, "long digits bounded");

// redaction: a PIN-looking number near the word PIN, but nothing else
const bad = "Executive Owner Mode. The security PIN is 482915. If the caller says it, unlock.";
eq(hasPlainPin(bad), true, "detect six near PIN"); eq(redactPins(bad).includes("482915"), false, "redacted six");
eq(hasPlainPin("The passcode is 04/22/31 ok"), true, "detect date near passcode");
eq(hasPlainPin("Call 8165550123 about order 123456 tomorrow"), false, "phone and order number are not PINs");
eq(hasPlainPin("PIN"), false, "the word alone");
eq(redactPins("Ask for his PIN once. Do not repeat the PIN."), "Ask for his PIN once. Do not repeat the PIN.", "prose untouched");
const deep = redactDeep({ a: ["verification code 654321 here", { b: "pin: 112233" }], n: 7 });
eq(deep.changed, 2, "deep changed"); eq(countPlainPins(deep.value), 0, "deep clean"); eq((deep.value as any).n, 7, "non-strings kept");
eq(countPlainPins({ x: "passcode 112233", y: ["pin 445566"] }), 2, "count");

if (fails) { console.error(`${fails} of ${total} checks failed`); throw new Error(`${fails} failed`); }
console.log(`ava-owner-pin: ${total} checks passed`);
