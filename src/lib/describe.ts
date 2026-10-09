import type { Interval } from './intervals';
import { formatInterval } from './time';

const coversDay = (w: Interval, day: Interval) => w.start <= day.start && w.end >= day.end;

export function describeWindows(windows: readonly Interval[], tz: string, anchorDate: string, day?: Interval): string {
  if (day && windows.length === 1 && coversDay(windows[0], day)) return 'Any time this day';
  return windows.map((w) => formatInterval(w, tz, anchorDate)).join(', ');
}
