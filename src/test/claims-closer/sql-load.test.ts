import { describe, expect, it } from "vitest";
import { makeDb } from "./pg";
describe("migrations load", () => { it("both autonomy migrations run on the stub schema", async () => { const { q } = await makeDb(); expect((await q("select count(*)::int n from claims_autonomy_settings"))[0].n).toBe(1); }, 60000); });
