import { describe, expect, it } from 'vitest';
import { HOUR_MS } from '../../src/lib/intervals';
import { computeDayMatches, groupOverlap } from '../../src/lib/matching';
import { EARLY, entry, hours, utc } from './helpers';

const LONDON = 'Europe/London';
const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';
const opts = { selfUid: 'me', nowMs: EARLY };

describe('pairwise matches', () => {
  it('returns the actual intersection for exact hours', () => {
    const mine = entry('me', '2026-10-10', LONDON, hours(['18:00', '22:00']));
    const other = entry('a', '2026-10-10', LONDON, hours(['20:00', '23:00']));
    const [day] = computeDayMatches([mine], [other], opts);
    expect(day.people).toHaveLength(1);
    expect(day.people[0].overlap.status).toBe('confirmed');
    expect(day.people[0].overlap.confirmed).toEqual([{ start: utc('2026-10-10T19:00:00Z'), end: utc('2026-10-10T21:00:00Z') }]);
  });

  it('requires at least 30 minutes of overlap by default', () => {
    const mine = entry('me', '2026-10-10', LONDON, hours(['18:00', '20:00']));
    const twenty = entry('a', '2026-10-10', LONDON, hours(['19:40', '22:00']));
    const thirty = entry('b', '2026-10-10', LONDON, hours(['19:30', '22:00']));
    const [day] = computeDayMatches([mine], [twenty, thirty], opts);
    expect(day.people.map((p) => p.uid)).toEqual(['b']);
  });

  it('matches across time zones using real instants', () => {
    const mine = entry('me', '2026-10-10', LONDON, hours(['18:00', '20:00']));
    const other = entry('a', '2026-10-10', NY, hours(['13:00', '15:00']));
    const [day] = computeDayMatches([mine], [other], opts);
    expect(day.people[0].overlap.confirmed[0].end - day.people[0].overlap.confirmed[0].start).toBe(2 * HOUR_MS);
  });

  it('matches across midnight', () => {
    const mine = entry('me', '2026-10-10', LONDON, hours(['22:00', '02:00']));
    const other = entry('a', '2026-10-11', LONDON, hours(['00:00', '03:00']));
    const [day] = computeDayMatches([mine], [other], opts);
    expect(day.people[0].overlap.status).toBe('confirmed');
    expect(day.people[0].overlap.confirmed).toEqual([{ start: utc('2026-10-10T23:00:00Z'), end: utc('2026-10-11T01:00:00Z') }]);
  });

  it('uses real elapsed time on a daylight-saving day', () => {
    // On 2026-11-01 in New York, 00:00–03:00 lasts four hours (EDT then EST).
    const mine = entry('me', '2026-11-01', NY, hours(['00:00', '03:00']));
    const other = entry('a', '2026-11-01', 'UTC', hours(['06:30', '07:30']));
    const [day] = computeDayMatches([mine], [other], opts);
    expect(day.people[0].overlap.confirmed).toEqual([{ start: utc('2026-11-01T06:30:00Z'), end: utc('2026-11-01T07:30:00Z') }]);
  });

  it('does not treat a flexible day as 24 confirmed hours', () => {
    const mine = entry('me', '2026-10-10', LONDON, hours(['18:00', '20:00']));
    const other = entry('a', '2026-10-10', LONDON, 'flexible');
    const [day] = computeDayMatches([mine], [other], opts);
    const { overlap } = day.people[0];
    expect(overlap.status).toBe('tentative');
    expect(overlap.confirmed).toEqual([]);
    expect(overlap.tentative).toEqual([{ start: utc('2026-10-10T17:00:00Z'), end: utc('2026-10-10T19:00:00Z'), flexible: ['a'] }]);
  });

  it('marks two flexible days as needing confirmation', () => {
    const mine = entry('me', '2026-10-10', LONDON, 'flexible');
    const other = entry('a', '2026-10-10', LONDON, 'flexible');
    const [day] = computeDayMatches([mine], [other], opts);
    expect(day.people[0].overlap.status).toBe('tentative');
    expect(day.people[0].overlap.tentative[0].flexible.sort()).toEqual(['a', 'me']);
  });

  it('compares flexible days in different zones by their real overlap', () => {
    const mine = entry('me', '2026-10-10', NY, 'flexible');
    const sameDate = entry('a', '2026-10-10', TOKYO, 'flexible');
    const laterDate = entry('b', '2026-10-12', TOKYO, 'flexible');
    const [day] = computeDayMatches([mine], [sameDate, laterDate], opts);
    expect(day.people.map((p) => p.uid)).toEqual(['a']);
    // Tokyo's Oct 10 ends at 15:00Z; New York's Oct 10 starts at 04:00Z.
    expect(day.people[0].overlap.tentative[0]).toMatchObject({ start: utc('2026-10-10T04:00:00Z'), end: utc('2026-10-10T15:00:00Z') });
  });

  it('ignores my own entries in the results and time that has already passed', () => {
    const mine = entry('me', '2026-10-10', LONDON, hours(['18:00', '20:00']));
    const other = entry('a', '2026-10-10', LONDON, hours(['18:00', '20:00']));
    const now = utc('2026-10-10T18:45:00Z'); // 19:45 in London
    const [day] = computeDayMatches([mine], [mine, other], { selfUid: 'me', nowMs: now });
    expect(day.people).toEqual([]);
  });

  it('lists confirmed matches before tentative ones', () => {
    const mine = entry('me', '2026-10-10', LONDON, hours(['18:00', '22:00']));
    const flexible = entry('a', '2026-10-10', LONDON, 'flexible');
    const exact = entry('b', '2026-10-10', LONDON, hours(['21:00', '23:00']));
    const [day] = computeDayMatches([mine], [flexible, exact], opts);
    expect(day.people.map((p) => p.uid)).toEqual(['b', 'a']);
  });
});

describe('group overlap', () => {
  const mine = entry('me', '2026-10-10', LONDON, hours(['10:00', '14:00']));

  it('intersects everyone, not just pairs', () => {
    const a = entry('a', '2026-10-10', LONDON, hours(['10:00', '11:00']));
    const b = entry('b', '2026-10-10', LONDON, hours(['12:00', '13:00']));
    const [day] = computeDayMatches([mine], [a, b], opts);
    expect(day.people).toHaveLength(2);
    expect(groupOverlap(day, ['a']).status).toBe('confirmed');
    expect(groupOverlap(day, ['a', 'b']).status).toBe('none');
  });

  it('finds the interval shared by three people', () => {
    const a = entry('a', '2026-10-10', LONDON, hours(['09:00', '12:00']));
    const b = entry('b', '2026-10-10', LONDON, hours(['11:00', '15:00']));
    const [day] = computeDayMatches([mine], [a, b], opts);
    const overlap = groupOverlap(day, ['a', 'b']);
    expect(overlap.status).toBe('confirmed');
    expect(overlap.confirmed).toEqual([{ start: utc('2026-10-10T10:00:00Z'), end: utc('2026-10-10T11:00:00Z') }]);
  });

  it('is tentative when someone in the group is only flexible', () => {
    const a = entry('a', '2026-10-10', LONDON, hours(['11:00', '13:00']));
    const b = entry('b', '2026-10-10', LONDON, 'flexible');
    const [day] = computeDayMatches([mine], [a, b], opts);
    const overlap = groupOverlap(day, ['a', 'b']);
    expect(overlap.status).toBe('tentative');
    expect(overlap.tentative[0]).toMatchObject({ start: utc('2026-10-10T10:00:00Z'), end: utc('2026-10-10T12:00:00Z'), flexible: ['b'] });
  });

  it('applies the 30-minute minimum to the group intersection', () => {
    const a = entry('a', '2026-10-10', LONDON, hours(['10:00', '11:00']));
    const b = entry('b', '2026-10-10', LONDON, hours(['10:40', '12:00']));
    const [day] = computeDayMatches([mine], [a, b], opts);
    expect(groupOverlap(day, ['a', 'b']).status).toBe('none');
  });
});
