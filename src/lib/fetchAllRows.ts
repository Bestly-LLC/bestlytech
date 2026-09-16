/**
 * PostgREST caps every select at 1,000 rows (and ignores a larger `.limit()`), so a plain
 * select silently undercounts once a table grows. Page through with `.range()` instead.
 *
 *   const res = await fetchAllRows((from, to) =>
 *     supabase.from("cookie_patterns").select("domain, confidence").order("id").range(from, to));
 *
 * The builder must apply a stable `.order()` so pages don't overlap. Stops at `maxRows` and
 * reports `truncated` so the caller can say "showing first N".
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { pageSize = 1000, maxRows = 50000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<{ data: T[]; error: { message: string } | null; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await page(from, to);
    if (error) return { data: rows, error, truncated: false };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < to - from + 1) return { data: rows, error: null, truncated: false };
  }
  return { data: rows, error: null, truncated: true };
}
