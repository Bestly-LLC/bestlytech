import { useMemo } from "react";
import { CalendarDays, ChefHat, PhoneCall, Settings, Users, Utensils } from "lucide-react";
import { Fx, type AppProps } from "./appKit";
import type { SidebarItem } from "./DesktopWindow";
import type { FiredEvent } from "./timeline";

/** Lume Reservations: Friday's book and a small floor map. Maya finds a time that works, holds a table, then confirms it. */

export const reservationsSidebar: SidebarItem[] = [
  { id: "book", label: "Reservations", icon: CalendarDays },
  { id: "floor", label: "Floor", icon: Utensils },
  { id: "guests", label: "Guests", icon: Users },
  { id: "kitchen", label: "Kitchen", icon: ChefHat },
  { id: "settings", label: "Settings", icon: Settings },
];

type Row = { id: string; time: string; name?: string; party?: number; open?: boolean };
const ROWS: Row[] = [
  { id: "r1", time: "5:30 PM", name: "Okafor", party: 2 },
  { id: "r2", time: "5:45 PM", name: "Liang", party: 4 },
  { id: "r3", time: "6:00 PM", name: "Bell", party: 2 },
  { id: "r4", time: "6:15 PM", name: "Hartwell", party: 3 },
  { id: "o1", time: "6:45 PM", open: true },
  { id: "r5", time: "7:00 PM", name: "Moretti", party: 4 },
  { id: "r6", time: "7:30 PM", name: "Davenport", party: 6 },
  { id: "r7", time: "7:30 PM", name: "Grant", party: 4 },
  { id: "o2", time: "8:15 PM", open: true },
  { id: "r8", time: "8:30 PM", name: "Hughes", party: 2 },
];

type Tag = { at: number; text: string; tone: string };
export type ReservationsState = {
  call: { at: number } | null;
  check: { at: number; time: string; offers: string[] } | null;
  hold: { at: number; time: string; table: string } | null;
  name: { at: number; name: string } | null;
  tags: Tag[];
  confirm: { at: number } | null;
};
export const reservationsInitial: ReservationsState = { call: null, check: null, hold: null, name: null, tags: [], confirm: null };
const s = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export function reservationsReduce(init: ReservationsState, events: FiredEvent[]): ReservationsState {
  const st: ReservationsState = { ...init, tags: [] };
  for (const e of events) {
    if (e.do === "incoming") st.call = { at: e.t };
    else if (e.do === "check") st.check = { at: e.t, time: s(e.time), offers: Array.isArray(e.offers) ? (e.offers as string[]) : [] };
    else if (e.do === "hold") st.hold = { at: e.t, time: s(e.time), table: s(e.table) };
    else if (e.do === "name") st.name = { at: e.t, name: s(e.name) };
    else if (e.do === "tag") st.tags = [...st.tags, { at: e.t, text: s(e.text), tone: s(e.tone, "good") }];
    else if (e.do === "confirm") st.confirm = { at: e.t };
  }
  return st;
}

/** Floor map tables: x/y/w/h in a 100 x 60 box. */
const TABLES = [
  { id: "a1", x: 4, y: 6, w: 12, h: 12, busy: true },
  { id: "a2", x: 20, y: 6, w: 12, h: 12, busy: true },
  { id: "a3", x: 36, y: 6, w: 12, h: 12, busy: false },
  { id: "b1", x: 4, y: 24, w: 18, h: 14, busy: true },
  { id: "b2", x: 26, y: 24, w: 18, h: 14, busy: true },
  { id: "b3", x: 4, y: 43, w: 18, h: 13, busy: false },
  { id: "b4", x: 26, y: 43, w: 18, h: 13, busy: true },
];

export function ReservationsApp({ events, t, caller, ended }: AppProps) {
  const st = useMemo(() => reservationsReduce(reservationsInitial, events), [events]);
  const { call, check, hold, name, tags, confirm } = st;
  const offered = (time: string) => !!check && check.offers.includes(time);

  return (
    <div className="rs">
      <div className="ap-head">
        <b>Friday</b>
        {call ? (
          <Fx at={call.at} t={t} tag={false} className="dp-call">
            <span className="hd-ring" aria-hidden="true">
              <PhoneCall size={12} />
            </span>
            <b>{ended ? "Call ended" : hold ? "Maya on call" : "Incoming call"}</b>
            <span className="ad-nw ap-sub">{caller.phone}</span>
          </Fx>
        ) : (
          <span className="ap-sub">Dinner, 5:30 PM to 9:00 PM</span>
        )}
      </div>

      <div className="rs-wrap">
        <div className="rs-map-wrap">
          <div className="rs-map-h">
            <b>Floor</b>
            <span className="rs-legend">
              <span className="ad-nw"><i className="lg-free" /> Free</span> <span className="ad-nw"><i className="lg-held" /> Held</span> <span className="ad-nw"><i className="lg-book" /> Booked</span>
            </span>
          </div>
          <div className="rs-map" role="presentation">
            {TABLES.map((x) => (
              <span
                key={x.id}
                className={`rs-tbl ${x.busy ? "is-busy" : ""}`}
                style={{ left: `${x.x}%`, top: `${(x.y / 60) * 100}%`, width: `${x.w}%`, height: `${(x.h / 60) * 100}%` }}
              />
            ))}
            <Fx
              at={confirm?.at ?? hold?.at}
              t={t}
              tag={false}
              className={`rs-tbl rs-corner ${confirm ? "is-booked" : hold ? "is-held" : ""}`}
              style={{ left: "56%", top: "14%", width: "40%", height: "62%" }}
            >
              <b>Corner</b>
              <span className="ad-nw">{confirm ? `${name ? name.name.split(" ")[0] : "Booked"}, 6` : hold ? "Held, 6" : "Seats 6"}</span>
            </Fx>
            <span className="rs-bar">Bar</span>
          </div>
          <div className="rs-wait">
            <div className="rs-sec-h">Waitlist</div>
            <div>
              <b>Cho, 2</b>
              <span className="ad-nw ap-sub">7:45 PM</span>
            </div>
            <div>
              <b>Alvarez, 4</b>
              <span className="ad-nw ap-sub">8:00 PM</span>
            </div>
          </div>
        </div>

        <div className="rs-list">
          {ROWS.map((r, i) => {
            const prev = ROWS[i - 1];
            const groupStart = !prev || prev.time !== r.time;
            if (r.open) {
              const isCorner = r.id === "o2";
              const held = isCorner && hold;
              const glow = offered(r.time);
              return (
                <Fx
                  key={r.id}
                  at={held ? (confirm?.at ?? name?.at ?? hold!.at) : glow ? check!.at : undefined}
                  t={t}
                  tagSide="left"
                  tag={!!held}
                  className={`rs-row rs-open ${held ? (confirm ? "is-booked" : "is-held") : glow ? "is-offer" : ""}`}
                >
                  <span className="rs-time ad-nw">{r.time}</span>
                  {held ? (
                    <div className="rs-who">
                      <b>{name ? name.name : "Held for the caller"}</b>
                      <span className="ap-sub">Corner table</span>
                      {tags.length ? (
                        <span className="rs-tags">
                          {tags.map((x) => (
                            <Fx key={x.at} at={x.at} t={t} tag={false} as="span" className={`ad-pill ad-pill-${x.tone === "warn" ? "warn" : "good"}`}>
                              {x.text}
                            </Fx>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rs-who">
                      <span className="rs-openl">{glow ? (isCorner ? "Open, big corner table" : "Open for 6") : "Open"}</span>
                    </div>
                  )}
                  {held ? (
                    <span className={`ad-pill ${confirm ? "ad-pill-good" : "ad-pill-info"}`}>{confirm ? "Booked" : "Holding"}</span>
                  ) : (
                    <span className="rs-size ap-muted">{glow ? "Offered" : ""}</span>
                  )}
                  {held ? (
                    <span className="rs-size">
                      <Users size={12} /> 6
                    </span>
                  ) : null}
                </Fx>
              );
            }
            return (
              <div key={r.id} className={`rs-row ${groupStart ? "" : "is-cont"}`}>
                <span className="rs-time ad-nw">{groupStart ? r.time : ""}</span>
                <div className="rs-who">
                  <b>{r.name}</b>
                </div>
                {check && r.time === check.time ? (
                  <Fx at={check.at} t={t} tag={false} as="span" className="ad-pill ad-pill-warn rs-full">
                    Full for 6
                  </Fx>
                ) : null}
                <span className="rs-size">
                  <Users size={12} /> {r.party}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
