import { useMemo } from "react";
import { BedDouble, Building2, CalendarCheck, Home, PhoneCall, Users, Bath, Trees } from "lucide-react";
import { Avatar, Fx, useFlip, type AppProps } from "./appKit";
import type { SidebarItem } from "./DesktopWindow";
import { Glued } from "./RevealText";
import type { FiredEvent } from "./timeline";

/** Harbor & Pine Leads: a sales pipeline and a listing panel. Maya adds the buyer, qualifies them and books the showing. */

export const crmSidebar: SidebarItem[] = [
  { id: "pipeline", label: "Pipeline", icon: Users, badge: "6" },
  { id: "listings", label: "Listings", icon: Home },
  { id: "showings", label: "Showings", icon: CalendarCheck },
  { id: "offices", label: "Office", icon: Building2 },
];

type Stage = "new" | "qualified" | "showing";
const STAGES: { id: Stage; label: string }[] = [
  { id: "new", label: "New lead" },
  { id: "qualified", label: "Qualified" },
  { id: "showing", label: "Showing booked" },
];

type Lead = { id: string; stage: Stage; name: string; line: string; tags?: string[] };
const SEED: Lead[] = [
  { id: "l1", stage: "new", name: "Priya Desai", line: "Website inquiry, 2 hours ago" },
  { id: "l2", stage: "new", name: "Marcus Bell", line: "Open house sign-in" },
  { id: "l3", stage: "qualified", name: "Hannah Ruiz", line: "Pre-approved, up to $720K" },
  { id: "l4", stage: "showing", name: "Tom Aldridge", line: "Sun 1:00 PM with Sarah" },
];

export type CrmState = {
  call: { at: number } | null;
  listing: { at: number; address: string; details: string; price: string } | null;
  lead: { at: number; name: string } | null;
  qualify: { at: number; tags: string[] } | null;
  showing: { at: number; when: string; agent: string } | null;
};
export const crmInitial: CrmState = { call: null, listing: null, lead: null, qualify: null, showing: null };
const s = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export function crmReduce(init: CrmState, events: FiredEvent[]): CrmState {
  const st = { ...init };
  for (const e of events) {
    if (e.do === "incoming") st.call = { at: e.t };
    else if (e.do === "listing") st.listing = { at: e.t, address: s(e.address), details: s(e.details), price: s(e.price) };
    else if (e.do === "lead") st.lead = { at: e.t, name: s(e.name) };
    else if (e.do === "qualify") st.qualify = { at: e.t, tags: Array.isArray(e.tags) ? (e.tags as string[]) : [] };
    else if (e.do === "showing") st.showing = { at: e.t, when: s(e.when), agent: s(e.agent) };
  }
  return st;
}

export function CrmApp({ events, t, caller }: AppProps) {
  const st = useMemo(() => crmReduce(crmInitial, events), [events]);
  const { call, listing, lead, qualify, showing } = st;
  const stage: Stage = showing ? "showing" : qualify ? "qualified" : "new";
  const flip = useFlip(`${lead ? 1 : 0}${lead ? stage : ""}`);

  const leadCard = lead ? (
    <Fx
      key="live"
      at={showing?.at ?? qualify?.at ?? lead.at}
      t={t}
      rootRef={flip.ref("live")}
      className="crm-card crm-live"
    >
      <div className="crm-card-top">
        <Avatar name={lead.name} size={24} />
        <b>{lead.name}</b>
      </div>
      <div className="crm-l">
        {showing ? (
          <span>
            <span className="ad-nw">{showing.when}</span> with {showing.agent}
          </span>
        ) : (
          <span className="ad-nw">{caller.phone}</span>
        )}
      </div>
      {qualify ? (
        <div className="crm-tags">
          {qualify.tags.map((x) => (
            <span key={x} className="ad-pill ad-pill-info">
              {x}
            </span>
          ))}
        </div>
      ) : null}
    </Fx>
  ) : null;

  return (
    <div className="crm">
      <div className="ap-head">
        <b>Pipeline</b>
        {call ? (
          <Fx at={call.at} t={t} tag={false} className="dp-call">
            <span className="hd-ring" aria-hidden="true">
              <PhoneCall size={12} />
            </span>
            <b>{lead ? "Maya on call" : "Incoming call"}</b>
            <span className="ad-nw ap-sub">{caller.phone}</span>
          </Fx>
        ) : (
          <span className="ap-sub">This week</span>
        )}
      </div>

      <div className="crm-listing">
        {listing ? (
          <Fx at={listing.at} t={t} className="crm-l-in">
            <div className="crm-photo" aria-hidden="true">
              <Home size={22} strokeWidth={1.6} />
            </div>
            <div className="crm-l-t">
              <div className="crm-l-top">
                <b>{listing.address}</b>
                <span className="ad-pill ad-pill-good">Active</span>
              </div>
              <div className="crm-l-d">
                <span className="ad-nw">
                  <BedDouble size={12} /> 3 bd
                </span>
                <span className="ad-nw">
                  <Bath size={12} /> 2 ba
                </span>
                <span className="ad-nw">
                  <Trees size={12} /> Big backyard
                </span>
              </div>
              <b className="crm-price ad-nw">{listing.price}</b>
            </div>
          </Fx>
        ) : (
          <div className="crm-l-empty">
            <Home size={16} /> No listing open. Maya looks one up when a caller asks about it.
          </div>
        )}
      </div>

      <div className="crm-board" ref={flip.root}>
        {STAGES.map((c) => (
          <div key={c.id} className="crm-col">
            <div className="dp-col-h">
              <b>{c.label}</b>
              <span className="ap-sub">{SEED.filter((l) => l.stage === c.id).length + (lead && stage === c.id ? 1 : 0)}</span>
            </div>
            <div className="crm-cards">
              {lead && stage === c.id ? leadCard : null}
              {SEED.filter((l) => l.stage === c.id).map((l) => (
                <div key={l.id} ref={flip.ref(l.id)} className="crm-card">
                  <div className="crm-card-top">
                    <Avatar name={l.name} size={24} />
                    <b>{l.name}</b>
                  </div>
                  <div className="crm-l"><Glued text={l.line} /></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
