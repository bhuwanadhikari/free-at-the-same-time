import { Timestamp, doc, getDoc, serverTimestamp, updateDoc, writeBatch, type DocumentData, type Firestore } from 'firebase/firestore';
import { parseWeeklyRules, type WeeklyRule } from '../lib/slots';
import { DATE_RE } from '../lib/time';
import { cleanName, validateDisplayName } from '../lib/validation';

export interface PublicProfile {
  displayName: string;
}

export interface UserSettings {
  timezone: string;
  publishConsentAt: number | null;
  /** Repeating free times. Private; their dates are published as ordinary entries. */
  weekly: WeeklyRule[];
  /** Last date the weekly repeats were copied onto. */
  weeklyThrough: string | null;
}

export function profileFromData(data: DocumentData | undefined): PublicProfile | null {
  return data && typeof data.displayName === 'string' ? { displayName: data.displayName } : null;
}

export function settingsFromData(data: DocumentData | undefined): UserSettings | null {
  if (!data || typeof data.timezone !== 'string') return null;
  const consent = data.publishConsentAt;
  const through = data.weeklyThrough;
  return {
    timezone: data.timezone,
    publishConsentAt: consent instanceof Timestamp ? consent.toMillis() : null,
    weekly: parseWeeklyRules(data.weekly),
    weeklyThrough: typeof through === 'string' && DATE_RE.test(through) ? through : null,
  };
}

function checkedName(raw: string): string {
  const name = cleanName(raw);
  const error = validateDisplayName(name);
  if (error) throw new Error(error);
  return name;
}

/** First sign-in: public profile and private settings are written together. */
export async function createAccount(db: Firestore, uid: string, input: { displayName: string; timezone: string }): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'profiles', uid), {
    displayName: checkedName(input.displayName),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'settings', uid), {
    timezone: input.timezone,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function updateDisplayName(db: Firestore, uid: string, raw: string): Promise<void> {
  const displayName = checkedName(raw);
  await updateDoc(doc(db, 'profiles', uid), { displayName, updatedAt: serverTimestamp() });
  profileCache.set(uid, Promise.resolve({ displayName }));
}

export async function updateTimezone(db: Firestore, uid: string, timezone: string): Promise<void> {
  await updateDoc(doc(db, 'settings', uid), { timezone, updatedAt: serverTimestamp() });
}

/** Settings fields that record consent, for writing in the same batch as a first publish. */
export const consentFields = (): DocumentData => ({ publishConsentAt: serverTimestamp() });

// ---------- Profile cache (other people's display names) ----------

const profileCache = new Map<string, Promise<PublicProfile | null>>();

export function fetchProfile(db: Firestore, uid: string): Promise<PublicProfile | null> {
  let pending = profileCache.get(uid);
  if (!pending) {
    pending = getDoc(doc(db, 'profiles', uid)).then((snap) => profileFromData(snap.data()));
    pending.catch(() => profileCache.delete(uid));
    profileCache.set(uid, pending);
  }
  return pending;
}

export function clearProfileCache(): void {
  profileCache.clear();
}
