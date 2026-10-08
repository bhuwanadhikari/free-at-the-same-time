import { CalendarPlus, Check, CircleCheck, Handshake, MessageCirclePlus, MessagesSquare, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Avatar, EmptyState, InlineError, ScreenHeader, Spinner, cls } from '../components/ui';
import { describeEntry, describePersonOverlap, describeWindows } from '../lib/describe';
import { computeDayMatches, groupOverlap, type DayMatches, type Overlap } from '../lib/matching';
import { dayParts, daySpan, formatLongDay } from '../lib/time';
import { MAX_GROUP_SIZE } from '../lib/validation';
import type { PublicProfile } from '../services/profiles';
import { useData } from '../state/data';
import { useNow, useProfiles } from '../state/hooks';
import { useMatchFeed } from '../state/matchFeed';
import { useReadySession } from '../state/session';
import { useToast } from '../state/toast';
import { CreateGroupSheet } from './CreateGroupSheet';

type Profiles = Record<string, PublicProfile | null | undefined>;

export function MatchesScreen() {
  const { user, settings } = useReadySession();
  const { myEntries, myEntriesState, myEntriesError, retry: retryMine } = useData();
  const now = useNow();
  const upcoming = useMemo(() => myEntries.filter((e) => e.endMs > now), [myEntries, now]);
  const feed = useMatchFeed(upcoming);

  const days = useMemo(
    () => computeDayMatches(feed.myDays, feed.others, { selfUid: user.uid, nowMs: now }),
    [feed.myDays, feed.others, user.uid, now],
  );
  const peopleUids = useMemo(() => days.flatMap((d) => d.people.map((p) => p.uid)), [days]);
  const profiles = useProfiles(peopleUids);

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="Matches"
        icon={Sparkles}
        title={
          <>
            Who’s free <span className="grad-text">with you</span>
          </>
        }
        subtitle="People whose published availability overlaps yours. Select people and start a chat."
      />

      {myEntriesState === 'loading' && <Spinner label="Loading" />}
      {myEntriesState === 'error' && <InlineError message={myEntriesError ?? 'Couldn’t load your availability.'} onRetry={retryMine} />}

      {myEntriesState === 'ready' && upcoming.length === 0 && (
        <EmptyState
          icon={CalendarPlus}
          title="Publish when you’re free"
          action={
            <Link to="/availability" className="btn btn-primary">
              Add availability
            </Link>
          }
        >
          Matches are based on your own published availability. Add a day or some hours to see who’s free at the same time.
        </EmptyState>
      )}

      {feed.state === 'error' && <InlineError message={feed.error ?? 'Couldn’t load matches.'} onRetry={feed.retry} />}
      {feed.state === 'loading' && <Spinner label="Finding matches" />}

      {feed.state === 'ready' && (
        <div className="stack stagger">
          {days.map((day) => (
            <DayMatchCard key={day.mine.id} day={day} profiles={profiles} complete={feed.isComplete(day.mine)} tz={settings.timezone} />
          ))}
        </div>
      )}

      {feed.state === 'ready' && (
        <div className="load-more">
          {feed.canLoadMore ? (
            <>
              <p className="muted small">
                {feed.nextLoad === 'more'
                  ? 'These are the first results we checked — more people may be free.'
                  : 'You have availability on later dates too.'}
              </p>
              <button type="button" className="btn btn-secondary" onClick={feed.loadMore}>
                {feed.nextLoad === 'more' ? 'Load more' : 'Check later dates'}
              </button>
            </>
          ) : feed.hitLimit ? (
            <p className="muted small">We checked as many entries as we can at once, so some matches may not be shown.</p>
          ) : (
            days.length > 0 && <p className="muted small">That’s everyone we found for these dates. New matches appear here while the app is open.</p>
          )}
        </div>
      )}
    </main>
  );
}

function DayMatchCard({ day, profiles, complete, tz }: { day: DayMatches; profiles: Profiles; complete: boolean; tz: string }) {
  const { user } = useReadySession();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const { weekday, day: dayNum, month } = dayParts(day.mine.date);
  const myDay = daySpan(day.mine.date, day.mine.tz);

  // People whose profile was deleted can't be added to groups.
  const people = day.people.filter((p) => profiles[p.uid] !== null);
  const eligible = people.filter((p) => profiles[p.uid]);
  const maxOthers = MAX_GROUP_SIZE - 1;
  const overlap = selected.length ? groupOverlap(day, selected) : null;
  const allSelected = eligible.length > 0 && eligible.slice(0, maxOthers).every((p) => selected.includes(p.uid));

  const toggle = (uid: string) => {
    setSelected((list) => {
      if (list.includes(uid)) return list.filter((u) => u !== uid);
      if (list.length >= maxOthers) {
        toast(`Groups can have up to ${MAX_GROUP_SIZE} people, including you.`, 'info');
        return list;
      }
      return [...list, uid];
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected([]);
    else {
      if (eligible.length > maxOthers) toast(`Selected the first ${maxOthers} — groups are limited to ${MAX_GROUP_SIZE} people.`, 'info');
      setSelected(eligible.slice(0, maxOthers).map((p) => p.uid));
    }
  };

  return (
    <article className="card match-card" aria-labelledby={`day-${day.mine.id}`}>
      <header className="match-head">
        <div className="date-badge" aria-hidden="true">
          <span className="date-badge-wk">{weekday}</span>
          <span className="date-badge-num">{dayNum}</span>
          <span className="date-badge-mo">{month}</span>
        </div>
        <div className="match-head-text">
          <h2 id={`day-${day.mine.id}`}>{formatLongDay(day.mine.date)}</h2>
          <span className="you-chip">
            You: {day.mine.kind === 'flexible' ? 'free, time flexible' : describeEntry(day.mine)}
          </span>
        </div>
      </header>

      {people.length === 0 ? (
        <p className="match-empty">
          {complete ? 'No one else is free at the same time yet.' : 'No matches found so far — load more below to keep checking.'}
        </p>
      ) : (
        <ul className="people" aria-label="People free at the same time">
          {people.map((p) => {
            const profile = profiles[p.uid];
            const text = describePersonOverlap(p.overlap, { selfUid: user.uid, otherUid: p.uid, tz, anchorDate: day.mine.date, myDay });
            const checked = selected.includes(p.uid);
            return (
              <li key={p.uid}>
                <label className={cls('person', checked && 'is-checked', !profile && 'is-loading')}>
                  <input type="checkbox" className="sr-only" checked={checked} disabled={!profile} onChange={() => toggle(p.uid)} />
                  <Avatar uid={p.uid} name={profile?.displayName} size={44} />
                  <span className="person-text">
                    <span className="person-name">{profile?.displayName ?? 'Loading…'}</span>
                    <span className="person-detail">
                      <span className={cls('badge', text.tone === 'confirmed' ? 'badge--ok' : 'badge--warn')}>
                        {text.tone === 'confirmed' ? <CircleCheck size={13} aria-hidden="true" /> : <Handshake size={13} aria-hidden="true" />}
                        {text.badge}
                      </span>
                      <span>{text.detail}</span>
                    </span>
                  </span>
                  <span className="check" aria-hidden="true">
                    <Check size={16} strokeWidth={3} />
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {people.length > 0 && (
        <footer className="match-foot">
          {overlap && <OverlapSummary overlap={overlap} profiles={profiles} selfUid={user.uid} tz={tz} anchorDate={day.mine.date} />}
          {!complete && <p className="muted small">More people may be free this day — use Load more below.</p>}
          <div className="match-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAll} disabled={eligible.length === 0}>
              {allSelected ? 'Clear' : 'Select all'}
            </button>
            <button type="button" className="btn btn-primary grow" disabled={selected.length === 0} onClick={() => setCreateOpen(true)}>
              <MessageCirclePlus size={19} aria-hidden="true" />
              Create chat{selected.length ? ` (${selected.length + 1})` : ''}
            </button>
          </div>
        </footer>
      )}

      {createOpen && overlap && (
        <CreateGroupSheet
          date={day.mine.date}
          selected={selected}
          profiles={profiles}
          overlap={overlap}
          tz={tz}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setSelected([])}
        />
      )}
    </article>
  );
}

export function OverlapSummary({
  overlap,
  profiles,
  selfUid,
  tz,
  anchorDate,
}: {
  overlap: Overlap;
  profiles: Profiles;
  selfUid: string;
  tz: string;
  anchorDate: string;
}) {
  if (overlap.status === 'confirmed') {
    return (
      <div className="summary summary--ok" role="status">
        <CircleCheck size={20} aria-hidden="true" />
        <span>
          <strong>Everyone’s free {describeWindows(overlap.confirmed, tz, anchorDate)}</strong>
          <span>Confirmed overlap for the whole group.</span>
        </span>
      </div>
    );
  }
  if (overlap.status === 'tentative') {
    const flexibleNames = [...new Set(overlap.tentative.flatMap((w) => w.flexible))].map((uid) =>
      uid === selfUid ? 'you' : (profiles[uid]?.displayName ?? 'someone'),
    );
    return (
      <div className="summary summary--warn" role="status">
        <Handshake size={20} aria-hidden="true" />
        <span>
          <strong>Possible {describeWindows(overlap.tentative, tz, anchorDate)}</strong>
          <span>Time needs confirming — {flexibleNames.join(', ')} only said “time flexible”.</span>
        </span>
      </div>
    );
  }
  return (
    <div className="summary summary--info" role="status">
      <MessagesSquare size={20} aria-hidden="true" />
      <span>
        <strong>No time that works for everyone</strong>
        <span>You can still start a discussion group — it just isn’t a confirmed match.</span>
      </span>
    </div>
  );
}
