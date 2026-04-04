

# Home Hub Dashboard for Admin Panel

## Overview

Add a 4-page "Home Hub" section to the existing admin panel that monitors Pi-hole, Home Assistant, and Homebridge services running on a Raspberry Pi 5. Uses the same dark aesthetic, StatCard pattern, PageHeader, ExportButton, and table styling already in use.

## New Files

### 1. Mock API Service — `src/services/homeHubApi.ts`
A single file exporting async functions that return mock data for all three services. Each function simulates a fetch with realistic data structures. When ready to connect real APIs, only this file changes.

Functions: `fetchPiholeStats()`, `fetchHomeAssistantStats()`, `fetchHomebridgeStats()`, `fetchOverviewStats()`, `piholeEnable()`, `piholeDisable()`, `piholeUpdateGravity()`, `homebridgeRestart()`, `toggleAutomation(id, enabled)`

### 2. Overview Page — `src/pages/admin/HomeHubOverview.tsx`
- PageHeader: "Home Hub" + "Last Updated" timestamp + refresh button
- 3 status cards in a row (grid-cols-1 sm:grid-cols-3) using the existing StatCard pattern plus a colored status dot (green/yellow/red span with ping animation)
  - Pi-hole: queries blocked today, % blocked
  - Home Assistant: devices online, active automations
  - Homebridge: accessories, plugins active
- Below: "Recent Activity" feed card (same pattern as ActivityFeed.tsx) with timestamped events from all services
- Auto-refresh every 30s via `useEffect` interval

### 3. Pi-hole Page — `src/pages/admin/HomeHubPihole.tsx`
- PageHeader with Enable/Disable toggle button + Update Gravity button
- 4 StatCards: Total Queries, Queries Blocked, Percent Blocked, Domains on Blocklist
- Line chart (recharts, already installed): 24h queries — two lines (blocked vs allowed)
- Two tables with search bars and ExportButton: Top Blocked Domains, Top Permitted Domains

### 4. Home Assistant Page — `src/pages/admin/HomeHubHomeAssistant.tsx`
- 4 StatCards: Entities, Automations, Active Sensors, Last Automation Triggered
- Sensor card grid (grid-cols-1 sm:grid-cols-3): EcoFlow Delta 2 (battery icon + charge %), Earthquake sensor, Weather alert — each with status dot
- Automation list: rows with name, toggle switch, last-triggered timestamp
- Recent activity log card

### 5. Homebridge Page — `src/pages/admin/HomeHubHomebridge.tsx`
- 3 StatCards: Accessories, Plugins, Uptime
- Accessory list with status indicators (SmartRent lock: locked/unlocked, Dyson: on/off)
- Plugin list with version + update-available badge
- Restart Homebridge button with confirmation dialog

## Modified Files

### `src/components/admin/AdminSidebar.tsx`
Add a new "Home Hub" sidebar group after Cookie Yeti with 4 items:
- Overview → `/admin/home-hub`
- Pi-hole → `/admin/home-hub/pihole`
- Home Assistant → `/admin/home-hub/ha`
- Homebridge → `/admin/home-hub/homebridge`

Icons: `Server`, `Shield`, `House`, `Plug`

### `src/App.tsx`
Add 4 new routes under the admin layout:
```
<Route path="home-hub" element={<HomeHubOverview />} />
<Route path="home-hub/pihole" element={<HomeHubPihole />} />
<Route path="home-hub/ha" element={<HomeHubHomeAssistant />} />
<Route path="home-hub/homebridge" element={<HomeHubHomebridge />} />
```

### `src/components/admin/AdminLayout.tsx`
Add breadcrumb labels for the 4 new routes to `BREADCRUMB_MAP`.

## Design Details
- All pages use the existing admin dark theme (bg-black, white/[0.03] cards, white/[0.06] borders)
- Status dots: `relative flex h-2.5 w-2.5` with inner ping animation span (green-500, yellow-500, red-500)
- Charts use dark theme colors: grid lines at white/[0.06], text at white/40
- Tables follow the existing pattern with search input + ExportButton in a header row
- Responsive: all grids collapse to single column on mobile

