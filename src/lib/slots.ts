import { DateTime } from 'luxon';
import { buildEntry, type DayDraft, type Result } from './availability';
import { MINUTE_MS, normalize, type Interval } from './intervals';
import type { AvailabilityEntry } from './matching';
import { addDays, compactWallTime, daySpan, formatDayLabel, uses24h, wallTimeToMs, type LocalDate } from './time';

export const HOURS = 24;
export const DAY_MINUTES = HOURS * 60;
/** How far ahead you can plan. firestore.rules allows up to 100 days. */
export const PLANNING_DAYS = 90;
/** A slot counts as free when at least half of its hour is free. */
export const SLOT_FREE_MINUTES = 30;

/**
 * Wall-clock minutes from a local midnight. `end` may pass 1440 for an older
 * entry whose range ran past midnight (e.g. 22:00 – 02:00).
 */
export type Span = Interval;

/** One day's free time, as the hour grid sees it. */
export interface DayFree {
  /** "Free whole day", stored as a flexible entry. */
  wholeDay: boolean;
  spans: Span[];
}

export const EMPTY_DAY: DayFree = { wholeDay: false, spans: [] };
export const WHOLE_DAY: DayFree = { wholeDay: true, spans: [{ start: 0, end: DAY_MINUTES }] };

export const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** "HH:mm"; 1440 wraps to "00:00", which the entry format reads as the next midnight. */
export const toWallTime = (minutes: number): string => {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function subtract(list: readonly Span[], cut: Span): Span[] {
  const out: Span[] = [];
  for (const s of list) {
    if (cut.end <= s.start || cut.start >= s.end) {
      out.push(s);
      continue;
    }
    if (s.start < cut.start) out.push({ start: s.start, end: cut.start });
    if (s.end > cut.end) out.push({ start: cut.end, end: s.end });
  }
  return out;
}

function fromSpans(list: readonly Span[]): DayFree {
  const spans = normalize(list);
  if (spans.some((s) => s.start <= 0 && s.end >= DAY_MINUTES)) return WHOLE_DAY;
  // A range can't be 24h or longer, so drop an overnight tail that would make it so.
  return { wholeDay: false, spans: spans.map((s) => (s.end - s.start >= DAY_MINUTES ? { start: s.start, end: DAY_MINUTES } : s)) };
}

export function dayFreeFromEntry(entry: AvailabilityEntry | undefined): DayFree {
  if (!entry) return EMPTY_DAY;
  if (entry.kind === 'flexible') return WHOLE_DAY;
  return fromSpans(
    entry.ranges.map((r) => {
      const start = toMinutes(r.start);
      const end = toMinutes(r.end);
      return { start, end: end <= start ? end + DAY_MINUTES : end };
    }),
  );
}

/** Marks wall-clock minutes [from, to) free or not free. */
export function setRange(day: DayFree, from: number, to: number, free: boolean): DayFree {
  if (to <= from) return day;
  const cut = { start: from, end: to };
  return free ? fromSpans([...day.spans, cut]) : fromSpans(subtract(day.spans, cut));
}

export const setHours = (day: DayFree, fromHour: number, toHour: number, free: boolean): DayFree =>
  setRange(day, fromHour * 60, toHour * 60, free);

export function sameDay(a: DayFree, b: DayFree): boolean {
  return (
    a.wholeDay === b.wholeDay &&
    a.spans.length === b.spans.length &&
    a.spans.every((s, i) => s.start === b.spans[i].start && s.end === b.spans[i].end)
  );
}

/** Free minutes in each wall-clock hour (0–60). */
export function hourCoverage(day: DayFree): number[] {
  const out = new Array<number>(HOURS).fill(0);
  for (const s of day.spans) {
    const start = Math.max(0, s.start);
    const end = Math.min(DAY_MINUTES, s.end);
    for (let h = Math.floor(start / 60); h < Math.ceil(end / 60); h++) {
      out[h] += Math.min(end, (h + 1) * 60) - Math.max(start, h * 60);
    }
  }
  return out;
}

export function draftFromDay(day: DayFree): DayDraft | null {
  if (day.wholeDay) return { kind: 'flexible', ranges: [] };
  if (day.spans.length === 0) return null;
  return { kind: 'hours', ranges: day.spans.map((s) => ({ start: toWallTime(s.start), end: toWallTime(s.end) })) };
}

/**
 * The entry to store for a day, or null when the document should go: nothing
 * is free, or everything left has already ended (the rules reject past entries).
 */
export function entryForDay(uid: string, date: LocalDate, tz: string, day: DayFree, nowMs: number): Result<AvailabilityEntry | null> {
  const draft = draftFromDay(day);
  if (!draft) return { ok: true, value: null };
  const res = buildEntry(uid, date, tz, draft);
  if (!res.ok) return res;
  return { ok: true, value: res.value.endMs > nowMs ? res.value : null };
}

export interface DayChange {
  date: LocalDate;
  /** What's stored now. */
  before: DayFree;
  after: DayFree;
  /** Whether the day's document exists. */
  exists: boolean;
}

/**
 * Turns day changes into document writes, skipping days that don't change.
 * With `skipInvalid`, days that can't be stored (e.g. a time skipped by a
 * daylight-saving change) are left out instead of failing the whole plan.
 */
export function planWrites(
  uid: string,
  tz: string,
  nowMs: number,
  changes: readonly DayChange[],
  opts: { skipInvalid?: boolean } = {},
): Result<{ date: LocalDate; entry: AvailabilityEntry | null }[]> {
  const out: { date: LocalDate; entry: AvailabilityEntry | null }[] = [];
  for (const c of changes) {
    if (sameDay(c.before, c.after)) continue;
    const res = entryForDay(uid, c.date, tz, c.after, nowMs);
    if (!res.ok) {
      if (opts.skipInvalid) continue;
      return { ok: false, error: changes.length > 1 ? `${formatDayLabel(c.date)}: ${res.error}` : res.error };
    }
    if (res.value === null && !c.exists) continue;
    out.push({ date: c.date, entry: res.value });
  }
  return { ok: true, value: out };
}

// ---------- Text ----------

export const formatSpan = (s: Span): string => `${compactWallTime(toWallTime(s.start))}–${compactWallTime(toWallTime(s.end))}`;

/** Short lines for a day card: "All day", or "9a–11a", "3p–5p". */
export function summaryLines(day: DayFree): string[] {
  if (day.wholeDay) return ['All day'];
  return day.spans.map(formatSpan);
}

/** "6 AM" / "06:00" for hour labels. */
export function formatHour(hour: number): string {
  if (uses24h()) return `${String(hour % 24).padStart(2, '0')}:00`;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour % 24 < 12 ? 'AM' : 'PM'}`;
}

/** Block labels: "3 – 5 PM", "11:30 AM – 1 PM", or "15:00–17:00" in 24-hour locales. */
export function formatSpanLabel(start: number, end: number): string {
  if (uses24h()) return `${toWallTime(start)}–${end >= DAY_MINUTES ? '24:00' : toWallTime(end)}`;
  const part = (m: number) => {
    const h = Math.floor(m / 60) % 24;
    const min = m % 60;
    return { text: `${h % 12 === 0 ? 12 : h % 12}${min ? `:${String(min).padStart(2, '0')}` : ''}`, ampm: h < 12 ? 'AM' : 'PM' };
  };
  const a = part(start);
  const b = part(end);
  return a.ampm === b.ampm && end - start < 12 * 60 ? `${a.text} – ${b.text} ${b.ampm}` : `${a.text} ${a.ampm} – ${b.text} ${b.ampm}`;
}

/** "3 PM – 5 PM". */
export const formatHourRange = (fromHour: number, toHour: number): string => `${formatHour(fromHour)} – ${formatHour(toHour)}`;

/** "1 hour", "2 hours 30 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : '';
  const mins = m ? `${m} min` : '';
  return [hours, mins].filter(Boolean).join(' ') || '0 min';
}

/** Total free minutes in a day, counting an overnight tail. */
export const freeMinutes = (day: DayFree): number =>
  day.wholeDay ? DAY_MINUTES : day.spans.reduce((sum, s) => sum + s.end - s.start, 0);

/** "3h", "1.5h": a day's free time on a calendar cell. */
export const formatHoursShort = (minutes: number): string => `${Math.round(minutes / 6) / 10}h`;

/** "6a" / "06" for narrow hour columns. */
export const formatHourShort = (hour: number): string =>
  uses24h() ? String(hour % 24).padStart(2, '0') : compactWallTime(`${String(hour % 24).padStart(2, '0')}:00`);

// ---------- Calendar helpers ----------

/** Whether two time zones show the same clock all through a date, even under different names. */
export function sameClock(date: LocalDate, a: string, b: string): boolean {
  if (a === b) return true;
  const { start, end } = daySpan(date, a);
  return [start, end - 1].every((ms) => DateTime.fromMillis(ms, { zone: a }).offset === DateTime.fromMillis(ms, { zone: b }).offset);
}

export const horizonEnd = (today: LocalDate): LocalDate => addDays(today, PLANNING_DAYS - 1);

/** 1 = Monday … 7 = Sunday. */
export const weekdayOf = (date: LocalDate): number => DateTime.fromISO(date, { zone: 'UTC' }).weekday;

export const weekdayName = (weekday: number): string =>
  DateTime.fromObject({ year: 2024, month: 1, day: weekday }, { zone: 'UTC' }).toLocaleString({ weekday: 'long' });

export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "2026-10" → every date in that month. */
export function monthDates(month: string): LocalDate[] {
  const start = DateTime.fromISO(`${month}-01`, { zone: 'UTC' });
  return dateRange(start.toISODate()!, start.endOf('month').toISODate()!);
}

export const monthOf = (date: LocalDate): string => date.slice(0, 7);

export const addMonths = (month: string, n: number): string =>
  DateTime.fromISO(`${month}-01`, { zone: 'UTC' }).plus({ months: n }).toFormat('yyyy-MM');

export const formatMonth = (month: string): string =>
  DateTime.fromISO(`${month}-01`, { zone: 'UTC' }).toLocaleString({ month: 'long', year: 'numeric' });

/** The 24 wall-clock hours of a local day as absolute intervals (DST hours may be empty or doubled). */
export function hourColumns(date: LocalDate, tz: string): Interval[] {
  const end = daySpan(date, tz).end;
  return Array.from({ length: HOURS }, (_, h) => ({
    start: wallTimeToMs(date, toWallTime(h * 60), tz).ms,
    end: h === HOURS - 1 ? end : wallTimeToMs(date, toWallTime((h + 1) * 60), tz).ms,
  }));
}

/** Whether `windows` cover enough of each column to count it as free. */
export function freeColumns(windows: readonly Interval[], columns: readonly Interval[]): boolean[] {
  return columns.map((col) => {
    const len = col.end - col.start;
    if (len <= 0) return false;
    let covered = 0;
    for (const w of windows) covered += Math.max(0, Math.min(w.end, col.end) - Math.max(w.start, col.start));
    return covered >= Math.min(SLOT_FREE_MINUTES * MINUTE_MS, len / 2);
  });
}

// ---------- Weekly repeats ----------

/** "Free 15:00–16:00 every Friday". Minutes within the day; `end` ≤ 1440. */
export interface WeeklyRule {
  weekday: number;
  start: number;
  end: number;
}

export const MAX_WEEKLY_RULES = 28;

export function parseWeeklyRules(raw: unknown): WeeklyRule[] {
  if (!Array.isArray(raw)) return [];
  const out: WeeklyRule[] = [];
  for (const r of raw.slice(0, MAX_WEEKLY_RULES)) {
    const { weekday, start, end } = (r ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(weekday) || !Number.isInteger(start) || !Number.isInteger(end)) continue;
    const [wd, s, e] = [weekday, start, end] as number[];
    if (wd >= 1 && wd <= 7 && s >= 0 && e > s && e <= DAY_MINUTES) out.push({ weekday: wd, start: s, end: e });
  }
  return normalizeRules(out);
}

/** Merges overlapping or touching rules on the same weekday. */
export function normalizeRules(rules: readonly WeeklyRule[]): WeeklyRule[] {
  const out: WeeklyRule[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    for (const s of normalize(rules.filter((r) => r.weekday === wd))) out.push({ weekday: wd, start: s.start, end: s.end });
  }
  return out;
}

export const rulesOn = (rules: readonly WeeklyRule[], weekday: number): WeeklyRule[] => rules.filter((r) => r.weekday === weekday);

export function ruleAt(rules: readonly WeeklyRule[], weekday: number, minute: number): WeeklyRule | undefined {
  return rules.find((r) => r.weekday === weekday && r.start <= minute && minute < r.end);
}

/** Takes the old rule's time out of a day and puts the new one in. */
export function applyRuleChange(day: DayFree, remove: Span | null, add: Span | null): DayFree {
  let next = day;
  if (remove) next = setRange(next, remove.start, remove.end, false);
  if (add) next = setRange(next, add.start, add.end, true);
  return next;
}
