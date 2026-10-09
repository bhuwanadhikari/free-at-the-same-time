# freeatthesametime.com

A mobile-first PWA for finding people who are free at the same time and starting a plain-text group chat to make plans.

**Core journey:** Google sign-in → tap or drag your free hours → see who shares them on the Matches timeline → pick people and hours → open a group chat (everyone joins immediately) → send text → leave when you want.

- React 19 + TypeScript + Vite 8, installable PWA (vite-plugin-pwa / Workbox)
- Firebase Authentication (Google only) and Cloud Firestore (data + realtime chat)
- Firestore Security Rules are the only authorization layer: no backend, no Cloud Functions
- Runs on Firebase's free **Spark** plan; hosting on Firebase Hosting's provided domain

---

## 1. Local development (no Firebase project needed)

Prerequisites: Node 20+, the Firebase CLI (`npm i -g firebase-tools`), and **Java 21+** for the emulators (`brew install openjdk@21`, then put `/opt/homebrew/opt/openjdk@21/bin` first on your `PATH`).

```bash
npm install
npm run emulators                         # terminal 1: Auth + Firestore emulators (UI at http://localhost:4000)
npm run dev:emu                           # terminal 2: app at http://localhost:5173, wired to the emulators
node scripts/seed-emulator.mjs Europe/Berlin   # optional: 5 demo people with availability tomorrow+
```

“Continue with Google” opens the Auth emulator's fake account page — no real Google account is used. `.env.emulator` holds the demo config and contains no secrets.

To post a chat message as a demo member (handy for checking realtime updates):
`node scripts/seed-emulator.mjs --say <groupId> "See you at 7!"`

### Testing on a real Android phone

Faster and more realistic than an Android emulator:

```bash
adb reverse tcp:5173 tcp:5173 && adb reverse tcp:9099 tcp:9099 && adb reverse tcp:8080 tcp:8080
adb shell am start -a android.intent.action.VIEW -d http://localhost:5173 -p com.android.chrome
scrcpy                                    # mirror and control the phone from your computer
```

`localhost` counts as a secure context on the phone, so service workers and sign-in behave as they do in production.

## 2. Tests

```bash
npm test              # unit tests: interval math, DST/midnight handling, matching, group overlap, links, validation
npm run test:rules    # Security Rules + service tests on the Firestore emulator (needs Java 21)
npm run typecheck
```

`tests/rules/` covers profiles, availability, **group creation**, **messaging** (including idempotent retries) and **leaving** (access revoked, messages kept, no re-adding) against the real `firestore.rules`.

## 3. Deploying to Firebase (Spark / free plan)

1. **Create a project** in the [Firebase console](https://console.firebase.google.com) (or `firebase projects:create <id>`). Don't enable billing.
2. **Register a web app**: Project settings → Your apps → Web. Copy the config into `.env.local` (based on `.env.example`):
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=<project-id>
   VITE_FIREBASE_APP_ID=...
   VITE_USE_EMULATORS=false
   ```
   CLI alternative: `firebase apps:create web freeatthesametime --project <id>` then `firebase apps:sdkconfig web --project <id>`.
3. **Enable Google sign-in**: Authentication → Get started → Sign-in method → Google → Enable → choose a support email → Save.
4. **Create Firestore**: Firestore Database → Create database → *Production mode* → location (this project uses **eur3**; it can't be changed later). CLI alternative: `firebase firestore:databases:create "(default)" --location=eur3 --project <id>`.
5. **Point the CLI at the project and hosting site**. `firebase.json` deploys to the hosting target `app`:
   ```bash
   firebase use --add <project-id>                 # writes .firebaserc
   firebase target:apply hosting app <site-id>     # <site-id> = <project-id> for the default site,
                                                   # or one made with `firebase hosting:sites:create <name>`
   ```
6. **Make sign-in first-party**: set `VITE_FIREBASE_AUTH_DOMAIN=<site-id>.web.app` (the domain the app is served from), then:
   - Authentication → Settings → Authorized domains: make sure `<site-id>.web.app` is listed.
   - Google Cloud Console → APIs & Services → Credentials → *Web client (auto created by Google Service)* → Authorized redirect URIs: add `https://<site-id>.web.app/__/auth/handler`.

   Installed PWAs always sign in with a redirect. Chrome, Safari and Firefox block that redirect when `authDomain` is on a different domain from the app, so this step matters.
7. **Deploy** hosting, rules and indexes:
   ```bash
   npm run deploy      # = typecheck + build + firebase deploy --only hosting,firestore
   ```
   Indexes take a few minutes to build. Until they're ready, Matches and Chats show a “database is still being set up” message.
8. Open `https://<site-id>.web.app`. For a custom domain later, add it under Authentication → Settings → Authorized domains and as a redirect URI as in step 6, and use it as `authDomain`.

**Sign-in note:** in a normal browser tab the app signs in with a popup and falls back to a redirect if the popup is blocked.

### Installing the app
- **Android / Chrome / Edge:** your avatar (top right) → *Install*, or browser menu → *Install app*.
- **iPhone / iPad:** in Safari or Chrome, Share → *Add to Home Screen* (in Safari on iOS 26, Share is under the ⋯ menu).
- **Desktop Chrome/Edge:** the install icon in the address bar.

---

## 4. Data model (Cloud Firestore)

| Path | Who can read | Who can write | Fields |
|---|---|---|---|
| `profiles/{uid}` | any signed-in user, **by id only** (no listing) | owner | `displayName` (1–40 chars, single line), `createdAt`, `updatedAt` |
| `settings/{uid}` | owner | owner | `timezone`, `publishConsentAt?`, `weekly?` (≤ 28 repeats), `weeklyThrough?`, `createdAt`, `updatedAt` |
| `availability/{uid}_{YYYY-MM-DD}` | any signed-in user if `published == true`; owner always | owner | see below |
| `groups/{groupId}` | active members | create: anyone (validated); update: self-removal or activity bump only | `name`, `createdBy`, `memberIds` (active), `originalMemberIds`, `createdAt`, `lastMessageAt` |
| `groups/{groupId}/messages/{messageId}` | active members | create: active members, as themselves | `senderId`, `text` (1–2000), `createdAt` |

Email addresses are never written to Firestore.

**Availability entries** (one per user per local date):

```
uid, date: "2026-10-10", tz: "Europe/Berlin",
kind: "flexible" | "hours",
ranges: [{ start: "22:00", end: "02:00", startAt: Timestamp, endAt: Timestamp }],   // ≤ 8; empty for flexible
startAt, endAt: Timestamp,    // flexible = that local day's span; hours = earliest start / latest end
published: true, updatedAt: serverTimestamp
```

- Wall-clock times *and* exact instants are stored, together with the IANA time zone.
- An end time at or before the start means the next day (`22:00 → 02:00`).
- Daylight-saving days are measured in real elapsed time (23h/25h). Times skipped by a DST change are rejected.
- **Free whole day** is stored as `flexible`: the day's span, but **never treated as confirmed hours**, so matches against it are labelled “time needs confirming”.
- At most **8 separate ranges** per day. The rules check every range, and 9 is the most that fits Firestore's budget of 1,000 evaluated expressions per request; the app blocks a 9th block as you tap.
- The Availability grid edits hours, saving each day about 400 ms after your last tap (one write per day). The first save asks for publishing consent.

**Weekly repeats** (“I'm free from 3 PM to 4 PM every Friday”) live in the owner-only `settings.weekly` as `{ weekday: 1–7, start, end }` (minutes in the day). Saving one also writes those hours onto every matching date in the 90-day planning horizon, so others see ordinary availability entries and matching needs no changes. As days pass, the app extends repeats onto newly reachable dates once per visit, tracked by `settings.weeklyThrough`; dates already covered are never rewritten, so a one-off change to a single Friday sticks.

**Indexes** (`firestore.indexes.json`): `availability(published, endAt)` for discovery, `availability(uid, endAt)` for your own days, `groups(memberIds array-contains, lastMessageAt desc)` for the chat list.

## 5. How matching works (in the browser)

1. Load your own upcoming entries (≤ 120).
2. Query others' **published** entries whose `endAt` falls within your entries' window plus 50 hours (the longest span an entry can cover). The query is ordered by `endAt`, limited to 50 at a time (up to 300), and covers your availability in the **month shown on the calendar**. **Load more** fetches the next page. The UI only says “no one else is free” once the query is exhausted.
3. For each of your days, intersect your windows with each person's windows (≥ 30 minutes). The day's timeline lists you first, then everyone who shares at least one hour with you. An hour counts as free when at least half of it is covered, measured in your time zone (DST days keep 24 wall-clock columns).
4. Tapping someone's free hour starts a match (you + them, that hour). Tapping another hour or person grows it when **everyone** is free across the wider span; otherwise the match starts over at the new cell. Tapping a ticked cell takes that person out.
5. The confirmation sheet recomputes the overlap **across everyone at once**, clipped to the chosen hours: pairwise overlaps don't imply a group overlap. If anyone only said “free whole day”, the time is labelled as needing confirmation.

Match results are only a UI aid. Authorization comes entirely from the Security Rules.

## 6. Security Rules summary (`firestore.rules`)

Deny by default. The rules enforce:
- Users edit only their own profile, settings and availability (the document id must be `{uid}_{date}`).
- Only `published == true` availability is discoverable; list queries must use a `limit` (≤ 300).
- Group creation: 2–10 unique members, creator included, every member must have a profile, `originalMemberIds == memberIds`, server timestamps, no extra fields (no admins, invites or pending states).
- Only active members can read the group or its messages, or send messages; `senderId` must equal the caller.
- Messages are immutable.
- Group updates are either (a) **self-removal**: exactly the caller is removed and nothing else changes, or (b) bumping `lastMessageAt` to the server time.
- Membership can only shrink, so nobody can be added after creation and departed members can't be restored.

## 7. Limitations and free-plan constraints

- **No trusted backend.** Without Cloud Functions, the server can't verify that people added to a group actually matched. Anyone signed in can create a group containing any existing user. The safeguard is that anyone can leave any group at any time. Rate limiting and robust anti-spam are out of scope.
- **Public by design:** display names and published availability (including each day's time zone) are visible to all signed-in users. Profiles can be fetched by id but not listed. Published availability can be paged through by any signed-in user.
- **No notifications while the app is closed.** Matches and chats update in realtime only while the app is open.
- **Spark quotas** (at the time of writing; see [firebase.google.com/pricing](https://firebase.google.com/pricing)): Firestore ~50k reads, 20k writes and 20k deletes per day, 1 GiB stored; Hosting 10 GB storage and ~360 MB/day transfer. When a quota is exhausted, the app shows a “free usage limit reached” message until the daily reset. Rough per-action costs: opening Matches reads up to 50–300 entries; opening a chat reads up to 30 messages; sending a message is 1 read + 2 writes, plus one read per member who has the chat open. **Unlimited free usage is not guaranteed.**
- Message history and availability are never deleted automatically (past availability simply drops out of queries). Leaving a group doesn't delete your earlier messages; they stay visible to the remaining members.
- Chats are memory-cached only, so nothing private is persisted to disk. Signing out reloads the app and clears local state.

## 8. Project layout

```
src/lib/          pure logic: intervals, time zones, availability building, hour slots + weekly repeats, matching, links, validation
src/services/     Firestore access (availability, profiles, groups, messages, error messages)
src/state/        session, shared listeners, match feed, local "seen" markers, toasts
src/screens/      Availability (day + hour scrollers), Slot sheet (edit + weekly repeat), Matches (calendar + timeline), Create group, Chats, Chat, Profile, Sign-in, Onboarding
src/components/   App chrome (top bar, nav), Day scroller, Hour scroller, sheets, shared UI
firestore.rules   Security Rules        firestore.indexes.json   composite indexes
tests/unit/       Vitest unit tests     tests/rules/             emulator tests for rules + services
scripts/          icon generation, emulator seeding
```
