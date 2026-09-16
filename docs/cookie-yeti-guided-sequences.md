# Cookie Yeti: guided multi-click patterns

Admin → Cookie Yeti → Auto-Fix → **Guide it** lets an operator walk the robot browser
(`/api/cy-render`, Frankfurt) through a banner. The fix is robot-tested and saved by the
`cy-guide` edge function.

## What gets stored

One row in `cookie_patterns`, as always:

| column | one click | several clicks |
|---|---|---|
| `selector` / `action_type` | the button | the **last** click |
| `steps` | `NULL` | `[{"selector": "...", "action": "next"}, ..., {"selector": "...", "action": "reject"}]` |
| `strategy` | `NULL` | `"sequence"` |
| `source` | `admin_guided` | `admin_guided` |
| `confidence` | 9 when robot-tested, 5 when saved anyway | same |

One-click fixes work in today's extension with no change. Extensions that don't know
`steps` ignore it; the last-click selector usually isn't on the first screen, so nothing
wrong gets clicked.

## Extension change to play sequences

Wherever the content script applies a pattern, handle `steps` first:

```js
// Wait for a selector to be visible, up to `ms`.
function waitFor(selector, ms = 4000) {
  return new Promise((resolve) => {
    const seen = () => {
      const el = document.querySelector(selector);
      return el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) ? el : null;
    };
    const hit = seen();
    if (hit) return resolve(hit);
    const obs = new MutationObserver(() => { const el = seen(); if (el) { obs.disconnect(); resolve(el); } });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, ms);
  });
}

async function applyPattern(pattern) {
  if (Array.isArray(pattern.steps) && pattern.steps.length > 1) {
    for (const step of pattern.steps) {
      const el = await waitFor(step.selector);
      if (!el) return false;          // screen didn't match; let other strategies try
      el.click();
      await new Promise((r) => setTimeout(r, 600));
    }
    return true;                        // report success with pattern.selector / pattern.action_type as usual
  }
  // existing single-click path
}
```

Select `steps` and `strategy` along with the other pattern columns when fetching.
