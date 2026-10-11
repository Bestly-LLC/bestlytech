"""SkyTouch Front Desk: reads client texts that Google Voice forwards to Gmail (bestly-pi, hourly at :03). No AI, free.

Installed as /opt/bestly/cron/jobs/skytouch_triage.py; run by /opt/bestly/cron/run.sh skytouch_triage (heartbeat via runjob.py).
Replaces the Claude scheduled task "SkyTouch text auto-responder" (trig_01Fp91TUjwpmZ6afXKQLWMUZ, left disabled as the fallback).

Rules carried over from that task, unchanged:
  * The bot may send exactly one thing on its own: the first intake reply to a brand-new inquiry (and only when
    skytouch_settings.auto_first_reply is on; it ships off, so the reply becomes a card).
  * Everything else (a named service, length or time; any hard stop) waits for Jared. Nothing is sent, the thread gets the
    SkyTouch/Flagged label, and a card shows exactly what they asked plus a reply he can approve.
  * Hard stops, sent nowhere: sexual requests, rate talk, the address, "what's included", RoofGuard / roofing texts, anything
    unclear. A thread whose newest message is older than the stale window (24 h) is flagged, never answered.
  * Texts from Jared's own cell (816) 500-7236 are instructions: his availability and approvals. Never a client. The address is never sent.
  * Gmail labels SkyTouch/Handled and SkyTouch/Flagged track thread status.

When paused it writes one "paused" heartbeat and exits before touching Gmail. With no Gmail login saved it says
"skip: Gmail not connected yet". Flags: --dry (read only, writes and sends nothing, no heartbeat), --force-on (pretend the switches
are on, still read only; for testing).
"""
import imaplib
import socket

import lib  # noqa: E402  (/opt/bestly/cron/lib.py)

from jobs import skytouch_common as C  # noqa: E402

JOB = "skytouch_triage"
SLUG = "skytouch-triage"
MAX_THREADS = 30
MAX_MSGS = 20


def log(msg):
    print("  " + msg, flush=True)


def _thread(gm, thrid):
    msgs = []
    for u in gm.thread_uids(thrid)[:MAX_MSGS]:
        m = gm.fetch(u)
        if m:
            msgs.append(m)
    msgs.sort(key=lambda m: m["date"])
    return msgs


def main(argv):
    force = "--force-on" in argv
    dry = "--dry" in argv or force

    g = C.gate(lib, JOB)
    if not (g["job_on"] or force):
        if not dry:
            C.beat(lib, SLUG, True, "paused: switched off on the SkyTouch page")
        return "skip: paused (switched off on /admin/skytouch)"

    pw = C.secret(lib, "pi:skytouch:gmail_app_password")
    if not pw:
        if not dry:
            C.beat(lib, SLUG, False, "skip: Gmail not connected yet")
        return "skip: Gmail not connected yet (save the app password on /admin/skytouch)"

    try:
        gm = C.Gmail(pw, readonly=dry)
    except (imaplib.IMAP4.error, OSError, socket.timeout) as e:
        if not dry:
            C.beat(lib, SLUG, False, "skip: Gmail rejected the login")
            lib.notify("SkyTouch Front Desk: Gmail would not let me in",
                       "Open SkyTouch and save a fresh Gmail app password. Until then I cannot read texts.",
                       severity="warning", push=False, url="/admin/skytouch", dedupe="skytouch.login." + str(C.today()))
        return "skip: Gmail rejected the login (" + type(e).__name__ + ")"

    counts = {"new": 0, "sent": 0, "intake_draft": 0, "needs_approval": 0, "flagged": 0, "stale": 0, "handled_before": 0}
    try:
        # ---- Step 1: Jared's own texts: today's availability and anything that looks like an approval
        jared_recent, avail_text = [], None
        for u in gm.search("from:{} {} newer_than:3d".format(C.GV_DOMAIN, C.JARED)):
            m = gm.fetch(u)
            if not m or not C.is_jared(C.sender_number(m["from_addr"])):
                continue
            jared_recent.append(m)
        jared_recent.sort(key=lambda m: m["date"])
        for m in jared_recent:
            if m["date"].date() == C.today() and m["text"] and not C.looks_like_approval(m["text"]) and (
                    C.parse_hours(m["text"]) is not None):
                avail_text = m["text"][:80]
        approvals = [m for m in jared_recent if C.looks_like_approval(m["text"])]

        # ---- Step 2: find new client threads
        seen = {}
        for u in gm.search("from:{} newer_than:2d".format(C.GV_DOMAIN)):
            m = gm.fetch(u)
            if not m or not m["thrid"] or C.is_jared(C.sender_number(m["from_addr"])):
                continue
            seen.setdefault(m["thrid"], m)
            if len(seen) >= MAX_THREADS:
                break

        for thrid in seen:
            msgs = _thread(gm, thrid)
            if not msgs:
                continue
            labels = " ".join(m["labels"] for m in msgs)
            if C.LABEL_HANDLED in labels or C.LABEL_FLAGGED in labels:
                counts["handled_before"] += 1
                continue
            inbound = [m for m in msgs if C.is_gv_address(m["from_addr"]) and not C.is_jared(C.sender_number(m["from_addr"]))]
            outbound = [m for m in msgs if m not in inbound]
            if not inbound:
                continue
            last_in = inbound[-1]
            number = C.sender_number(last_in["from_addr"])
            name = C.first_name(last_in["from_name"])
            counts["new"] += 1
            uids = [m["uid"] for m in msgs]

            # ---- Step 3: staleness comes before everything
            if C.age_hours(msgs[-1]["date"]) > g["stale_hours"]:
                counts["stale"] += 1
                card = {"kind": "stale", "thread_key": thrid, "client_number": number, "client_name": name,
                        "ask": last_in["text"][-300:], "why": "Newest message is over {} hours old. A late reply is worse than silence, so nothing was sent.".format(g["stale_hours"])}
                log("{} ...{}: stale".format(JOB, number[-4:]))
                if not dry:
                    lib.rpc("skytouch_card_save", p=card)
                    gm.label(uids, C.LABEL_FLAGGED)
                continue

            verdict = C.classify([m["text"] for m in inbound], bool(outbound), name)
            kind = verdict["kind"]
            log("{} ...{}: {}".format(JOB, number[-4:], kind))
            note = None
            for a in approvals:
                t = a["text"].lower()
                if (name and name.lower() in t) or (number[-4:] and number[-4:] in t):
                    note = a["text"][:200]

            if kind == "intake":
                sent = False
                if g["auto_first_reply"] and not dry:
                    if lib.rpc("skytouch_intake_claim", p_thread_key=thrid, p_number=number, p_name=name, p_ask=last_in["text"][-300:]):
                        try:
                            C.send_first_intake(pw, last_in, name)
                            gm.label(uids, C.LABEL_HANDLED)
                            lib.rpc("skytouch_intake_done", p_thread_key=thrid, p_ok=True)
                            counts["sent"] += 1
                            sent = True
                        except Exception as e:  # noqa: BLE001
                            lib.rpc("skytouch_intake_done", p_thread_key=thrid, p_ok=False, p_why="Send failed: " + type(e).__name__)
                            counts["flagged"] += 1
                            sent = True  # do not also draft; the failed-send card is the one to look at
                    else:
                        sent = True  # already claimed on an earlier run: never a second hello
                if not sent:
                    counts["intake_draft"] += 1
                    if not dry:
                        lib.rpc("skytouch_card_save", p={"kind": "intake_draft", "thread_key": thrid, "client_number": number,
                                "client_name": name, "ask": last_in["text"][-300:], "why": verdict["why"] + " Auto-reply is off, so this is a draft for you to send.",
                                "suggested_reply": verdict["suggested_reply"], "jared_said": note})
                continue

            # needs_approval or flagged: nothing is sent, the thread is labeled, a card shows what they asked
            k2 = "needs_approval" if kind == "needs_approval" else "flagged"
            counts[k2] += 1
            fh = None
            if k2 == "needs_approval" and verdict["when"] and avail_text:
                fh = C.fits(avail_text, verdict["when"])
            card = {"kind": k2, "thread_key": thrid, "client_number": number, "client_name": name, "ask": verdict["ask"],
                    "why": verdict["why"], "suggested_reply": verdict["suggested_reply"], "jared_said": note}
            if fh is not None:
                card["fits_hours"] = fh
            if not dry:
                lib.rpc("skytouch_card_save", p=card)
                gm.label(uids, C.LABEL_FLAGGED)

        if not dry:
            st = {"counts": dict(counts, jared_recent=[{"at": C.fmt_time(m["date"]), "text": m["text"][:140]} for m in jared_recent[-5:]],
                                 at=C.fmt_time(C.datetime.now(C.TZ)))}
            if avail_text:
                st["availability_date"], st["availability_text"] = str(C.today()), avail_text
            lib.rpc("skytouch_state_save", p=st)
    finally:
        gm.close()

    summary = ("{} new texts, {} intake sent, {} intake drafted, {} waiting on Jared, {} flagged, {} stale, {} already handled"
               .format(counts["new"], counts["sent"], counts["intake_draft"], counts["needs_approval"], counts["flagged"], counts["stale"], counts["handled_before"]))
    if dry:
        return "ok (dry run, nothing written or sent): " + summary
    C.beat(lib, SLUG, True, summary)
    return "ok: " + summary
