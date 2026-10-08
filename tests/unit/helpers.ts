import { buildEntry, type DayDraft } from '../../src/lib/availability';
import type { AvailabilityEntry } from '../../src/lib/matching';

export function entry(uid: string, date: string, tz: string, draft: DayDraft | 'flexible'): AvailabilityEntry {
  const res = buildEntry(uid, date, tz, draft === 'flexible' ? { kind: 'flexible', ranges: [] } : draft);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

export const hours = (...ranges: [string, string][]): DayDraft => ({
  kind: 'hours',
  ranges: ranges.map(([start, end]) => ({ start, end })),
});

export const utc = (iso: string): number => Date.parse(iso);

/** A "now" safely before every date used in the tests. */
export const EARLY = utc('2026-01-01T00:00:00Z');
