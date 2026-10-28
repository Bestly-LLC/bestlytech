import { describe, expect, it } from "vitest";
import { decideSend } from "../../../supabase/functions/claims-closer/send.ts";

const open = { id: "c", status: "waiting_guest", history: false, outbound_hold: false };
const gateOk = { ok: true, live: false };
const env = { answers: ["Skip we got an estimate from tesla"], otherShopNames: ["Pristine Collision Center"], insurerMode: "full" };
const mail = { channel: "shop_email" as const, recipient: "est@shop.test", purpose: "estimate_request", text: "Hi team,\n\nCould you send an estimate?" };

describe("canSend decision", () => {
  it("allows a clean shop email when nothing blocks it", () => expect(decideSend(open, gateOk, mail, env).ok).toBe(true));
  it("blocks on outbound_hold for email, calls and Turo actions alike", () => {
    for (const channel of ["shop_email", "ava_call", "turo_action", "insurer_email", "garage_email"] as const)
      expect(decideSend({ ...open, outbound_hold: true, outbound_hold_reason: "Jared" }, gateOk, { ...mail, channel, recipient: channel === "ava_call" ? "+13105550100" : "a@b.test" }, env).code).toBe("hold");
  });
  it("blocks during a live trip and while the gate is closed, and fails closed when the gate lookup failed", () => {
    expect(decideSend(open, { ok: false, live: true }, mail, env).code).toBe("live_trip");
    expect(decideSend(open, { ok: false, live: false, reason: "waiting for Complete trip" }, mail, env).code).toBe("gate_closed");
    expect(decideSend(open, null, mail, env).code).toBe("gate_lookup");
  });
  it("blocks history and closed cases", () => {
    expect(decideSend({ ...open, history: true }, gateOk, mail, env).code).toBe("history");
    expect(decideSend({ ...open, status: "paid" }, gateOk, mail, env).code).toBe("closed");
  });
  it("blocks dollar amounts unless allowed, Turo voice, reviews", () => {
    expect(decideSend(open, gateOk, { ...mail, text: "It will cost $900" }, env).code).toBe("guard");
    expect(decideSend(open, gateOk, { ...mail, text: "It will cost $900", allowedAmounts: [900] }, env).ok).toBe(true);
    expect(decideSend(open, gateOk, { ...mail, text: "The deductible is high" }, env).code).toBe("guard");
    expect(decideSend(open, gateOk, { ...mail, text: "please leave a five star review" }, env).code).toBe("guard");
  });
  it("blocks text that repeats Jared's note", () => expect(decideSend(open, gateOk, { ...mail, text: "we got an estimate from tesla" }, env).code).toBe("overlap"));
  it("insurer channels need insurer_contact_mode = full", () => {
    expect(decideSend(open, gateOk, { channel: "insurer_email", recipient: "adj@ins.test", purpose: "open_claim", text: "Hello" }, { ...env, insurerMode: "draft_only" }).code).toBe("insurer_mode");
    expect(decideSend(open, gateOk, { channel: "insurer_email", recipient: "adj@ins.test", purpose: "open_claim", text: "Hello" }, env).ok).toBe(true);
  });
  it("needs a well-formed recipient", () => expect(decideSend(open, gateOk, { ...mail, recipient: "nope" }, env).code).toBe("recipient"));
});
