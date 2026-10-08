import { describe, expect, it } from 'vitest';
import { HOUR_MS, intersect, normalize } from '../../src/lib/intervals';
import { addDays, daySpan, todayIn, wallTimeToMs } from '../../src/lib/time';
import { utc } from './helpers';

describe('daySpan', () => {
  it('is 24 hours on an ordinary day', () => {
    const span = daySpan('2026-10-10', 'Europe/London');
    expect(span.start).toBe(utc('2026-10-09T23:00:00Z'));
    expect(span.end - span.start).toBe(24 * HOUR_MS);
  });

  it('is 25 hours when clocks go back', () => {
    const span = daySpan('2026-10-25', 'Europe/London');
    expect(span.end - span.start).toBe(25 * HOUR_MS);
  });

  it('is 23 hours when clocks go forward', () => {
    const span = daySpan('2027-03-14', 'America/New_York');
    expect(span.end - span.start).toBe(23 * HOUR_MS);
  });
});

describe('wallTimeToMs', () => {
  it('flags wall times skipped by a daylight-saving gap', () => {
    expect(wallTimeToMs('2027-03-14', '02:30', 'America/New_York').exists).toBe(false);
    expect(wallTimeToMs('2027-03-14', '03:30', 'America/New_York').exists).toBe(true);
  });

  it('resolves the same wall time to different instants in different zones', () => {
    const london = wallTimeToMs('2026-10-10', '18:00', 'Europe/London').ms;
    const tokyo = wallTimeToMs('2026-10-10', '18:00', 'Asia/Tokyo').ms;
    expect(london).toBe(utc('2026-10-10T17:00:00Z'));
    expect(tokyo).toBe(utc('2026-10-10T09:00:00Z'));
  });
});

describe('calendar helpers', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('gives the local date for an instant', () => {
    const instant = utc('2026-10-10T20:00:00Z');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-10-10');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-10-11');
  });
});

describe('interval math', () => {
  it('merges overlapping and touching intervals', () => {
    expect(normalize([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 7, end: 10 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 10 },
    ]);
  });

  it('intersects interval lists', () => {
    expect(intersect([{ start: 0, end: 10 }, { start: 20, end: 30 }], [{ start: 5, end: 25 }])).toEqual([
      { start: 5, end: 10 },
      { start: 20, end: 25 },
    ]);
  });
});
