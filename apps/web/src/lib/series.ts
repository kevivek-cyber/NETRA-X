/**
 * Turns ledger records into a series a sparkline can draw.
 *
 * The stat blocks previously carried no trend at all, and the obvious way to
 * add one -- generating a plausible-looking curve -- is not available here:
 * this product's whole claim is that every figure on screen traces back to a
 * row. So the series is derived from the records' own `created_at` stamps.
 *
 * Returns a cumulative count per bucket, which is the honest shape for an
 * append-only ledger: it can only ever climb, and a flat tail means nothing
 * was collected recently rather than that collection stopped being counted.
 */

export type DatedRecord = Record<string, any>;

/**
 * @param records  rows carrying an ISO date
 * @param buckets  how many points the returned series should have
 * @param field    which date column to read. Not every table stamps the same
 *                 one -- evidence, hypotheses and cases carry `created_at`,
 *                 while an actor carries `last_seen` and no creation time at
 *                 all, so the caller names the column it actually has.
 * @returns cumulative counts, oldest first; empty if nothing has a usable date
 */
export function cumulativeSeries(
  records: DatedRecord[],
  buckets = 24,
  field = "created_at"
): number[] {
  const times = records
    .map((r) => (r?.[field] ? Date.parse(r[field]) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (times.length === 0) return [];
  // A single record, or many sharing one timestamp (the deterministic seed
  // writes them in one transaction), gives a zero-width span. Division by that
  // span would put every record in the last bucket and draw a cliff, so the
  // series is reported as a flat line at the true total instead.
  const first = times[0];
  const last = times[times.length - 1];
  const span = last - first;
  if (span <= 0) return Array(buckets).fill(times.length);

  const counts = Array(buckets).fill(0);
  for (const t of times) {
    const idx = Math.min(buckets - 1, Math.floor(((t - first) / span) * buckets));
    counts[idx] += 1;
  }

  let running = 0;
  return counts.map((c) => (running += c));
}
