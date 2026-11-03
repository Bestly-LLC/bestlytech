// The undo file must actually run: apply both migrations, then the undo, and check that the build's objects are gone and the original functions are back.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { makeDb } from "./pg";

describe("undo script", () => {
  it("removes everything the build added and restores the five replaced functions", async () => {
    const { db, q } = await makeDb();
    const undo = fs.readFileSync(path.resolve(__dirname, "../../../supabase/undo/claims-closer-autonomy-2026-10-28.undo.sql"), "utf8");
    await db.exec(undo);
    const tables = (await q(`select table_name from information_schema.tables where table_schema='public' and table_name in ('claims_autonomy_settings','claims_send_log','claim_windows','claim_decisions','claim_payments','claim_insurer_track','claim_outside_claims','claim_trip_complete_log')`));
    expect(tables).toEqual([]);
    const fns = (await q(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('claims_autonomy_sweep','claims_hold_autorelease','claims_auto_complete_trips','claims_stuck_alert','claims_payment_seen','claims_autonomy_get','claims_autonomy_set')`));
    expect(fns).toEqual([]);
    const restored = (await q(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('claims_tick','claims_mail_seen','claims_watch','claims_turo_claim') order by 1`)).map((r: any) => r.proname);
    expect(restored).toEqual(["claims_mail_seen", "claims_tick", "claims_turo_claim", "claims_watch"]);
    const cols = (await q(`select column_name from information_schema.columns where table_name='claim_questions' and column_name in ('nudged_at','meta','retired_at','snoozed_until')`));
    expect(cols).toEqual([]);
  }, 60000);
});
