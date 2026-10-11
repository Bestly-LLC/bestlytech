import { useMemo } from "react";
import { BarChart3, CreditCard, Inbox, Settings, Users, Check, PhoneCall } from "lucide-react";
import { Avatar, Fx, useFlip, type AppProps } from "./appKit";
import type { SidebarItem } from "./DesktopWindow";
import type { FiredEvent } from "./timeline";

/** Ledgerly Support: an inbox of tickets, with the call landing as a new ticket that Maya fills in. */

export const helpdeskSidebar: SidebarItem[] = [
  { id: "inbox", label: "Inbox", icon: Inbox, badge: "12" },
  { id: "customers", label: "Customers", icon: Users },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
];

type Ticket = { id: string; name: string; subject: string; time: string; unread?: boolean; done?: boolean };
const TICKETS: Ticket[] = [
  { id: "t1", name: "Maria Alvarez", subject: "Can't export invoices to CSV", time: "1:52 PM", unread: true },
  { id: "t2", name: "Tom Nguyen", subject: "Does the Team plan include SSO?", time: "1:31 PM", unread: true },
  { id: "t3", name: "Greenline Dental", subject: "Password reset email never arrives", time: "12:58 PM" },
  { id: "t4", name: "Jules Park", subject: "Question about annual billing", time: "12:20 PM" },
  { id: "t5", name: "Northwind Cafe", subject: "Adding a second location", time: "11:47 AM" },
  { id: "t6", name: "Sam Whitfield", subject: "Thanks, that fixed it", time: "11:05 AM", done: true },
];

export type HelpdeskState = {
  call: { at: number } | null;
  customer: { at: number; name: string; company: string; plan: string; seats: string } | null;
  flagged: { at: number; amount: string; date: string } | null;
  refunded: { at: number; amount: string } | null;
  invite: { at: number; name: string; email: string; seats: string } | null;
  resolved: { at: number; summary: string } | null;
};

export const helpdeskInitial: HelpdeskState = {
  call: null,
  customer: null,
  flagged: null,
  refunded: null,
  invite: null,
  resolved: null,
};

const s = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export function helpdeskReduce(init: HelpdeskState, events: FiredEvent[]): HelpdeskState {
  const st: HelpdeskState = { ...init };
  for (const e of events) {
    switch (e.do) {
      case "incoming":
        st.call = { at: e.t };
        break;
      case "identify":
        st.customer = { at: e.t, name: s(e.customer), company: s(e.company), plan: s(e.plan), seats: s(e.seats) };
        break;
      case "flagCharges":
        st.flagged = { at: e.t, amount: s(e.amount, "$49.00"), date: s(e.date, "Oct 3") };
        break;
      case "refund":
        st.refunded = { at: e.t, amount: s(e.amount, "$49.00") };
        break;
      case "invite":
        st.invite = { at: e.t, name: s(e.name), email: s(e.email), seats: s(e.seats) };
        break;
      case "resolve":
        st.resolved = { at: e.t, summary: s(e.summary) };
        break;
    }
  }
  return st;
}

export function HelpdeskApp({ events, t, caller }: AppProps) {
  const st = useMemo(() => helpdeskReduce(helpdeskInitial, events), [events]);
  const { call, customer, flagged, refunded, invite, resolved } = st;
  const flip = useFlip(call ? "call" : "idle");

  const phone = caller.phone;
  const status = resolved ? "Resolved" : call ? "On a call" : "Open";

  return (
    <div className="hd">
      <div className="hd-list" ref={flip.root}>
        <div className="ap-head">
          <b>Inbox</b>
          <span className="ap-sub">12 open</span>
        </div>
        <ul className="hd-rows">
          {call ? (
            <li ref={flip.ref("call")} className={`hd-row is-sel ${resolved ? "is-done" : ""}`}>
              <Fx at={customer?.at ?? call.at} t={t} tag={!!customer} tagSide="left" className="hd-row-in">
                {customer ? (
                  <Avatar name={customer.name} size={30} />
                ) : (
                  <span className="hd-ring" aria-hidden="true">
                    <PhoneCall size={14} />
                  </span>
                )}
                <div className="hd-row-t">
                  <div className="hd-row-top">
                    <b>{customer ? customer.name : "Incoming call"}</b>
                    <span className="ad-nw ap-muted">{resolved ? "Now" : "Live"}</span>
                  </div>
                  <div className="hd-row-sub">
                    {customer ? "Billing question, by phone" : <span className="ad-nw">{phone}</span>}
                  </div>
                </div>
                {!resolved && !customer ? <span className="ad-pill ad-pill-info hd-ringing">Ringing</span> : null}
                {resolved ? <Check size={15} className="hd-check" /> : null}
              </Fx>
            </li>
          ) : null}
          {TICKETS.map((tk) => (
            <li key={tk.id} ref={flip.ref(tk.id)} className={`hd-row ${!call && tk.id === "t1" ? "is-sel" : ""}`}>
              <div className="hd-row-in">
                <Avatar name={tk.name} size={30} />
                <div className="hd-row-t">
                  <div className="hd-row-top">
                    <b className={tk.unread ? "" : "ap-weak"}>{tk.name}</b>
                    <span className="ad-nw ap-muted">{tk.time}</span>
                  </div>
                  <div className="hd-row-sub">{tk.subject}</div>
                </div>
                {tk.unread ? <i className="hd-dot" /> : null}
                {tk.done ? <Check size={15} className="hd-check ap-muted" /> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="hd-detail">
        {!call ? (
          <div className="hd-thread">
            <div className="hd-d-head">
              <Avatar name="Maria Alvarez" size={38} />
              <div className="hd-d-who">
                <b>Maria Alvarez</b>
                <span className="ap-sub">Can't export invoices to CSV</span>
              </div>
              <span className="ad-pill ad-pill-mute">Open</span>
            </div>
            <div className="hd-msg">
              <b>Maria</b>
              <span className="ad-nw ap-muted">1:52 PM</span>
              <p>Hi, the Export to CSV button on the Invoices page does nothing for me. I'm on Chrome. Can you take a look?</p>
            </div>
            <div className="hd-reply">Reply to Maria</div>
          </div>
        ) : (
          <div className="hd-case">
            <div className="hd-d-head">
              {customer ? (
                <Avatar name={customer.name} size={38} />
              ) : (
                <span className="hd-ring hd-ring-lg" aria-hidden="true">
                  <PhoneCall size={17} />
                </span>
              )}
              <div className="hd-d-who">
                <b>{customer ? customer.name : "Incoming call"}</b>
                <span className="ap-sub">
                  {customer ? <>{customer.company}</> : <span className="ad-nw">{phone}</span>}
                </span>
              </div>
              <span className={`ad-pill ${resolved ? "ad-pill-good" : "ad-pill-info"}`}>{status}</span>
            </div>

            {!customer ? (
              <div className="hd-wait">
                <span className="hd-pulse" aria-hidden="true" />
                Maya is answering. Matching the caller to an account.
              </div>
            ) : (
              <Fx at={customer.at} t={t} className="hd-card hd-cust">
                <div className="hd-kv">
                  <span>Company</span>
                  <b>{customer.company}</b>
                </div>
                <div className="hd-kv">
                  <span>Plan</span>
                  <b>{customer.plan}</b>
                </div>
                <div className="hd-kv">
                  <span>Seats</span>
                  <b className="ad-nw">{invite ? invite.seats : customer.seats}</b>
                </div>
              </Fx>
            )}

            {flagged ? (
              <div className="hd-card hd-charges">
                <div className="hd-card-h">
                  <b>Charges</b>
                  <span className="ap-sub">Visa ending 4242</span>
                </div>
                <div className="hd-tr">
                  <span className="ad-nw">{flagged.date}</span>
                  <span>Pro plan</span>
                  <b className="ad-nw">{flagged.amount}</b>
                  <span className="ad-pill ad-pill-mute">Paid</span>
                </div>
                <Fx at={refunded?.at ?? flagged.at} t={t} className={`hd-tr hd-tr-dup ${refunded ? "is-refunded" : ""}`} tagSide="left">
                  <span className="ad-nw">{flagged.date}</span>
                  <span>Pro plan</span>
                  <b className={`ad-nw ${refunded ? "hd-struck" : ""}`}>{flagged.amount}</b>
                  {refunded ? (
                    <span className="ad-pill ad-pill-good">Refunded</span>
                  ) : (
                    <span className="ad-pill ad-pill-warn">Duplicate</span>
                  )}
                </Fx>
                <div className="hd-tr">
                  <span className="ad-nw">Sep 3</span>
                  <span>Pro plan</span>
                  <b className="ad-nw">$49.00</b>
                  <span className="ad-pill ad-pill-mute">Paid</span>
                </div>
              </div>
            ) : null}

            {customer ? (
              <div className="hd-card hd-seats">
                <div className="hd-card-h">
                  <b>Team</b>
                  <span className="ap-sub ad-nw">{invite ? invite.seats : customer.seats} seats used</span>
                </div>
                <div className="hd-member">
                  <Avatar name={customer.name} size={24} />
                  <span>{customer.name}</span>
                  <span className="ap-sub">Owner</span>
                </div>
                {invite ? (
                  <Fx at={invite.at} t={t} className="hd-member" tagSide="left">
                    <Avatar name={invite.name} size={24} />
                    <span>
                      {invite.name}
                      <span className="hd-email">{invite.email}</span>
                    </span>
                    <span className="ad-pill ad-pill-warn">Invited</span>
                  </Fx>
                ) : null}
              </div>
            ) : null}

            {resolved ? (
              <Fx at={resolved.at} t={t} className="hd-card hd-note">
                <div className="hd-card-h">
                  <b>Call summary</b>
                  <span className="ap-sub">Written by Maya</span>
                </div>
                <p>{resolved.summary}</p>
              </Fx>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
