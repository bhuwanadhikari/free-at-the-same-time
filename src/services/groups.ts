import {
  Timestamp,
  arrayRemove,
  collection,
  doc,
  getDoc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { buildMemberList, cleanName, validateGroupName } from '../lib/validation';

export const GROUPS_PAGE_SIZE = 30;

export interface Group {
  id: string;
  name: string;
  createdBy: string;
  /** Active members. */
  memberIds: string[];
  /** Everyone added at creation; used to show names on messages from people who left. */
  originalMemberIds: string[];
  createdAtMs: number;
  lastMessageAtMs: number;
}

export function groupFromSnap(snap: DocumentSnapshot): Group | null {
  const data = snap.data({ serverTimestamps: 'estimate' });
  if (!data || typeof data.name !== 'string' || !Array.isArray(data.memberIds)) return null;
  const toMs = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : Date.now());
  return {
    id: snap.id,
    name: data.name,
    createdBy: String(data.createdBy ?? ''),
    memberIds: data.memberIds.filter((m: unknown): m is string => typeof m === 'string'),
    originalMemberIds: Array.isArray(data.originalMemberIds) ? data.originalMemberIds.filter((m: unknown): m is string => typeof m === 'string') : [],
    createdAtMs: toMs(data.createdAt),
    lastMessageAtMs: toMs(data.lastMessageAt),
  };
}

/** Generate once per "create chat" sheet; reusing it makes repeated taps idempotent. */
export function newGroupId(db: Firestore): string {
  return doc(collection(db, 'groups')).id;
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Creates the group and its full membership in one document write, so every
 * member is active immediately. Repeated calls with the same id share one
 * request; a retry after an ambiguous failure succeeds if the group exists.
 */
export function createGroup(
  db: Firestore,
  input: { groupId: string; creatorUid: string; name: string; memberIds: readonly string[] },
): Promise<void> {
  const pending = inFlight.get(input.groupId);
  if (pending) return pending;

  const run = async () => {
    const memberIds = buildMemberList(input.creatorUid, input.memberIds);
    const name = cleanName(input.name);
    const nameError = validateGroupName(name);
    if (nameError) throw new Error(nameError);

    const ref = doc(db, 'groups', input.groupId);
    try {
      await setDoc(ref, {
        name,
        createdBy: input.creatorUid,
        memberIds,
        originalMemberIds: memberIds,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      });
    } catch (err) {
      // If an earlier attempt actually landed, the rewrite is rejected as an update.
      const existing = await getDoc(ref).catch(() => null);
      if (existing?.exists() && existing.get('createdBy') === input.creatorUid) return;
      throw err;
    }
  };

  const promise = run();
  inFlight.set(input.groupId, promise);
  const clear = () => inFlight.delete(input.groupId);
  promise.then(clear, clear);
  return promise;
}

/** Removes only the caller. Their earlier messages stay for remaining members. */
export async function leaveGroup(db: Firestore, groupId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId), { memberIds: arrayRemove(uid) });
}

export function myGroupsQuery(db: Firestore, uid: string, limitN: number): Query {
  return query(
    collection(db, 'groups'),
    where('memberIds', 'array-contains', uid),
    orderBy('lastMessageAt', 'desc'),
    limit(limitN),
  );
}
