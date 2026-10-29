// The hard rules for every email the Insurance Filer writes (supabase/functions/insurance-filer/rules.ts).
import { describe, expect, it } from "vitest";
import { guard, templateBody, withSig } from "../../../../supabase/functions/insurance-filer/rules";

describe("draft guard", () => {
  it("stops Turo plan talk, the host responsibility, and reviews", () => {
    expect(guard("Turo's Max earn plan applies", null)).toMatch(/plan/);
    expect(guard("The host damage responsibility is covered", null)).toMatch(/plan/);
    expect(guard("Please leave a review", null)).toMatch(/review/);
    expect(guard("My deductible is waived", null)).toMatch(/plan/);
  });
  it("allows a dollar amount only when it is the finalized estimate", () => {
    expect(guard("The cost is $2,750", null)).toMatch(/dollar/);
    expect(guard("The estimate is $1,845.20", 1845.2)).toBeNull();
    expect(guard("The estimate is $1,845.20 and a $50 fee", 1845.2)).toMatch(/dollar/);
    expect(guard("Photos are attached.", null)).toBeNull();
  });
});

describe("sign-off", () => {
  it("replaces anything the writer put at the end with Claims Closer", () => {
    expect(withSig("Hello Maria,\n\nPhotos attached.\n\nBest regards,\nJared")).toBe("Hello Maria,\n\nPhotos attached.\n\nThank you,\nClaims Closer, for Jared Best");
    expect(withSig("Hello Maria,\n\nPhotos attached.")).toMatch(/Claims Closer, for Jared Best$/);
  });
});

describe("template fallback", () => {
  const ctx = {
    draft: { kind: "adjuster_reply", subject: "Re: Claim 26-1234567" }, case: { claim_no: "26-1234567", adjuster_name: "Maria Lopez", policy_no: "870703450" },
    facts: { "vehicle.year": "2020", "vehicle.model": "Model 3", "loss.date": "10/26/2026", "loss.city": "San Diego", "loss.state": "CA", "loss.damage": "Passenger door scratches" },
    turo_claim_no: "1108308", attachments: [{ source: "estimate_doc", name: "repair-estimate.pdf" }, { source: "after", name: "damage-photo-2.jpg" }, { source: "return", name: "damage-photo-3.jpg" }],
  };
  it("says what is attached, mentions the Turo claim once, and is signed", () => {
    const t = templateBody(ctx);
    expect(t.body).toContain("Hello Maria,");
    expect(t.body).toContain("2 photos of the damage and the repair estimate");
    expect(t.body).toContain("Turo claim 1108308");
    expect(t.body.endsWith("Claims Closer, for Jared Best")).toBe(true);
    expect(guard(t.body, null)).toBeNull();
  });
  it("a first email reports the claim and asks for the claim number", () => {
    const t = templateBody({ ...ctx, draft: { kind: "first_email", subject: "New claim" }, case: { ...ctx.case, adjuster_name: null, claim_no: null } });
    expect(t.body).toContain("Hello there,");
    expect(t.body).toContain("870703450");
    expect(t.body).toContain("Please send me the claim number");
    expect(guard(t.body, null)).toBeNull();
  });
});
