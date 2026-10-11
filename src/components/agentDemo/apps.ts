import type { ComponentType } from "react";
import type { AppKind } from "./scenarios";
import type { AppProps } from "./appKit";
import type { SidebarItem } from "./DesktopWindow";
import { CalendarApp, calendarSidebar } from "./CalendarApp";
import { CrmApp, crmSidebar } from "./CrmApp";
import { DispatchApp, dispatchSidebar } from "./DispatchApp";
import { HelpdeskApp, helpdeskSidebar } from "./HelpdeskApp";
import { ReservationsApp, reservationsSidebar } from "./ReservationsApp";

/** Everything the stage needs to dress a window for each kind of app. Body heights are for the wide and the phone layouts. */
export type AppSpec = {
  Component: ComponentType<AppProps>;
  sidebar: SidebarItem[];
  current: string;
  accent: string;
  bodyHeight: number;
  bodyHeightNarrow: number;
};

export const APPS: Record<AppKind, AppSpec> = {
  helpdesk: { Component: HelpdeskApp, sidebar: helpdeskSidebar, current: "inbox", accent: "#2F6BFF", bodyHeight: 560, bodyHeightNarrow: 560 },
  calendar: { Component: CalendarApp, sidebar: calendarSidebar, current: "schedule", accent: "#0E9594", bodyHeight: 560, bodyHeightNarrow: 690 },
  dispatch: { Component: DispatchApp, sidebar: dispatchSidebar, current: "board", accent: "#E8590C", bodyHeight: 560, bodyHeightNarrow: 640 },
  crm: { Component: CrmApp, sidebar: crmSidebar, current: "pipeline", accent: "#1F7A5C", bodyHeight: 560, bodyHeightNarrow: 660 },
  reservations: { Component: ReservationsApp, sidebar: reservationsSidebar, current: "book", accent: "#A3374A", bodyHeight: 560, bodyHeightNarrow: 640 },
};
