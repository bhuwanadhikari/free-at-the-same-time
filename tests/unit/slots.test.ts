import { describe, expect, it } from 'vitest';
import { HOUR_MS } from '../../src/lib/intervals';
import {
  EMPTY_DAY,
  WHOLE_DAY,
  addMonths,
  applyRuleChange,
  dayFreeFromEntry,
  draftFromDay,
  entryForDay,
  formatDuration,
  formatHoursShort,
  freeColumns,
  freeMinutes,
  hourColumns,
  hourCoverage,
  monthDates,
  normalizeRules,
  parseWeeklyRules,
  planWrites,
  ruleAt,
  sameClock,
  setHours,
  summaryLines,
  weekdayOf,
  type DayFree,
} from '../../src/lib/slots';
import { EARLY, entry, hours, utc } from './helpers';

const LONDON = 'Europe/London';
const NY = 'America/New_York';
const DATE = '2026-10-10';

const spans = (...pairs: [number, number][]): DayFree => ({ wholeDay: false, spans: pairs.map(([start, end]) => ({ start, end })) });

describe('day model', () => {
  it('reads entries as minute spans', () => {
    expect(dayFreeFromEntry(undefined)).toEqual(EMPTY_DAY);
    expect(dayFreeFromEntry(entry('u1', DATE, LONDON, 'flexible'))).toEqual(WHOLE_DAY);
    expect(dayFreeFromEntry(entry('u1', DATE, LONDON, hours(['09:00', '11:30'], ['18:00', '19:00'])))).toEqual(spans([540, 690], [1080, 1140]));
  });

  it('keeps the part of an overnight range that runs past midnight', () => {
    expect(dayFreeFromEntry(entry('u1', DATE, LONDON, hours(['22:00', '02:00'])))).toEqual(spans([1320, 1560]));
  });

  it('toggles hours, merging neighbours and splitting blocks', () => {
    let day = setHours(EMPTY_DAY, 9, 10, true);
    day = setHours(day, 10, 12, true);
    expect(day).toEqual(spans([540, 720]));
    expect(setHours(day, 10, 11, false)).toEqual(spans([540, 600], [660, 720]));
    expect(setHours(day, 9, 12, false)).toEqual(EMPTY_DAY);
  });

  it('becomes a whole day when every hour is free, and stops being one when any hour is cleared', () => {
    const full = setHours(setHours(EMPTY_DAY, 0, 12, true), 12, 24, true);
    expect(full).toEqual(WHOLE_DAY);
    expect(setHours(WHOLE_DAY, 13, 14, false)).toEqual(spans([0, 780], [840, 1440]));
  });

  it('measures how much of each hour is free', () => {
    const cov = hourCoverage(spans([570, 660]));
    expect(cov[9]).toBe(30);
    expect(cov[10]).toBe(60);
    expect(cov[11]).toBe(0);
    expect(hourCoverage(WHOLE_DAY).every((m) => m === 60)).toBe(true);
  });

  it('summarises a day for its card', () => {
    expect(summaryLines(WHOLE_DAY)).toEqual(['All day']);
    expect(summaryLines(EMPTY_DAY)).toEqual([]);
    expect(summaryLines(spans([540, 600], [900, 1020]))).toHaveLength(2);
  });
});

describe('storing a day', () => {
  it('stores a whole day as flexible and nothing as no document', () => {
    expect(draftFromDay(WHOLE_DAY)).toEqual({ kind: 'flexible', ranges: [] });
    expect(draftFromDay(EMPTY_DAY)).toBeNull();
    const res = entryForDay('u1', DATE, LONDON, EMPTY_DAY, EARLY);
    expect(res).toEqual({ ok: true, value: null });
  });

  it('ends a block that reaches midnight at the next midnight', () => {
    const res = entryForDay('u1', DATE, LONDON, spans([1320, 1440]), EARLY);
    if (!res.ok || !res.value) throw new Error('expected an entry');
    expect(res.value.ranges[0]).toMatchObject({ start: '22:00', end: '00:00' });
    expect(res.value.endMs).toBe(utc('2026-10-10T23:00:00Z'));
  });

  it('round-trips through an entry, including an overnight tail', () => {
    for (const day of [spans([540, 600], [660, 720]), spans([60, 120], [1320, 1560]), WHOLE_DAY]) {
      const res = entryForDay('u1', DATE, LONDON, day, EARLY);
      if (!res.ok || !res.value) throw new Error('expected an entry');
      expect(dayFreeFromEntry(res.value)).toEqual(day);
    }
  });

  it('drops a day whose free time has all passed', () => {
    const res = entryForDay('u1', DATE, LONDON, spans([540, 600]), utc('2026-10-10T12:00:00Z'));
    expect(res).toEqual({ ok: true, value: null });
  });

  it('reports hours skipped by daylight saving', () => {
    const res = entryForDay('u1', '2027-03-14', NY, spans([120, 180]), EARLY);
    expect(res.ok).toBe(false);
  });

  it('plans only the writes that change something', () => {
    const changes = [
      { date: '2026-10-10', before: EMPTY_DAY, after: spans([540, 600]), exists: false },
      { date: '2026-10-11', before: spans([540, 600]), after: spans([540, 600]), exists: true },
      { date: '2026-10-12', before: spans([540, 600]), after: EMPTY_DAY, exists: true },
      // Nothing stored and nothing to store: no delete of a missing document.
      { date: '2026-10-13', before: EMPTY_DAY, after: EMPTY_DAY, exists: false },
    ];
    const res = planWrites('u1', LONDON, EARLY, changes);
    if (!res.ok) throw new Error(res.error);
    expect(res.value.map((w) => [w.date, w.entry === null])).toEqual([
      ['2026-10-10', false],
      ['2026-10-12', true],
    ]);
  });

  it('can skip days that can’t be stored instead of failing', () => {
    const changes = [
      { date: '2027-03-14', before: EMPTY_DAY, after: spans([120, 180]), exists: false },
      { date: '2027-03-15', before: EMPTY_DAY, after: spans([120, 180]), exists: false },
    ];
    expect(planWrites('u1', NY, EARLY, changes).ok).toBe(false);
    const res = planWrites('u1', NY, EARLY, changes, { skipInvalid: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.value.map((w) => w.date)).toEqual(['2027-03-15']);
  });
});

describe('weekly repeats', () => {
  it('parses stored rules defensively and merges overlaps', () => {
    const rules = parseWeeklyRules([
      { weekday: 5, start: 900, end: 960 },
      { weekday: 5, start: 960, end: 1020 },
      { weekday: 8, start: 0, end: 60 },
      { weekday: 1, start: 600, end: 600 },
      { weekday: 1, start: 0, end: 2000 },
      'junk',
      null,
    ]);
    expect(rules).toEqual([{ weekday: 5, start: 900, end: 1020 }]);
    expect(parseWeeklyRules(undefined)).toEqual([]);
  });

  it('finds the rule covering an hour', () => {
    const rules = normalizeRules([{ weekday: 5, start: 900, end: 1020 }]);
    expect(weekdayOf('2026-10-09')).toBe(5);
    expect(ruleAt(rules, 5, 960)).toEqual(rules[0]);
    expect(ruleAt(rules, 5, 1020)).toBeUndefined();
    expect(ruleAt(rules, 4, 960)).toBeUndefined();
  });

  it('swaps an old repeat for a new one on a day', () => {
    const day = spans([540, 600], [900, 960]);
    expect(applyRuleChange(day, { start: 900, end: 960 }, { start: 900, end: 1080 })).toEqual(spans([540, 600], [900, 1080]));
    expect(applyRuleChange(day, { start: 900, end: 960 }, null)).toEqual(spans([540, 600]));
  });
});

describe('calendar helpers', () => {
  it('lists the days of a month and steps between months', () => {
    expect(monthDates('2026-02')).toHaveLength(28);
    expect(monthDates('2028-02')).toHaveLength(29);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('formats durations', () => {
    expect(formatDuration(60)).toBe('1 hour');
    expect(formatDuration(150)).toBe('2 hours 30 min');
  });

  it('totals a day’s free hours for its calendar cell', () => {
    expect(formatHoursShort(freeMinutes(spans([540, 600], [900, 1020])))).toBe('3h');
    expect(formatHoursShort(freeMinutes(spans([570, 660])))).toBe('1.5h');
    expect(formatHoursShort(freeMinutes(spans([1320, 1560])))).toBe('4h');
    expect(formatHoursShort(freeMinutes(WHOLE_DAY))).toBe('24h');
    expect(freeMinutes(EMPTY_DAY)).toBe(0);
  });

  it('lays out 24 wall-clock hour columns, even across daylight-saving changes', () => {
    const normal = hourColumns(DATE, LONDON);
    expect(normal).toHaveLength(24);
    expect(normal[18].start).toBe(utc('2026-10-10T17:00:00Z'));
    // Clocks go back at 02:00 BST: the 01:00 hour happens twice.
    const fall = hourColumns('2026-10-25', LONDON);
    expect(fall[1].end - fall[1].start).toBe(2 * HOUR_MS);
    // Clocks jump from 02:00 to 03:00: that hour doesn't exist.
    const spring = hourColumns('2027-03-14', NY);
    expect(spring[2].end - spring[2].start).toBe(0);
  });

  it('treats zones as the same when their clocks agree all day', () => {
    expect(sameClock(DATE, LONDON, LONDON)).toBe(true);
    expect(sameClock(DATE, LONDON, 'Europe/Dublin')).toBe(true);
    expect(sameClock(DATE, LONDON, NY)).toBe(false);
    // London's clocks go back on Oct 25 but New York's don't until Nov 1; Lisbon follows London.
    expect(sameClock('2026-10-25', LONDON, 'Europe/Lisbon')).toBe(true);
    expect(sameClock('2026-10-25', LONDON, 'UTC')).toBe(false);
  });

  it('marks columns free when at least half the hour is covered', () => {
    const cols = hourColumns(DATE, LONDON);
    const free = freeColumns([{ start: utc('2026-10-10T08:30:00Z'), end: utc('2026-10-10T10:10:00Z') }], cols);
    // 09:30–11:10 London time.
    expect(free.slice(8, 12)).toEqual([false, true, true, false]);
  });
});
