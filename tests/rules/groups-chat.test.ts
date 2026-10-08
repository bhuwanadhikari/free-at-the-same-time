import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGroup, leaveGroup, myGroupsQuery, newGroupId } from '../../src/services/groups';
import { latestMessagesQuery, newMessageId, sendMessage } from '../../src/services/messages';
import { dbAs, seedProfiles, setupEnv } from './env';

let env: RulesTestEnvironment;
const PEOPLE = ['alice', 'bob', 'carol', 'dan', 'erin', 'frank', 'gina', 'hal', 'ivy', 'jo', 'kim'];

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedProfiles(env, PEOPLE);
});

const rawGroup = (creator: string, memberIds: string[], extra: Record<string, unknown> = {}) => ({
  name: 'Saturday plans',
  createdBy: creator,
  memberIds,
  originalMemberIds: memberIds,
  createdAt: serverTimestamp(),
  lastMessageAt: serverTimestamp(),
  ...extra,
});

async function makeGroup(creator = 'alice', others = ['bob', 'carol']): Promise<string> {
  const db = dbAs(env, creator);
  const groupId = newGroupId(db);
  await createGroup(db, { groupId, creatorUid: creator, name: 'Saturday plans', memberIds: others });
  return groupId;
}

async function send(db: Firestore, uid: string, groupId: string, text: string) {
  return sendMessage(db, { groupId, messageId: newMessageId(db, groupId), uid, text });
}

describe('group creation', () => {
  it('adds every selected person as an active member immediately', async () => {
    const groupId = await makeGroup();
    for (const uid of ['alice', 'bob', 'carol']) {
      await assertSucceeds(getDoc(doc(dbAs(env, uid), 'groups', groupId)));
      const chats = await getDocs(myGroupsQuery(dbAs(env, uid), uid, 30));
      expect(chats.docs.map((d) => d.id)).toContain(groupId);
    }
    await assertSucceeds(send(dbAs(env, 'bob'), 'bob', groupId, 'Hi! I can do 7pm.'));
  });

  it('allows separate groups with identical members', async () => {
    const first = await makeGroup();
    const second = await makeGroup();
    expect(first).not.toBe(second);
    const chats = await getDocs(myGroupsQuery(dbAs(env, 'bob'), 'bob', 30));
    expect(chats.size).toBe(2);
  });

  it('treats repeated taps with the same id as one group', async () => {
    const db = dbAs(env, 'alice');
    const groupId = newGroupId(db);
    const input = { groupId, creatorUid: 'alice', name: 'Plans', memberIds: ['bob'] };
    await Promise.all([createGroup(db, input), createGroup(db, input)]);
    // A later retry after the group exists also resolves instead of duplicating.
    await assertSucceeds(createGroup(db, input));
    const chats = await getDocs(myGroupsQuery(dbAs(env, 'bob'), 'bob', 30));
    expect(chats.size).toBe(1);
  });

  it('allows up to 10 people including the creator', async () => {
    const db = dbAs(env, 'alice');
    const ten = PEOPLE.slice(0, 10);
    const eleven = PEOPLE.slice(0, 11);
    await assertSucceeds(setDoc(doc(db, 'groups', 'ten'), rawGroup('alice', ten)));
    await assertFails(setDoc(doc(db, 'groups', 'eleven'), rawGroup('alice', eleven)));
  });

  it('rejects invalid membership', async () => {
    const db = dbAs(env, 'alice');
    const ref = () => doc(collection(db, 'groups'));
    await assertFails(setDoc(ref(), rawGroup('alice', ['bob', 'carol']))); // creator missing
    await assertFails(setDoc(ref(), rawGroup('alice', ['alice']))); // nobody else
    await assertFails(setDoc(ref(), rawGroup('alice', ['alice', 'bob', 'bob']))); // duplicate
    await assertFails(setDoc(ref(), rawGroup('alice', ['alice', 'ghost']))); // no such user
    await assertFails(setDoc(ref(), rawGroup('alice', ['alice', 'bob/x']))); // not a user id
    await assertFails(setDoc(ref(), rawGroup('bob', ['alice', 'bob']))); // creator spoofed
    await assertFails(setDoc(ref(), { ...rawGroup('alice', ['alice', 'bob']), originalMemberIds: ['alice', 'bob', 'carol'] }));
  });

  it('rejects malformed group documents', async () => {
    const db = dbAs(env, 'alice');
    const ref = () => doc(collection(db, 'groups'));
    const members = ['alice', 'bob'];
    await assertFails(setDoc(ref(), rawGroup('alice', members, { name: '' })));
    await assertFails(setDoc(ref(), rawGroup('alice', members, { name: 'x'.repeat(61) })));
    await assertFails(setDoc(ref(), rawGroup('alice', members, { createdAt: Timestamp.now() })));
    await assertFails(setDoc(ref(), rawGroup('alice', members, { admins: ['alice'] })));
    await assertFails(setDoc(ref(), rawGroup('alice', members, { pendingInvites: ['carol'] })));
  });

  it('keeps groups private to members and blocks changes after creation', async () => {
    const groupId = await makeGroup();
    const ref = (uid: string) => doc(dbAs(env, uid), 'groups', groupId);
    await assertFails(getDoc(ref('dan')));
    await assertFails(updateDoc(ref('alice'), { memberIds: arrayUnion('dan') }));
    await assertFails(updateDoc(ref('alice'), { memberIds: arrayUnion('dan'), originalMemberIds: arrayUnion('dan') }));
    await assertFails(updateDoc(ref('bob'), { name: 'Renamed' }));
    await assertFails(updateDoc(ref('alice'), { createdBy: 'bob' }));
    await assertFails(deleteDoc(ref('alice')));
  });
});

describe('messaging', () => {
  it('lets members send and read messages', async () => {
    const groupId = await makeGroup();
    await assertSucceeds(send(dbAs(env, 'alice'), 'alice', groupId, 'Free at 7?'));
    await assertSucceeds(send(dbAs(env, 'bob'), 'bob', groupId, 'Yes! https://chat.whatsapp.com/abc'));
    const snap = await getDocs(latestMessagesQuery(dbAs(env, 'carol'), groupId));
    expect(snap.docs.map((d) => d.get('text'))).toEqual(['Yes! https://chat.whatsapp.com/abc', 'Free at 7?']);
  });

  it('blocks non-members from reading or sending', async () => {
    const groupId = await makeGroup();
    await send(dbAs(env, 'alice'), 'alice', groupId, 'hello');
    await assertFails(getDocs(latestMessagesQuery(dbAs(env, 'dan'), groupId)));
    await assertFails(send(dbAs(env, 'dan'), 'dan', groupId, 'let me in'));
  });

  it('requires the sender to be the signed-in user', async () => {
    const groupId = await makeGroup();
    await assertFails(send(dbAs(env, 'bob'), 'alice', groupId, 'pretending to be Alice'));
  });

  it('validates message fields', async () => {
    const groupId = await makeGroup();
    const db = dbAs(env, 'bob');
    const ref = () => doc(collection(db, 'groups', groupId, 'messages'));
    const ok = { senderId: 'bob', text: 'hi', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(ref(), ok));
    await assertFails(setDoc(ref(), { ...ok, text: '   ' }));
    await assertFails(setDoc(ref(), { ...ok, text: 'x'.repeat(2001) }));
    await assertFails(setDoc(ref(), { ...ok, createdAt: Timestamp.fromMillis(0) }));
    await assertFails(setDoc(ref(), { ...ok, imageUrl: 'https://example.com/a.png' }));
  });

  it('keeps messages immutable', async () => {
    const groupId = await makeGroup();
    const db = dbAs(env, 'bob');
    const messageId = newMessageId(db, groupId);
    await sendMessage(db, { groupId, messageId, uid: 'bob', text: 'original' });
    const ref = doc(db, 'groups', groupId, 'messages', messageId);
    await assertFails(updateDoc(ref, { text: 'edited' }));
    await assertFails(deleteDoc(ref));
  });

  it('retries without creating duplicates', async () => {
    const groupId = await makeGroup();
    const db = dbAs(env, 'bob');
    const messageId = newMessageId(db, groupId);
    expect(await sendMessage(db, { groupId, messageId, uid: 'bob', text: 'once' })).toBe('sent');
    expect(await sendMessage(db, { groupId, messageId, uid: 'bob', text: 'once' })).toBe('already-sent');
    const snap = await getDocs(latestMessagesQuery(db, groupId));
    expect(snap.size).toBe(1);
  });

  it('only lets members bump the activity timestamp', async () => {
    const groupId = await makeGroup();
    await assertSucceeds(updateDoc(doc(dbAs(env, 'carol'), 'groups', groupId), { lastMessageAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(dbAs(env, 'carol'), 'groups', groupId), { lastMessageAt: Timestamp.fromMillis(0) }));
    await assertFails(updateDoc(doc(dbAs(env, 'dan'), 'groups', groupId), { lastMessageAt: serverTimestamp() }));
  });
});

describe('leaving', () => {
  it('revokes access for the person who left and keeps their messages for others', async () => {
    const groupId = await makeGroup();
    await send(dbAs(env, 'bob'), 'bob', groupId, 'Count me in');
    await assertSucceeds(leaveGroup(dbAs(env, 'bob'), groupId, 'bob'));

    await assertFails(getDoc(doc(dbAs(env, 'bob'), 'groups', groupId)));
    await assertFails(getDocs(latestMessagesQuery(dbAs(env, 'bob'), groupId)));
    await assertFails(send(dbAs(env, 'bob'), 'bob', groupId, 'still here?'));
    const bobChats = await getDocs(myGroupsQuery(dbAs(env, 'bob'), 'bob', 30));
    expect(bobChats.size).toBe(0);

    const remaining = await getDocs(latestMessagesQuery(dbAs(env, 'alice'), groupId));
    expect(remaining.docs.map((d) => d.get('text'))).toEqual(['Count me in']);
    const group = await getDoc(doc(dbAs(env, 'alice'), 'groups', groupId));
    expect(group.get('memberIds')).toEqual(['alice', 'carol']);
  });

  it('lets the creator leave too', async () => {
    const groupId = await makeGroup();
    await assertSucceeds(leaveGroup(dbAs(env, 'alice'), groupId, 'alice'));
    await assertSucceeds(send(dbAs(env, 'bob'), 'bob', groupId, 'Still on for Saturday'));
  });

  it('only lets members remove themselves, without touching other fields', async () => {
    const groupId = await makeGroup();
    const ref = (uid: string) => doc(dbAs(env, uid), 'groups', groupId);
    await assertFails(updateDoc(ref('alice'), { memberIds: ['alice', 'carol'] })); // removing Bob
    await assertFails(updateDoc(ref('bob'), { memberIds: ['alice', 'carol'], name: 'Bye' }));
    await assertFails(updateDoc(ref('bob'), { memberIds: ['alice', 'carol'], lastMessageAt: serverTimestamp() }));
    await assertFails(updateDoc(ref('bob'), { memberIds: ['alice', 'carol', 'dan'] })); // swap in someone new
    await assertFails(updateDoc(ref('bob'), { memberIds: ['alice', 'alice'] })); // shrink via duplicates
    await assertFails(updateDoc(ref('dan'), { memberIds: ['alice', 'bob', 'carol'] })); // outsider
  });

  it('never restores membership after leaving', async () => {
    const groupId = await makeGroup();
    await leaveGroup(dbAs(env, 'bob'), groupId, 'bob');
    await assertFails(updateDoc(doc(dbAs(env, 'bob'), 'groups', groupId), { memberIds: arrayUnion('bob') }));
    await assertFails(updateDoc(doc(dbAs(env, 'alice'), 'groups', groupId), { memberIds: arrayUnion('bob') }));
  });
});
