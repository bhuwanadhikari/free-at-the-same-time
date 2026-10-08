import { HOUR_MS, MINUTE_MS, duration, normalize, type Interval } from './intervals';

/** Default minimum shared time for an exact match. */
export const MIN_OVERLAP_MS = 30 * MINUTE_MS;

/**
 * Longest absolute span one availability entry may cover: a (possibly 25h)
 * day plus a range that runs past midnight. Mirrors firestore.rules.
 */
export const MAX_ENTRY_SPAN_MS = 50 * HOUR_MS;

export type AvailabilityKind = 'flexible' | 'hours';

export interface TimeRange {
  /** Wall-clock start in the entry's zone, HH:mm. */
  start: string;
  /** Wall-clock end; at or before `start` means the next day. */
  end: string;
  startMs: number;
  endMs: number;
}

/** One person's published availability for one local calendar date. */
export interface AvailabilityEntry {
  id: string;
  uid: string;
  date: string;
  tz: string;
  kind: AvailabilityKind;
  /** Empty for flexible days. */
  ranges: TimeRange[];
  /** Flexible: local midnight. Hours: earliest range start. */
  startMs: number;
  /** Flexible: next local midnight. Hours: latest range end. */
  endMs: number;
}

/**
 * A stretch of time someone could be free. `flexible` lists the people who
 * only said "free this day — time flexible", so the time still needs confirming.
 */
export interface Window extends Interval {
  flexible: string[];
}

export type OverlapStatus = 'confirmed' | 'tentative' | 'none';

export interface Overlap {
  status: OverlapStatus;
  /** Times everyone gave as exact hours. */
  confirmed: Interval[];
  /** Possible times where at least one person is only flexible. */
  tentative: Window[];
}

export interface PersonMatch {
  uid: string;
  entries: AvailabilityEntry[];
  windows: Window[];
  /** Overlap between this person and the current user. */
  overlap: Overlap;
}

export interface DayMatches {
  mine: AvailabilityEntry;
  myWindows: Window[];
  people: PersonMatch[];
}

export function entryWindows(entry: AvailabilityEntry): Window[] {
  if (entry.kind === 'flexible') return [{ start: entry.startMs, end: entry.endMs, flexible: [entry.uid] }];
  return entry.ranges.map((r) => ({ start: r.startMs, end: r.endMs, flexible: [] }));
}

function union(a: string[], b: string[]): string[] {
  return a.length === 0 ? b : b.length === 0 ? a : [...new Set([...a, ...b])];
}

function intersectWindows(a: readonly Window[], b: readonly Window[]): Window[] {
  const out: Window[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end, flexible: union(x.flexible, y.flexible) });
    }
  }
  return out;
}

/** Merges overlapping windows, combining who is flexible in each. */
function mergeWindows(list: readonly Window[]): Window[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      last.flexible = union(last.flexible, w.flexible);
    } else {
      out.push({ ...w, flexible: [...w.flexible] });
    }
  }
  return out;
}

function clipWindows(list: readonly Window[], fromMs: number): Window[] {
  return list
    .map((w) => ({ ...w, start: Math.max(w.start, fromMs) }))
    .filter((w) => w.end > w.start);
}

/**
 * Time shared by everyone. Pairwise overlaps do not imply a group overlap, so
 * this intersects all participants at once.
 */
export function overlapAcross(windowLists: readonly (readonly Window[])[], minMs = MIN_OVERLAP_MS): Overlap {
  if (windowLists.length === 0) return { status: 'none', confirmed: [], tentative: [] };
  let acc: Window[] = [...windowLists[0]];
  for (const next of windowLists.slice(1)) {
    acc = intersectWindows(acc, next);
    if (acc.length === 0) break;
  }
  const confirmed = normalize(acc.filter((w) => w.flexible.length === 0)).filter((iv) => duration(iv) >= minMs);
  const tentative = mergeWindows(acc.filter((w) => w.flexible.length > 0)).filter((w) => duration(w) >= minMs);
  const status: OverlapStatus = confirmed.length ? 'confirmed' : tentative.length ? 'tentative' : 'none';
  return { status, confirmed, tentative };
}

const statusRank: Record<OverlapStatus, number> = { confirmed: 0, tentative: 1, none: 2 };

function firstStart(o: Overlap): number {
  return (o.confirmed[0] ?? o.tentative[0])?.start ?? Number.POSITIVE_INFINITY;
}

/**
 * Groups other people's entries under each of the current user's upcoming
 * days, keeping only people who share at least `minMs` of possible time.
 * Times before `nowMs` are ignored.
 */
export function computeDayMatches(
  mine: readonly AvailabilityEntry[],
  others: readonly AvailabilityEntry[],
  opts: { selfUid: string; nowMs: number; minMs?: number },
): DayMatches[] {
  const minMs = opts.minMs ?? MIN_OVERLAP_MS;
  const byUser = new Map<string, AvailabilityEntry[]>();
  for (const entry of others) {
    if (entry.uid === opts.selfUid) continue;
    const list = byUser.get(entry.uid);
    if (list) list.push(entry);
    else byUser.set(entry.uid, [entry]);
  }

  return mine
    .filter((m) => m.uid === opts.selfUid && m.endMs > opts.nowMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map((m) => {
      const myWindows = clipWindows(entryWindows(m), opts.nowMs);
      const people: PersonMatch[] = [];
      for (const [uid, entries] of byUser) {
        const relevant = entries.filter((e) => e.startMs < m.endMs && e.endMs > m.startMs);
        if (relevant.length === 0) continue;
        const windows = relevant.flatMap(entryWindows);
        const overlap = overlapAcross([myWindows, windows], minMs);
        if (overlap.status !== 'none') people.push({ uid, entries: relevant, windows, overlap });
      }
      people.sort(
        (a, b) =>
          statusRank[a.overlap.status] - statusRank[b.overlap.status] ||
          firstStart(a.overlap) - firstStart(b.overlap) ||
          a.uid.localeCompare(b.uid),
      );
      return { mine: m, myWindows, people };
    });
}

/** Shared time for the current user plus everyone selected on a day card. */
export function groupOverlap(day: DayMatches, selectedUids: readonly string[], minMs = MIN_OVERLAP_MS): Overlap {
  const lists = [day.myWindows, ...selectedUids.map((uid) => day.people.find((p) => p.uid === uid)?.windows ?? [])];
  return overlapAcross(lists, minMs);
}
