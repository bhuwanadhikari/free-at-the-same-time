import {
  Timestamp,
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { availabilityDocId } from '../lib/availability';
import type { AvailabilityEntry, TimeRange } from '../lib/matching';

/** Enough for every day in the 12-week planning horizon. */
export const MY_AVAILABILITY_LIMIT = 120;
export const MATCH_PAGE_SIZE = 50;
export const MATCH_MAX_LIMIT = 300;

const col = (db: Firestore) => collection(db, 'availability');

export function entryToDoc(entry: AvailabilityEntry): DocumentData {
  return {
    uid: entry.uid,
    date: entry.date,
    tz: entry.tz,
    kind: entry.kind,
    ranges: entry.ranges.map((r) => ({
      start: r.start,
      end: r.end,
      startAt: Timestamp.fromMillis(r.startMs),
      endAt: Timestamp.fromMillis(r.endMs),
    })),
    startAt: Timestamp.fromMillis(entry.startMs),
    endAt: Timestamp.fromMillis(entry.endMs),
    published: true,
    updatedAt: serverTimestamp(),
  };
}

const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null);

/** Defensive parse: entries from other users are untrusted input. */
export function entryFromData(id: string, data: DocumentData): AvailabilityEntry | null {
  const startMs = ms(data.startAt);
  const endMs = ms(data.endAt);
  if (typeof data.uid !== 'string' || typeof data.date !== 'string' || typeof data.tz !== 'string') return null;
  if (data.kind !== 'flexible' && data.kind !== 'hours') return null;
  if (startMs === null || endMs === null || !Array.isArray(data.ranges)) return null;
  const ranges: TimeRange[] = [];
  for (const r of data.ranges as DocumentData[]) {
    const rs = ms(r?.startAt);
    const re = ms(r?.endAt);
    if (typeof r?.start !== 'string' || typeof r?.end !== 'string' || rs === null || re === null) return null;
    ranges.push({ start: r.start, end: r.end, startMs: rs, endMs: re });
  }
  return { id, uid: data.uid, date: data.date, tz: data.tz, kind: data.kind, ranges, startMs, endMs };
}

/** Publishes (creates or replaces) entries. Only ever called from an explicit user action. */
export async function publishEntries(db: Firestore, entries: readonly AvailabilityEntry[]): Promise<void> {
  const batch = writeBatch(db);
  for (const entry of entries) batch.set(doc(col(db), entry.id), entryToDoc(entry));
  await batch.commit();
}

export interface DayWrite {
  date: string;
  /** null deletes the day's document. */
  entry: AvailabilityEntry | null;
}

/**
 * Writes several days, plus optional settings fields, in one atomic batch.
 * Only delete days that exist: the rules can't authorize deleting a missing doc.
 */
export async function writeDays(db: Firestore, uid: string, days: readonly DayWrite[], settings?: DocumentData): Promise<void> {
  const batch = writeBatch(db);
  for (const { date, entry } of days) {
    const ref = doc(col(db), availabilityDocId(uid, date));
    if (entry) batch.set(ref, entryToDoc(entry));
    else batch.delete(ref);
  }
  if (settings) batch.update(doc(db, 'settings', uid), { ...settings, updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function removeEntries(db: Firestore, uid: string, dates: readonly string[]): Promise<void> {
  const batch = writeBatch(db);
  for (const date of dates) batch.delete(doc(col(db), availabilityDocId(uid, date)));
  await batch.commit();
}

/** The signed-in user's own entries that haven't ended yet. */
export function myAvailabilityQuery(db: Firestore, uid: string, fromMs: number): Query {
  return query(
    col(db),
    where('uid', '==', uid),
    where('endAt', '>', Timestamp.fromMillis(fromMs)),
    orderBy('endAt'),
    limit(MY_AVAILABILITY_LIMIT),
  );
}

/**
 * Published entries ending inside (fromMs, toMs], soonest first. Bounded by
 * date and by `limitN`, so it never downloads everyone's history.
 */
export function matchFeedQuery(db: Firestore, fromMs: number, toMs: number, limitN: number): Query {
  return query(
    col(db),
    where('published', '==', true),
    where('endAt', '>', Timestamp.fromMillis(fromMs)),
    where('endAt', '<=', Timestamp.fromMillis(toMs)),
    orderBy('endAt'),
    limit(Math.min(limitN, MATCH_MAX_LIMIT)),
  );
}
