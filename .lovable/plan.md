

# Apple-esque Admin Panel Redesign

Apply the same dark, minimal, floating aesthetic from the login page across the entire admin shell and its content pages.

## Changes

### 1. AdminLayout (`src/components/admin/AdminLayout.tsx`)
- **Background**: Force dark theme on the admin shell — `bg-black` base with the same subtle radial glow overlay from the login
- **Header**: Remove `bg-card/80` border-b shadow style. Replace with a transparent/frosted glass bar: `bg-white/[0.03] backdrop-blur-xl border-b border-white/[0.06]`. Remove Shield icon and "Bestly Admin" text — keep it minimal (just sidebar trigger + breadcrumb on left, actions on right)
- **Breadcrumb**: Render in `text-white/40` instead of `text-muted-foreground`
- **Action buttons**: Style as `text-white/50 hover:text-white hover:bg-white/5` — no visible borders
- **User email pill**: Green dot + email in `text-white/40`
- **Main content area**: Remove default padding background, let pages float on the dark canvas

### 2. AdminSidebar (`src/components/admin/AdminSidebar.tsx`)
- **Background**: Deep black `bg-[#0a0a0a]` with `border-r border-white/[0.06]`
- **Group labels**: `text-white/25` uppercase tracking
- **Menu items**: `text-white/50 hover:text-white hover:bg-white/5` — active state uses `bg-white/[0.08]` with a white left accent bar instead of themed sidebar colors
- **Dividers**: `bg-white/[0.06]`
- **Badges (counts)**: `bg-white/10 text-white/60` — subtle, not colorful

### 3. StatCard (`src/components/admin/StatCard.tsx`)
- Remove the `border-t-2` colored accent — too corporate
- Card style: `bg-white/[0.03] border border-white/[0.06] rounded-2xl` — frosted glass look
- Value: `text-white text-3xl font-semibold` (not bold)
- Label: `text-white/40 text-xs`
- Icon container: `bg-white/[0.05]` with icon in `text-white/40`
- Hover: subtle `hover:bg-white/[0.05]` transition

### 4. Dashboard Page (`src/pages/admin/AdminDashboard.tsx`)
- **PageHeader**: Title in `text-white`, description in `text-white/40`
- **Cards** (Recent Submissions, Activity Feed): `bg-white/[0.03] border-white/[0.06]` — same frosted glass
- **Table**: Remove zebra striping, use `border-b border-white/[0.04]` row dividers. Text in `text-white/60`, links in `text-white hover:text-white/80`
- **Badges**: More muted — outline style with `border-white/15 text-white/60`

### 5. PageHeader (`src/components/admin/PageHeader.tsx`)
- Title: `text-white`
- Description: `text-white/40`

### 6. Global Admin Overrides (in `src/index.css` or AdminLayout)
- Add a scoping class `.admin-shell` on the AdminLayout wrapper div to scope dark overrides without affecting the rest of the site
- Override CSS variables under `.admin-shell` to force the Apple-dark palette:
  - `--background: 0 0% 0%` (pure black)
  - `--card: 0 0% 5%` (near-black)
  - `--border: 0 0% 10%`
  - `--foreground: 0 0% 100%`
  - Cards use `bg-white/[0.03]` explicitly rather than relying on `bg-card`

### Files Modified
- `src/components/admin/AdminLayout.tsx` — dark shell, frosted header, add `.admin-shell` class
- `src/components/admin/AdminSidebar.tsx` — dark sidebar styling
- `src/components/admin/StatCard.tsx` — frosted glass cards, remove colored accents
- `src/components/admin/PageHeader.tsx` — white text
- `src/pages/admin/AdminDashboard.tsx` — frosted cards, muted table
- `src/index.css` — `.admin-shell` CSS variable overrides

