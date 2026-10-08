/** A half-open span of absolute time: [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const duration = (iv: Interval): number => iv.end - iv.start;

export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

/** Sorts intervals, drops empty ones and merges any that overlap or touch. */
export function normalize(list: readonly Interval[]): Interval[] {
  const sorted = list
    .filter((iv) => iv.end > iv.start)
    .map((iv) => ({ start: iv.start, end: iv.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push(iv);
  }
  return out;
}

/** Times covered by both lists. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = normalize(a);
  const right = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (end > start) out.push({ start, end });
    if (left[i].end < right[j].end) i++;
    else j++;
  }
  return out;
}

export const atLeast = (list: readonly Interval[], minMs: number): Interval[] =>
  list.filter((iv) => duration(iv) >= minMs);
