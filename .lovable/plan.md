

## Add Spin Animation to Refresh Button

**What**: When the user clicks the Refresh button on the Community Learning admin panel, the `RefreshCw` icon should spin while data is loading, providing visual feedback.

### Changes

**File:** `src/pages/admin/CommunityLearning.tsx`

1. **Add a `refreshing` state** (`useState<boolean>(false)`) to track when a manual refresh is in progress.

2. **Create a `handleRefresh` wrapper** that sets `refreshing = true`, calls `fetchAll()`, then sets `refreshing = false` in a finally block.

3. **Update the Refresh button** (line 616-618):
   - Replace `onClick={fetchAll}` with `onClick={handleRefresh}`
   - Add `animate-spin` class to the `RefreshCw` icon when `refreshing` is true
   - Disable the button while refreshing to prevent double-clicks

This is a small, focused change — just a new state variable, a 5-line wrapper function, and a conditional class on the icon.

