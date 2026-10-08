import { crossesMidnight } from './availability';
import type { Interval } from './intervals';
import type { AvailabilityEntry, Overlap, Window } from './matching';
import { formatInterval, formatWallTime } from './time';

export const FLEXIBLE_LABEL = 'Free this day — time flexible';

/** The owner's own view, in the wall-clock times they entered. */
export function describeEntry(entry: AvailabilityEntry): string {
  if (entry.kind === 'flexible') return FLEXIBLE_LABEL;
  return entry.ranges
    .map((r) => `${formatWallTime(r.start)} – ${formatWallTime(r.end)}${crossesMidnight(r) ? ' (next day)' : ''}`)
    .join(', ');
}

const coversDay = (w: Interval, day: Interval) => w.start <= day.start && w.end >= day.end;

export function describeWindows(windows: readonly Interval[], tz: string, anchorDate: string, day?: Interval): string {
  if (day && windows.length === 1 && coversDay(windows[0], day)) return 'Any time this day';
  return windows.map((w) => formatInterval(w, tz, anchorDate)).join(', ');
}

export interface OverlapText {
  tone: 'confirmed' | 'tentative' | 'none';
  badge: string;
  detail: string;
}

/** How one person lines up with me on a day card. */
export function describePersonOverlap(overlap: Overlap, opts: { selfUid: string; otherUid: string; tz: string; anchorDate: string; myDay: Interval }): OverlapText {
  if (overlap.status === 'confirmed') {
    return { tone: 'confirmed', badge: 'Shared hours', detail: describeWindows(overlap.confirmed, opts.tz, opts.anchorDate) };
  }
  if (overlap.status === 'none') return { tone: 'none', badge: 'No overlap', detail: '' };
  const flexible = new Set(overlap.tentative.flatMap((w: Window) => w.flexible));
  const theyAreFlexible = flexible.has(opts.otherUid);
  const iAmFlexible = flexible.has(opts.selfUid);
  const when = describeWindows(overlap.tentative, opts.tz, opts.anchorDate, opts.myDay);
  if (theyAreFlexible && iAmFlexible) return { tone: 'tentative', badge: 'Both flexible', detail: `${when} · pick a time together` };
  if (theyAreFlexible) return { tone: 'tentative', badge: 'They’re flexible', detail: `Confirm a time within ${when}` };
  return { tone: 'tentative', badge: 'Needs a time', detail: `They’re free ${when} · you’re flexible` };
}
