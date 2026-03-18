

# Move Dashboard to Standalone

## Change
In `AdminSidebar.tsx`, pull "Dashboard" out of the `amazonItems` array and render it as a standalone item at the top of the sidebar (before the Amazon group). The Amazon group keeps only Submissions and Setup Guide.

### Edits to `AdminSidebar.tsx`:
1. **Remove Dashboard from `amazonItems`** — leave only Submissions and Setup Guide
2. **Add a standalone Dashboard link** at the top of `<SidebarContent>`, before the Amazon group — rendered using the same `renderItem` helper, wrapped in its own `<SidebarMenu>`

