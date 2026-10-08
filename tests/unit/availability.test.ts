import { describe, expect, it } from 'vitest';
import { buildEntry } from '../../src/lib/availability';
import { HOUR_MS } from '../../src/lib/intervals';
import { hours, utc } from './helpers';

const LONDON = 'Europe/London';
const NY = 'America/New_York';

describe('buildEntry', () => {
  it('stores a flexible day as the local day span with no hours', () => {
    const res = buildEntry('u1', '2026-10-10', LONDON, { kind: 'flexible', ranges: [] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.kind).toBe('flexible');
    expect(res.value.ranges).toEqual([]);
    expect(res.value.startMs).toBe(utc('2026-10-09T23:00:00Z'));
    expect(res.value.endMs).toBe(utc('2026-10-10T23:00:00Z'));
    expect(res.value.id).toBe('u1_2026-10-10');
  });

  it('stores exact instants and keeps the wall-clock times and zone', () => {
    const res = buildEntry('u1', '2026-10-10', LONDON, hours(['18:00', '21:30']));
    if (!res.ok) throw new Error(res.error);
    expect(res.value.tz).toBe(LONDON);
    expect(res.value.ranges[0]).toMatchObject({ start: '18:00', end: '21:30' });
    expect(res.value.ranges[0].startMs).toBe(utc('2026-10-10T17:00:00Z'));
    expect(res.value.ranges[0].endMs).toBe(utc('2026-10-10T20:30:00Z'));
  });

  it('treats an end time at or before the start as the next day', () => {
    const res = buildEntry('u1', '2026-10-10', LONDON, hours(['22:00', '02:00']));
    if (!res.ok) throw new Error(res.error);
    expect(res.value.ranges[0].startMs).toBe(utc('2026-10-10T21:00:00Z'));
    expect(res.value.ranges[0].endMs).toBe(utc('2026-10-11T01:00:00Z'));
    expect(res.value.endMs).toBe(utc('2026-10-11T01:00:00Z'));
  });

  it('ends a range at midnight when the end is 00:00', () => {
    const res = buildEntry('u1', '2026-10-10', LONDON, hours(['20:00', '00:00']));
    if (!res.ok) throw new Error(res.error);
    expect(res.value.ranges[0].endMs - res.value.ranges[0].startMs).toBe(4 * HOUR_MS);
  });

  it('measures real elapsed time across daylight-saving changes', () => {
    const spring = buildEntry('u1', '2027-03-14', NY, hours(['01:00', '04:00']));
    const fall = buildEntry('u1', '2026-11-01', NY, hours(['00:00', '03:00']));
    if (!spring.ok || !fall.ok) throw new Error('unexpected');
    expect(spring.value.ranges[0].endMs - spring.value.ranges[0].startMs).toBe(2 * HOUR_MS);
    expect(fall.value.ranges[0].endMs - fall.value.ranges[0].startMs).toBe(4 * HOUR_MS);
  });

  it('rejects times skipped by daylight saving', () => {
    const res = buildEntry('u1', '2027-03-14', NY, hours(['02:30', '05:00']));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/daylight-saving/);
  });

  it('rejects ranges shorter than 30 minutes, identical times and overlaps', () => {
    expect(buildEntry('u1', '2026-10-10', LONDON, hours(['18:00', '18:20'])).ok).toBe(false);
    expect(buildEntry('u1', '2026-10-10', LONDON, hours(['18:00', '18:00'])).ok).toBe(false);
    expect(buildEntry('u1', '2026-10-10', LONDON, hours(['18:00', '20:00'], ['19:00', '21:00'])).ok).toBe(false);
  });

  it('accepts touching ranges and limits the number of ranges', () => {
    expect(buildEntry('u1', '2026-10-10', LONDON, hours(['09:00', '10:00'], ['10:00', '11:00'])).ok).toBe(true);
    expect(
      buildEntry('u1', '2026-10-10', LONDON, hours(['01:00', '02:00'], ['03:00', '04:00'], ['05:00', '06:00'], ['07:00', '08:00'], ['09:00', '10:00'])).ok,
    ).toBe(false);
  });

  it('requires at least one range for specific hours', () => {
    expect(buildEntry('u1', '2026-10-10', LONDON, { kind: 'hours', ranges: [] }).ok).toBe(false);
  });
});
