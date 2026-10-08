import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { buildEntry, type DayDraft } from '../../src/lib/availability';
import type { AvailabilityEntry } from '../../src/lib/matching';
import { addDays, todayIn } from '../../src/lib/time';

export const PROJECT_ID = 'demo-freeatthesametime';

export function setupEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
}

/** Firestore as a signed-in user, with security rules enforced. */
export const dbAs = (env: RulesTestEnvironment, uid: string): Firestore =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;

export const dbAnon = (env: RulesTestEnvironment): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;

export async function asAdmin(env: RulesTestEnvironment, fn: (db: Firestore) => Promise<unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

export async function seedProfiles(env: RulesTestEnvironment, uids: readonly string[]): Promise<void> {
  await asAdmin(env, async (db) => {
    for (const uid of uids) {
      await setDoc(doc(db, 'profiles', uid), { displayName: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  });
}

/** A date a few days from now, so rules see it as upcoming. */
export const futureDate = (days = 5): string => addDays(todayIn('UTC'), days);

export function makeEntry(uid: string, draft: DayDraft, date = futureDate()): AvailabilityEntry {
  const res = buildEntry(uid, date, 'Europe/London', draft);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}
