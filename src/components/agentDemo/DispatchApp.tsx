import { useMemo } from "react";
import { ClipboardList, MapPin, PhoneCall, Truck, Users, Wrench, Zap, StickyNote } from "lucide-react";
import { Avatar, Fx, useFlip, type AppProps } from "./appKit";
import type { SidebarItem } from "./DesktopWindow";
import { Glued } from "./RevealText";
import type { FiredEvent } from "./timeline";

/** Ridgeline Dispatch: a job board with a tech list. Maya opens the job, then moves it to a tech who is on call. */

export const dispatchSidebar: SidebarItem[] = [
  { id: "board", label: "Job board", icon: ClipboardList, badge: "5" },
  { id: "map", label: "Map", icon: MapPin },
  { id: "techs", label: "Technicians", icon: Users },
  { id: "invoices", label: "Invoices", icon: Wrench },
];

type Col = "new" | "assigned" | "way" | "done";
const COLS: { id: Col; label: string }[] = [
  { id: "new", label: "New" },
  { id: "assigned", label: "Assigned" },
  { id: "way", label: "On the way" },
  { id: "done", label: "Done" },
];

type Job = { id: string; col: Col; title: string; line: string; tech?: string; eta?: string };
const SEED: Job[] = [
  { id: "j1", col: "new", title: "Estimate: deck drain", line: "Tomorrow, 10:00 AM" },
  { id: "j2", col: "assigned", title: "Water heater flush", line: "Tomorrow, 7:30 AM", tech: "Amir" },
  { id: "j3", col: "way", title: "Garbage disposal", line: "77 Birch Way", tech: "Dee", eta: "9:25 PM" },
  { id: "j4", col: "done", title: "Clogged drain", line: "410 Cedar St", tech: "Luis" },
  { id: "j5", col: "done", title: "Faucet install", line: "92 Maple Ln", tech: "Amir" },
];

type TechRow = { name: string; state: string; tone: "good" | "info" | "mute" | "warn" };
const TECHS: TechRow[] = [
  { name: "Luis", state: "On call, 12 min away", tone: "good" },
  { name: "Dee", state: "On a job", tone: "info" },
  { name: "Amir", state: "Off shift", tone: "mute" },
  { name: "Marcus", state: "Off shift", tone: "mute" },
];

export type DispatchState = {
  call: { at: number } | null;
  job: { at: number; title: string; priority: string; address?: { at: number; text: string } } | null;
  assign: { at: number; tech: string; eta: string; fee: string } | null;
  note: { at: number; text: string } | null;
};
export const dispatchInitial: DispatchState = { call: null, job: null, assign: null, note: null };
const s = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export function dispatchReduce(init: DispatchState, events: FiredEvent[]): DispatchState {
  const st: DispatchState = { ...init };
  for (const e of events) {
    if (e.do === "incoming") st.call = { at: e.t };
    else if (e.do === "newJob") st.job = { at: e.t, title: s(e.title), priority: s(e.priority) };
    else if (e.do === "address" && st.job) st.job = { ...st.job, address: { at: e.t, text: s(e.address) } };
    else if (e.do === "assign") st.assign = { at: e.t, tech: s(e.tech), eta: s(e.eta), fee: s(e.fee) };
    else if (e.do === "note") st.note = { at: e.t, text: s(e.text) };
  }
  return st;
}

export function DispatchApp({ events, t, caller }: AppProps) {
  const st = useMemo(() => dispatchReduce(dispatchInitial, events), [events]);
  const { call, job, assign, note } = st;
  const col: Col = assign ? "way" : "new";
  const flip = useFlip(`${job ? 1 : 0}${assign ? col : ""}${job?.address ? "a" : ""}`);
  const phone = caller.phone;

  const seeded = (c: Col) => SEED.filter((j) => j.col === c);
  const newCard = job ? (
    <Fx
      key="live"
      as="div"
      at={assign?.at ?? job.address?.at ?? job.at}
      t={t}
      rootRef={flip.ref("live")}
      className={`dp-card dp-live ${job.priority === "Emergency" ? "is-urgent" : ""}`}
    >
      <div className="dp-live-in">
        <div className="dp-card-top">
          {job.priority ? (
            <span className="ad-pill ad-pill-bad">
              <Zap size={10} /> {job.priority}
            </span>
          ) : null}
          <span className="ap-sub ad-nw">{assign ? "Assigned just now" : "Just now"}</span>
        </div>
        <b className="dp-t">{job.title}</b>
        {job.address ? (
          <div className="dp-l dp-addr">
            <MapPin size={11} />
            <span>{job.address.text}</span>
          </div>
        ) : null}
        <div className="dp-l dp-who">
          {job.address ? <span>{caller.name}</span> : null}
          <span className="ad-nw">{phone}</span>
        </div>
        {assign ? (
          <div className="dp-assign">
            <Truck size={12} />
            <b className="ad-nw">
              {assign.tech} · ETA {assign.eta}
            </b>
          </div>
        ) : null}
        {assign ? <div className="dp-fee">{assign.fee}</div> : null}
      </div>
    </Fx>
  ) : null;

  return (
    <div className="dp">
      <div className="ap-head">
        <b>Tonight</b>
        {call ? (
          <Fx at={call.at} t={t} tag={false} className="dp-call">
            <span className="hd-ring" aria-hidden="true">
              <PhoneCall size={12} />
            </span>
            <b>{job ? "Maya on call" : "Incoming call"}</b>
            <span className="ad-nw ap-sub">{phone}</span>
          </Fx>
        ) : (
          <span className="ap-sub">5 jobs</span>
        )}
      </div>

      <div className="dp-techs">
        {TECHS.map((x) => {
          const luis = x.name === "Luis";
          const state = luis && assign ? "En route" : x.state;
          const tone = luis && assign ? "info" : x.tone;
          return (
            <Fx key={x.name} at={luis ? assign?.at : undefined} t={t} tag={false} className="dp-tech">
              <Avatar name={x.name} size={24} />
              <div>
                <b>{x.name}</b>
                <span className={`dp-st dp-st-${tone}`}>{state}</span>
              </div>
            </Fx>
          );
        })}
      </div>

      <div className="dp-board" ref={flip.root}>
        {COLS.map((c) => (
          <div key={c.id} className="dp-col">
            <div className="dp-col-h">
              <b>{c.label}</b>
              <span className="ap-sub">{seeded(c.id).length + (job && col === c.id ? 1 : 0)}</span>
            </div>
            <div className="dp-cards">
              {job && col === c.id ? newCard : null}
              {seeded(c.id).map((j) => (
                <div key={j.id} ref={flip.ref(j.id)} className="dp-card">
                  <b className="dp-t">{j.title}</b>
                  <div className="dp-l"><Glued text={j.line} /></div>
                  {j.tech ? (
                    <div className="dp-l dp-tech-l">
                      <Avatar name={j.tech} size={16} />
                      <span>
                        {j.tech}
                        {j.eta ? <span className="ad-nw"> · ETA {j.eta}</span> : null}
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {note ? (
        <Fx at={note.at} t={t} className="dp-note ad-in">
          <StickyNote size={13} />
          <span>
            <b>Job note</b> {note.text}
          </span>
        </Fx>
      ) : null}
    </div>
  );
}
