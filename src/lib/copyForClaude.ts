/**
 * One-tap copy of an error or alert, formatted so it can be pasted straight to Claude:
 * what it said, when, and which page it came from.
 */
export function formatForClaude(title: string, body?: string | null, extra?: Record<string, string | null | undefined>) {
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
  const lines = [
    `Alert from bestly.tech (${typeof location !== "undefined" ? location.pathname + location.search : ""})`,
    `When: ${when} PT`,
    ...Object.entries(extra ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    "",
    title,
    body ? String(body) : "",
  ];
  return lines.join("\n").trim();
}

export async function copyForClaude(title: string, body?: string | null, extra?: Record<string, string | null | undefined>) {
  const text = formatForClaude(title, body, extra);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari / blocked clipboard: fall back to a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch { return false; }
  }
}
