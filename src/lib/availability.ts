import { MINUTE_MS, overlaps } from './intervals';
import type { AvailabilityEntry, AvailabilityKind, TimeRange } from './matching';
import { DATE_RE, TIME_RE, addDays, daySpan, formatWallTime, wallTimeToMs, type LocalDate } from './time';

/** Separate free blocks in one day. Mirrors firestore.rules, which can't afford to check more. */
export const MAX_RANGES_PER_DAY = 8;
export const MIN_RANGE_MS = 30 * MINUTE_MS;
export const TOO_MANY_RANGES = `A day can have up to ${MAX_RANGES_PER_DAY} separate free blocks. Join some of them up.`;

export interface RangeDraft {
  start: string;
  end: string;
}

export interface DayDraft {
  kind: AvailabilityKind;
  ranges: RangeDraft[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const availabilityDocId = (uid: string, date: LocalDate): string => `${uid}_${date}`;

/** True when the range ends on the following day (e.g. 22:00 – 02:00). */
export const crossesMidnight = (r: RangeDraft): boolean => r.end <= r.start;

/** Converts one wall-clock range on `date` in `tz` into exact instants. */
export function resolveRange(date: LocalDate, range: RangeDraft, tz: string): Result<TimeRange> {
  if (!TIME_RE.test(range.start) || !TIME_RE.test(range.end)) return { ok: false, error: 'Pick a start and end time.' };
  if (range.start === range.end) return { ok: false, error: 'Start and end can’t be the same time.' };
  const endDate = crossesMidnight(range) ? addDays(date, 1) : date;
  const start = wallTimeToMs(date, range.start, tz);
  const end = wallTimeToMs(endDate, range.end, tz);
  for (const [t, label] of [
    [start, range.start],
    [end, range.end],
  ] as const) {
    if (!t.exists) {
      return { ok: false, error: `${formatWallTime(label)} is skipped by a daylight-saving change that day. Pick another time.` };
    }
  }
  if (end.ms - start.ms < MIN_RANGE_MS) return { ok: false, error: 'Each time range needs to be at least 30 minutes.' };
  return { ok: true, value: { start: range.start, end: range.end, startMs: start.ms, endMs: end.ms } };
}

/** Validates a draft and turns it into a storable entry with exact instants. */
export function buildEntry(uid: string, date: LocalDate, tz: string, draft: DayDraft): Result<AvailabilityEntry> {
  if (!DATE_RE.test(date)) return { ok: false, error: 'Invalid date.' };
  const base = { id: availabilityDocId(uid, date), uid, date, tz };

  if (draft.kind === 'flexible') {
    const span = daySpan(date, tz);
    return { ok: true, value: { ...base, kind: 'flexible', ranges: [], startMs: span.start, endMs: span.end } };
  }

  if (draft.ranges.length === 0) return { ok: false, error: 'Add at least one time range.' };
  if (draft.ranges.length > MAX_RANGES_PER_DAY) return { ok: false, error: TOO_MANY_RANGES };

  const ranges: TimeRange[] = [];
  for (const r of draft.ranges) {
    const res = resolveRange(date, r, tz);
    if (!res.ok) return res;
    ranges.push(res.value);
  }
  ranges.sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < ranges.length; i++) {
    const prev = { start: ranges[i - 1].startMs, end: ranges[i - 1].endMs };
    const cur = { start: ranges[i].startMs, end: ranges[i].endMs };
    if (overlaps(prev, cur)) return { ok: false, error: 'Two of your time ranges overlap. Adjust or remove one.' };
  }
  return {
    ok: true,
    value: {
      ...base,
      kind: 'hours',
      ranges,
      startMs: ranges[0].startMs,
      endMs: Math.max(...ranges.map((r) => r.endMs)),
    },
  };
}

export function draftFromEntry(entry: AvailabilityEntry): DayDraft {
  return { kind: entry.kind, ranges: entry.ranges.map((r) => ({ start: r.start, end: r.end })) };
}

export function sameDraft(a: DayDraft, b: DayDraft): boolean {
  return (
    a.kind === b.kind &&
    a.ranges.length === b.ranges.length &&
    a.ranges.every((r, i) => r.start === b.ranges[i].start && r.end === b.ranges[i].end)
  );
}
