import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after it has stayed
 * unchanged for `delayMs` milliseconds. Intended for filter/search inputs
 * where running the filter on every keystroke is wasteful on large lists.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
