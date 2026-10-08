import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { entryToDoc, matchFeedQuery, myAvailabilityQuery, publishEntries, removeEntries } from '../../src/services/availability';
import { createAccount, updateDisplayName } from '../../src/services/profiles';
import { asAdmin, dbAnon, dbAs, futureDate, makeEntry, setupEnv } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

const profileData = (displayName: string) => ({ displayName, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

describe('profiles and settings', () => {
  it('lets users create and edit only their own profile', async () => {
    await assertSucceeds(createAccount(dbAs(env, 'alice'), 'alice', { displayName: 'Alice', timezone: 'Europe/London' }));
    await assertSucceeds(updateDisplayName(dbAs(env, 'alice'), 'alice', 'Alice B'));
    await assertFails(setDoc(doc(dbAs(env, 'alice'), 'profiles', 'bob'), profileData('Bob')));
    await assertFails(updateDoc(doc(dbAs(env, 'bob'), 'profiles', 'alice'), { displayName: 'Hacked', updatedAt: serverTimestamp() }));
  });

  it('keeps email and other private fields out of public profiles', async () => {
    await assertFails(setDoc(doc(dbAs(env, 'alice'), 'profiles', 'alice'), { ...profileData('Alice'), email: 'a@example.com' }));
  });

  it('rejects blank, overlong and multi-line display names', async () => {
    const db = dbAs(env, 'alice');
    await assertFails(setDoc(doc(db, 'profiles', 'alice'), profileData('   ')));
    await assertFails(setDoc(doc(db, 'profiles', 'alice'), profileData('x'.repeat(41))));
    await assertFails(setDoc(doc(db, 'profiles', 'alice'), profileData('Alice\nAdmin')));
  });

  it('requires server timestamps', async () => {
    const now = Timestamp.now();
    await assertFails(setDoc(doc(dbAs(env, 'alice'), 'profiles', 'alice'), { displayName: 'Alice', createdAt: now, updatedAt: now }));
  });

  it('lets signed-in users fetch a profile by id but not list or read anonymously', async () => {
    await createAccount(dbAs(env, 'alice'), 'alice', { displayName: 'Alice', timezone: 'Europe/London' });
    await assertSucceeds(getDoc(doc(dbAs(env, 'bob'), 'profiles', 'alice')));
    await assertFails(getDocs(query(collection(dbAs(env, 'bob'), 'profiles'), limit(10))));
    await assertFails(getDoc(doc(dbAnon(env), 'profiles', 'alice')));
  });

  it('keeps settings (time zone, consent) private to the owner', async () => {
    await createAccount(dbAs(env, 'alice'), 'alice', { displayName: 'Alice', timezone: 'Europe/London' });
    await assertSucceeds(getDoc(doc(dbAs(env, 'alice'), 'settings', 'alice')));
    await assertFails(getDoc(doc(dbAs(env, 'bob'), 'settings', 'alice')));
  });
});

describe('availability', () => {
  const flexible = { kind: 'flexible' as const, ranges: [] };
  const evening = { kind: 'hours' as const, ranges: [{ start: '18:00', end: '21:00' }] };

  it('lets users publish, edit and remove their own availability', async () => {
    const db = dbAs(env, 'alice');
    await assertSucceeds(publishEntries(db, [makeEntry('alice', flexible)]));
    await assertSucceeds(publishEntries(db, [makeEntry('alice', evening)]));
    await assertSucceeds(publishEntries(db, [makeEntry('alice', { kind: 'hours', ranges: [{ start: '22:00', end: '02:00' }] })]));
    await assertSucceeds(removeEntries(db, 'alice', [futureDate()]));
  });

  it('blocks writing or deleting anyone else’s availability', async () => {
    await publishEntries(dbAs(env, 'alice'), [makeEntry('alice', evening)]);
    const bob = dbAs(env, 'bob');
    await assertFails(publishEntries(bob, [makeEntry('alice', flexible)]));
    await assertFails(removeEntries(bob, 'alice', [futureDate()]));
    // Bob's own data stored under Alice's document id.
    const forged = { ...makeEntry('bob', flexible), id: `alice_${futureDate()}` };
    await assertFails(publishEntries(bob, [forged]));
  });

  it('lets signed-in users discover published availability through bounded queries', async () => {
    await publishEntries(dbAs(env, 'alice'), [makeEntry('alice', evening)]);
    const bob = dbAs(env, 'bob');
    const from = Date.now();
    const to = from + 20 * 86_400_000;
    await assertSucceeds(getDocs(matchFeedQuery(bob, from, to, 50)));
    await assertSucceeds(getDoc(doc(bob, 'availability', `alice_${futureDate()}`)));
    await assertFails(getDocs(query(collection(bob, 'availability'), where('published', '==', true))));
    await assertFails(getDocs(query(collection(bob, 'availability'), where('published', '==', true), limit(500))));
    await assertFails(getDocs(query(collection(dbAnon(env), 'availability'), where('published', '==', true), limit(10))));
  });

  it('hides unpublished entries from everyone except the owner', async () => {
    const entry = makeEntry('alice', evening);
    await asAdmin(env, (db) => setDoc(doc(db, 'availability', entry.id), { ...entryToDoc(entry), published: false }));
    await assertFails(getDoc(doc(dbAs(env, 'bob'), 'availability', entry.id)));
    await assertFails(getDocs(query(collection(dbAs(env, 'bob'), 'availability'), limit(10))));
    await assertSucceeds(getDoc(doc(dbAs(env, 'alice'), 'availability', entry.id)));
    await assertSucceeds(getDocs(myAvailabilityQuery(dbAs(env, 'alice'), 'alice', Date.now())));
  });

  it('rejects malformed availability', async () => {
    const db = dbAs(env, 'alice');
    const good = entryToDoc(makeEntry('alice', evening));
    const ref = doc(db, 'availability', `alice_${futureDate()}`);
    await assertFails(setDoc(ref, { ...good, kind: 'hours', ranges: [] }));
    await assertFails(setDoc(ref, { ...good, kind: 'flexible' }));
    await assertFails(setDoc(ref, { ...good, kind: 'weekly' }));
    await assertFails(setDoc(ref, { ...good, email: 'a@example.com' }));
    await assertFails(setDoc(ref, { ...good, ranges: Array(5).fill(good.ranges[0]) }));
    await assertFails(setDoc(ref, { ...good, ranges: [{ ...good.ranges[0], start: '25:00' }] }));
    await assertFails(setDoc(ref, { ...good, endAt: good.startAt }));
  });

  it('rejects availability that has already ended or is too far ahead', async () => {
    const db = dbAs(env, 'alice');
    await assertFails(publishEntries(db, [makeEntry('alice', flexible, futureDate(-3))]));
    await assertFails(publishEntries(db, [makeEntry('alice', flexible, futureDate(120))]));
  });
});
