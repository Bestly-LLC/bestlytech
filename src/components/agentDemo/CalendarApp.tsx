import { useMemo } from "react";
import { CalendarDays, ClipboardList, CreditCard, PhoneCall, ShieldCheck, Users, Check, StickyNote } from "lucide-react";
import { Avatar, Fx, type AppProps } from "./appKit";
import type { SidebarItem } from "./DesktopWindow";
import type { FiredEvent } from "./timeline";

/** Brightside Schedule: tomorrow's day view for three columns, with Maya booking into an open slot. */

export const calendarSidebar: SidebarItem[] = [
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "patients", label: "Patients", icon: Users },
  { id: "forms", label: "Forms", icon: ClipboardList },
  { id: "claims", label: "Insurance", icon: CreditCard },
];

const COLS = [
  { name: "Dr. Patel", role: "Dentist", tone: "a" },
  { name: "Dr. Lin", role: "Dentist", tone: "b" },
  { name: "Hygiene", role: "Hygienists", tone: "c" },
];

/** start/len are in half hours after 7:00 AM. */
type Block = { col: number; start: number; len: number; who: string; why: string; lunch?: boolean };
const BLOCKS: Block[] = [
  { col: 0, start: 0, len: 2, who: "R. Chavez", why: "Crown prep" },
  { col: 0, start: 2, len: 1, who: "T. Brooks", why: "Exam" },
  { col: 0, start: 4, len: 1, who: "S. Okafor", why: "Filling" },
  { col: 0, start: 6, len: 2, who: "M. Lindqvist", why: "Root canal" },
  { col: 0, start: 9, len: 1, who: "P. Anand", why: "Exam" },
  { col: 0, start: 10, len: 2, who: "Lunch", why: "", lunch: true },
  { col: 1, start: 0, len: 1, who: "C. Diaz", why: "Exam" },
  { col: 1, start: 2, len: 2, who: "H. Cho", why: "Crown seat" },
  { col: 1, start: 5, len: 2, who: "B. Rossi", why: "Extraction" },
  { col: 1, start: 8, len: 1, who: "N. Haddad", why: "Exam" },
  { col: 1, start: 10, len: 2, who: "Lunch", why: "", lunch: true },
  { col: 2, start: 0, len: 2, who: "A. Kerr", why: "Cleaning" },
  { col: 2, start: 3, len: 2, who: "D. Park", why: "Cleaning" },
  { col: 2, start: 6, len: 2, who: "L. Moreau", why: "Perio recall" },
  { col: 2, start: 8, len: 2, who: "T. Gold", why: "Cleaning" },
  { col: 2, start: 10, len: 2, who: "Lunch", why: "", lunch: true },
];
const SLOT = { col: 0, start: 5, len: 1 }; // 9:30 AM with Dr. Patel
const HOURS = ["7 AM", "8 AM", "9 AM", "10 AM", "11 AM", "12 PM"];

export type CalendarState = {
  call: { at: number } | null;
  slot: { at: number; provider: string; time: string } | null;
  insurance: { at: number; plan: string } | null;
  booked: { at: number; patient: string; reason: string; time: string; provider: string } | null;
  note: { at: number; text: string } | null;
};
export const calendarInitial: CalendarState = { call: null, slot: null, insurance: null, booked: null, note: null };

const s = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export function calendarReduce(init: CalendarState, events: FiredEvent[]): CalendarState {
  const st = { ...init };
  for (const e of events) {
    if (e.do === "incoming") st.call = { at: e.t };
    else if (e.do === "findSlot") st.slot = { at: e.t, provider: s(e.provider), time: s(e.time) };
    else if (e.do === "insurance") st.insurance = { at: e.t, plan: s(e.plan) };
    else if (e.do === "book")
      st.booked = { at: e.t, patient: s(e.patient), reason: s(e.reason), time: s(e.time), provider: s(e.provider) };
    else if (e.do === "note") st.note = { at: e.t, text: s(e.text) };
  }
  return st;
}

const short = (name: string) => {
  const p = name.split(/\s+/);
  return p.length > 1 ? `${p[0][0]}. ${p[p.length - 1]}` : name;
};

export function CalendarApp({ events, t, caller }: AppProps) {
  const st = useMemo(() => calendarReduce(calendarInitial, events), [events]);
  const { call, slot, insurance, booked, note } = st;
  const phone = caller.phone;
  const pos = (b: { start: number; len: number }) => ({
    top: `calc(var(--hh) * ${b.start})`,
    height: `calc(var(--hh) * ${b.len} - 3px)`,
  });

  return (
    <div className="cal">
      <div className="ap-head">
        <b>Tomorrow</b>
        <span className="ap-sub ad-nw">{booked ? "2 openings" : "3 openings"}</span>
      </div>
      <div className="cal-wrap">
        <div className="cal-grid">
          <div className="cal-heads">
            <span className="cal-gut" />
            {COLS.map((c) => (
              <div key={c.name} className="cal-colhead">
                <b>{c.name}</b>
                <span className="ap-sub">{c.role}</span>
              </div>
            ))}
          </div>
          <div className="cal-body">
            <div className="cal-gut">
              {HOURS.map((h) => (
                <span key={h} className="cal-hour ad-nw">
                  {h}
                </span>
              ))}
            </div>
            <div className="cal-cols">
              {COLS.map((c, ci) => (
                <div key={c.name} className="cal-col">
                  {ci === SLOT.col ? (
                    <Fx
                      at={booked?.at ?? slot?.at}
                      t={t}
                      className={`cal-block cal-slot is-short ${booked ? "is-booked" : slot ? "is-found" : ""}`}
                      style={pos(SLOT)}
                    >
                      {booked ? (
                        <>
                          <b>{short(booked.patient)}</b>
                          <span>{booked.reason.split("·")[0].trim()}</span>
                        </>
                      ) : (
                        <>
                          <b>Open</b>
                          <span className="ad-nw">{slot ? slot.time : "9:30 AM"}</span>
                        </>
                      )}
                    </Fx>
                  ) : null}
                  {BLOCKS.filter((b) => b.col === ci).map((b) => (
                    <div
                      key={`${b.col}-${b.start}`}
                      className={`cal-block tone-${c.tone} ${b.lunch ? "is-lunch" : ""} ${b.len === 1 ? "is-short" : ""}`}
                      style={pos(b)}
                    >
                      <b>{b.who}</b>
                      {b.why ? <span>{b.why}</span> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="cal-side">
          <div className="cal-sec">
            <div className="cal-sec-h">Phone</div>
            {call ? (
              <Fx at={call.at} t={t} tag={false} className="cal-row">
                <span className="hd-ring" aria-hidden="true">
                  <PhoneCall size={14} />
                </span>
                <div className="cal-row-t">
                  <b>{booked ? booked.patient : "Incoming call"}</b>
                  <span className="ap-sub ad-nw">{phone}</span>
                </div>
                <span className={`ad-pill ${booked ? "ad-pill-good" : "ad-pill-info"}`}>{booked ? "Booked" : "Maya on call"}</span>
              </Fx>
            ) : (
              <div className="cal-row ap-sub">No active call</div>
            )}
          </div>
          {insurance ? (
            <div className="cal-sec ad-in">
              <div className="cal-sec-h">Insurance</div>
              <Fx at={insurance.at} t={t} className="cal-row">
                <span className="cal-ic">
                  <ShieldCheck size={15} />
                </span>
                <div className="cal-row-t">
                  <b>{insurance.plan}</b>
                </div>
                <span className="ad-pill ad-pill-good">
                  <Check size={11} /> Accepted
                </span>
              </Fx>
            </div>
          ) : null}
          {booked ? (
            <div className="cal-sec ad-in">
              <div className="cal-sec-h">Appointment</div>
              <Fx at={booked.at} t={t} className="cal-row">
                <Avatar name={booked.patient} size={28} />
                <div className="cal-row-t">
                  <b>{booked.patient}</b>
                  <span className="ap-sub">
                    <span className="ad-nw">Tomorrow, {booked.time}</span>, {booked.provider}
                  </span>
                  <span className="ap-sub">{booked.reason}</span>
                </div>
              </Fx>
            </div>
          ) : null}
          {note ? (
            <div className="cal-sec ad-in">
              <div className="cal-sec-h">Note for {booked ? booked.provider : "the dentist"}</div>
              <Fx at={note.at} t={t} className="cal-row cal-note">
                <span className="cal-ic">
                  <StickyNote size={15} />
                </span>
                <p>{note.text}</p>
              </Fx>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
