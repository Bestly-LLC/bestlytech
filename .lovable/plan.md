

# Optimize Bestly Admin for Mobile

## Problem
The admin pages use wide data tables (7-8 columns) that overflow or become unreadable on mobile. The header toolbar is dense, and bulk action bars don't wrap well on small screens.

## Changes

### 1. AdminLayout.tsx — Compact mobile header
- Reduce header height to `h-12` on mobile, keep `h-14` on `sm:`
- Hide the "Bestly Admin" text on mobile (the Shield icon is sufficient)
- Reduce right-side icon gaps on mobile

### 2. AdminDashboard.tsx — Responsive stat grid + card-based recent list
- Change stat grid to `grid-cols-2` on mobile (instead of `grid-cols-1`) for better density; keeps the current `sm:grid-cols-2 lg:grid-cols-3`
- Replace the Recent Submissions `<Table>` with a mobile card layout: on `<md`, render each submission as a stacked card showing business name, platform badges, status badge, and date. Hide the table on mobile, hide cards on desktop.

### 3. AdminSubmissions.tsx — Mobile card layout
- On `<md`, render each submission row as a card: business name (linked), platform badges, status, date, and checkbox
- Hide the full table on mobile. Show cards instead.
- Make filter selects full-width on mobile (`w-full` instead of fixed `w-[160px]`)
- Wrap bulk action buttons with `flex-wrap`

### 4. AdminContacts.tsx — Mobile card layout
- On `<md`, render each contact as a card: name, email, category badge, status select, date, view button
- Hide the full table on mobile

### 5. AdminHireRequests.tsx — Mobile card layout
- On `<md`, render each hire request as a card: name, company, type badge, budget, status select, view button
- Hide the full table on mobile

### 6. AdminSubmissionDetail.tsx — Tighter mobile spacing
- Reduce `Field` label width from `w-48` to `w-36` on mobile
- Make the status/save/validate toolbar stack vertically on very small screens

### 7. StatCard.tsx — Tighter mobile padding
- Reduce padding on mobile (`pt-4` instead of `pt-6`, smaller text `text-2xl` instead of `text-3xl`)

## Pattern
Each table page gets a shared approach: a `<div className="hidden md:block">` wrapping the existing `<Table>`, and a `<div className="md:hidden space-y-3">` with card-based items. This avoids restructuring the existing table code and keeps desktop experience identical.

## Files to modify
- `src/components/admin/AdminLayout.tsx`
- `src/components/admin/StatCard.tsx`
- `src/pages/admin/AdminDashboard.tsx`
- `src/pages/admin/AdminSubmissions.tsx`
- `src/pages/admin/AdminContacts.tsx`
- `src/pages/admin/AdminHireRequests.tsx`
- `src/pages/admin/AdminSubmissionDetail.tsx`

