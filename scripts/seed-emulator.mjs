// Seeds the LOCAL Firestore emulator with demo people and availability.
//   node scripts/seed-emulator.mjs [timezone]
//   node scripts/seed-emulator.mjs --say <groupId> <text>   (post as a demo member)
// Never point this at production: it only talks to the emulator.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { DateTime } from 'luxon';

const env = await initializeTestEnvironment({
  projectId: 'demo-freeatthesametime',
  firestore: { host: '127.0.0.1', port: 8080 },
});

async function asAdmin(fn) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

if (process.argv[2] === '--say') {
  const [, , , groupId, ...words] = process.argv;
  await asAdmin(async (db) => {
    const group = await getDoc(doc(db, 'groups', groupId));
    const sender = group.get('memberIds').find((id) => id.startsWith('demo-'));
    if (!sender) throw new Error('No demo member in that group');
    await setDoc(doc(collection(db, 'groups', groupId, 'messages')), { senderId: sender, text: words.join(' '), createdAt: serverTimestamp() });
    await updateDoc(doc(db, 'groups', groupId), { lastMessageAt: serverTimestamp() });
    console.log(`Posted as ${sender}`);
  });
  process.exit(0);
}

const tz = process.argv[2] || 'UTC';
const today = DateTime.now().setZone(tz).startOf('day');
const date = (offset) => today.plus({ days: offset }).toISODate();
// Two hours ahead of `tz`, for someone in another time zone.
const aheadMinutes = today.offset + 120;
const away = `UTC${aheadMinutes < 0 ? '-' : '+'}${Math.floor(Math.abs(aheadMinutes) / 60)}:${String(Math.abs(aheadMinutes) % 60).padStart(2, '0')}`;

function entry(uid, offset, kind, ranges = [], zone = tz) {
  const d = date(offset);
  const dayStart = DateTime.fromISO(d, { zone }).startOf('day');
  const resolved = ranges.map(([start, end]) => {
    const s = DateTime.fromISO(`${d}T${start}`, { zone });
    let e = DateTime.fromISO(`${d}T${end}`, { zone });
    if (end <= start) e = e.plus({ days: 1 });
    return { start, end, startAt: Timestamp.fromMillis(s.toMillis()), endAt: Timestamp.fromMillis(e.toMillis()) };
  });
  const startAt = kind === 'flexible' ? Timestamp.fromMillis(dayStart.toMillis()) : resolved[0].startAt;
  const endAt =
    kind === 'flexible'
      ? Timestamp.fromMillis(dayStart.plus({ days: 1 }).toMillis())
      : resolved.reduce((a, r) => (r.endAt.toMillis() > a.toMillis() ? r.endAt : a), resolved[0].endAt);
  return [`${uid}_${d}`, { uid, date: d, tz: zone, kind, ranges: resolved, startAt, endAt, published: true, updatedAt: serverTimestamp() }];
}

const people = [
  ['demo-maya', 'Maya Lin', [entry('demo-maya', 0, 'hours', [['18:00', '21:00']]), entry('demo-maya', 1, 'flexible'), entry('demo-maya', 3, 'hours', [['10:00', '13:00']])]],
  ['demo-jon', 'Jon Park', [entry('demo-jon', 0, 'hours', [['17:00', '20:00']]), entry('demo-jon', 1, 'hours', [['18:00', '21:00']]), entry('demo-jon', 2, 'flexible')]],
  ['demo-sara', 'Sara Rao', [entry('demo-sara', 1, 'hours', [['19:00', '23:30']]), entry('demo-sara', 4, 'hours', [['09:00', '12:00']])]],
  ['demo-ali', 'Ali Khan', [entry('demo-ali', 1, 'hours', [['12:00', '14:00']]), entry('demo-ali', 3, 'hours', [['11:00', '15:00']])]],
  ['demo-lena', 'Lena Ortiz', [entry('demo-lena', 2, 'hours', [['20:00', '01:00']]), entry('demo-lena', 4, 'hours', [['18:00', '22:00']])]],
  ['demo-kai', 'Kai Weber', [1, 2, 3].map((d) => entry('demo-kai', d, 'hours', [['08:00', '10:00'], ['15:00', '18:00']]))],
  // 7–11 PM in a zone two hours ahead: 5–9 PM for you, shown blurred on Matches.
  ['demo-nora', 'Nora Berg', [0, 1, 2].map((d) => entry('demo-nora', d, 'hours', [['19:00', '23:00']], away))],
];

await asAdmin(async (db) => {
  for (const [uid, displayName, entries] of people) {
    await setDoc(doc(db, 'profiles', uid), { displayName, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    for (const [id, data] of entries) await setDoc(doc(db, 'availability', id), data);
  }
});
console.log(`Seeded ${people.length} demo people in ${tz} for ${date(0)} – ${date(4)}.`);
await env.cleanup();
