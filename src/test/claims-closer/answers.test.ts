import { describe, expect, it } from "vitest";
import { classifyByRules, composeShopAnswer, composeShopClose, groupAnswers, parseShopAsk, planAnswer, questionStale, checkAnswerDerived, SHOP_CLOSE_LINE } from "../../../supabase/functions/claims-closer/answers.ts";
import { longestSharedWords, overlapsAnswers, sharesRunWith } from "../../../supabase/functions/claims-closer/guards.ts";

describe("intent", () => {
  it("reads Jared's exact note as skip", () => expect(classifyByRules("Skip we got an estimate from tesla").intent).toBe("skip"));
  it.each([["drop this shop", "skip"], ["no need, already got a quote", "skip"], ["hold off until tomorrow", "wait"], ["go ahead", "proceed"], ["answer", "proceed"], ["drop", "skip"], ["wait", "wait"]])("%s -> %s", (t, i) => expect(classifyByRules(t, [{ value: "answer" }, { value: "drop" }, { value: "wait" }]).intent).toBe(i));
  it("an unclear note is not confident, so nothing is sent on rules alone", () => expect(classifyByRules("hmm let me think about the paint").confident).toBe(false));
});

describe("what a shop asked, answered from the record only", () => {
  it("VIN, photos and how-did-you-hear are answered; dirt vs damage is not", () => {
    expect(parseShopAsk("better photos of fender and rim/tire, VIN")).toMatchObject({ vin: true, photos: true });
    expect(parseShopAsk("how you heard about us").howHeard).toBe(true);
    expect(parseShopAsk("Clarify whether fender scuffing is dirt or damage").unclear.length).toBe(1);
  });
  it("writes its own words", () => {
    const a = composeShopAnswer("Pristine Collision Center Hollywood", parseShopAsk("better photos of fender and rim/tire, VIN"), { vin: "5YJ3E1EA0LF000001", photoCount: 6 });
    expect(a.text).toContain("The VIN is 5YJ3E1EA0LF000001.");
    expect(a.attachPhotos).toBe(true);
    expect(composeShopAnswer("AGC", parseShopAsk("how you heard about us"), {}).text).toContain("Found you online.");
  });
  it("sends nothing when it cannot answer", () => expect(composeShopAnswer("P", parseShopAsk("is the fender scuffing dirt or damage"), {}).text).toBeNull());
  it("the close line is fixed, short, and says nothing else", () => {
    expect(composeShopClose("AGC Collision Center")).toBe(`Hi AGC Collision Center team,\n\n${SHOP_CLOSE_LINE}`);
    expect(checkAnswerDerived(composeShopClose("AGC Collision Center"), { answers: ["Skip we got an estimate from tesla"], otherShopNames: ["Pristine Collision Center"] }).ok).toBe(true);
  });
});

describe("the answer-derived outbound check", () => {
  const answers = ["Skip we got an estimate from tesla"];
  it("blocks his words, an amount, Tesla, reviews and Turo voice", () => {
    for (const t of ["Hi,\n\nSkip we got an estimate from tesla", "we got an estimate elsewhere", "All set, thanks. Tesla quoted us.", "Thanks, the repair is $1,200.", "Please leave a review.", "Turo's plan max is $500."])
      expect(checkAnswerDerived(t, { answers }).ok).toBe(false);
  });
  it("short button values are not prose", () => expect(overlapsAnswers("we will retry the walk in", ["walk_in", "retry"]).hit).toBe(false));
  it("word-run detection", () => { expect(longestSharedWords("a b c d e", "x b c d e y")).toBe(4); expect(sharesRunWith("Found you online.", "found you online")).toBe(false); });
});

describe("one answer, many questions", () => {
  const qs = [1, 2, 3].map((i) => ({ id: `q${i}`, case_id: "c1", key: `shop-asks-e${i}`, answer: "Skip we got an estimate from tesla", asked_at: new Date().toISOString(), meta: { estimate_id: `e${i}` } }));
  it("groups by case and answer", () => expect(groupAnswers(qs)).toHaveLength(1));
  it("plans one decision with an effect per shop", () => {
    const d = planAnswer(qs, "skip", { staleBy: {}, estimateIdOf: (q) => ({ id: q.meta.estimate_id, shop: q.id }) });
    expect(d.questionIds).toHaveLength(3); expect(d.effects.every((e) => e.type === "close_shop")).toBe(true);
    expect(JSON.stringify(d.effects)).not.toContain("tesla");
  });
});

describe("stale questions", () => {
  const base = { now: Date.now(), caseClosed: false, estimateObtained: false, resolveWindowClosed: false, shopThreadOpen: true as boolean | null };
  const q = (days: number) => ({ key: "shop-asks-e1", asked_at: new Date(Date.now() - days * 864e5).toISOString() });
  it("young questions are never stale", () => expect(questionStale(q(2), { ...base, resolveWindowClosed: true }).stale).toBe(false));
  it("old + Turo window closed", () => expect(questionStale(q(21), { ...base, resolveWindowClosed: true }).stale).toBe(true));
  it("old + estimate already in", () => expect(questionStale(q(8), { ...base, estimateObtained: true }).stale).toBe(true));
  it("old + still live is kept", () => expect(questionStale(q(8), base).stale).toBe(false));
  it("a closed case retires everything", () => expect(questionStale(q(0), { ...base, caseClosed: true }).stale).toBe(true));
});
