import { DateTime } from 'luxon';
import type { Interval } from './intervals';

/** Calendar date in a specific time zone, formatted YYYY-MM-DD. */
export type LocalDate = string;
/** Wall-clock time, formatted HH:mm (24h). */
export type WallTime = string;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(tz: string): boolean {
  return typeof tz === 'string' && tz.length > 0 && DateTime.now().setZone(tz).isValid;
}

export function detectTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && isValidTimeZone(tz)) return tz;
  } catch {
    // Fall through to UTC.
  }
  return 'UTC';
}

export function listTimeZones(current?: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  const set = new Set(zones);
  set.add('UTC');
  if (current) set.add(current);
  return [...set].sort();
}

export function todayIn(tz: string, nowMs = Date.now()): LocalDate {
  return DateTime.fromMillis(nowMs, { zone: tz }).toISODate()!;
}

/** Pure calendar arithmetic; independent of any time zone. */
export function addDays(date: LocalDate, days: number): LocalDate {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate()!;
}

/**
 * The absolute span of a local calendar day. Usually 24h, but 23h or 25h on
 * daylight-saving transition days.
 */
export function daySpan(date: LocalDate, tz: string): Interval {
  const start = DateTime.fromISO(date, { zone: tz }).startOf('day');
  return { start: start.toMillis(), end: start.plus({ days: 1 }).startOf('day').toMillis() };
}

export interface ResolvedTime {
  ms: number;
  /** False when the wall time falls in a daylight-saving gap and was shifted. */
  exists: boolean;
}

export function wallTimeToMs(date: LocalDate, time: WallTime, tz: string): ResolvedTime {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  return { ms: dt.toMillis(), exists: dt.toFormat('yyyy-MM-dd HH:mm') === `${date} ${time}` };
}

export function dateOf(ms: number, tz: string): LocalDate {
  return DateTime.fromMillis(ms, { zone: tz }).toISODate()!;
}

// ---------- Formatting ----------

export function uses24h(): boolean {
  try {
    const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24';
  } catch {
    return false;
  }
}

export function formatTime(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toLocaleString(DateTime.TIME_SIMPLE);
}

/** Formats a wall-clock string like "18:30" without involving a zone. */
export function formatWallTime(time: WallTime): string {
  return DateTime.fromISO(`2000-01-01T${time}`, { zone: 'UTC' }).toLocaleString(DateTime.TIME_SIMPLE);
}

/** "6p", "6:30p", or "18:30" for 24-hour locales — for tight spaces. */
export function compactWallTime(time: WallTime): string {
  const [h, m] = time.split(':').map(Number);
  if (uses24h()) return time;
  const suffix = h < 12 ? 'a' : 'p';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

export function formatDayLabel(date: LocalDate): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).toLocaleString({ weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatLongDay(date: LocalDate): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' });
}

export function dayParts(date: LocalDate): { weekday: string; day: string; month: string } {
  const dt = DateTime.fromISO(date, { zone: 'UTC' });
  return {
    weekday: dt.toLocaleString({ weekday: 'short' }),
    day: dt.toFormat('d'),
    month: dt.toLocaleString({ month: 'short' }),
  };
}

/**
 * "6:00 PM – 8:00 PM", adding weekday prefixes when the interval does not sit
 * on `anchorDate` (as seen in `tz`), e.g. "Fri 11:00 PM – Sat 1:00 AM".
 */
export function formatInterval(iv: Interval, tz: string, anchorDate?: LocalDate): string {
  const start = DateTime.fromMillis(iv.start, { zone: tz });
  const endInclusive = DateTime.fromMillis(iv.end - 1, { zone: tz });
  const end = DateTime.fromMillis(iv.end, { zone: tz });
  const startDate = start.toISODate();
  const endDate = endInclusive.toISODate();
  const startPrefix = anchorDate && startDate !== anchorDate ? `${start.toLocaleString({ weekday: 'short' })} ` : '';
  const endPrefix = endDate !== startDate ? `${end.toLocaleString({ weekday: 'short' })} ` : '';
  return `${startPrefix}${start.toLocaleString(DateTime.TIME_SIMPLE)} – ${endPrefix}${end.toLocaleString(DateTime.TIME_SIMPLE)}`;
}

export function formatRelative(ms: number, nowMs = Date.now()): string {
  const diff = nowMs - ms;
  if (diff < 60_000) return 'just now';
  const rel = DateTime.fromMillis(ms).toRelative({ base: DateTime.fromMillis(nowMs), style: 'short' });
  return rel ?? '';
}

export function shortZoneName(tz: string, atMs = Date.now()): string {
  return DateTime.fromMillis(atMs, { zone: tz }).toFormat('ZZZZ');
}
