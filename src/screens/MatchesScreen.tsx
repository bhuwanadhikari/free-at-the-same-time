import { CalendarPlus, Check, ChevronLeft, ChevronRight, MessageCirclePlus, Users, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { TopBar } from '../components/AppChrome';
import { Avatar, AvatarStack, InlineError, Spinner, cls } from '../components/ui';
import type { Interval } from '../lib/intervals';
import { computeDayMatches, overlapAcross, type Window } from '../lib/matching';
import {
  HOURS,
  addMonths,
  dayFreeFromEntry,
  formatHourRange,
  formatHourShort,
  formatHoursShort,
  formatMonth,
  freeColumns,
  freeMinutes,
  horizonEnd,
  hourColumns,
  monthDates,
  monthOf,
  summaryLines,
  weekdayOf,
  type DayFree,
} from '../lib/slots';
import { formatLongDay, todayIn } from '../lib/time';
import { MAX_GROUP_SIZE } from '../lib/validation';
import { useData } from '../state/data';
import { useNow, useProfiles } from '../state/hooks';
import { useMatchFeed } from '../state/matchFeed';
import { useReadySession } from '../state/session';
import { useToast } from '../state/toast';
import { CreateGroupSheet } from './CreateGroupSheet';

const CELL_W = 40;
const FOCUS_HOUR = 6;
const HOUR_LIST = Array.from({ length: HOURS }, (_, h) => h);
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  DateTime.fromObject({ year: 2024, month: 1, day: i + 1 }, { zone: 'UTC' }).toLocaleString({ weekday: 'narrow' }),
);

/** People picked on the timeline, and the hours (inclusive columns) they share with you. */
interface Selection {
  uids: string[];
  from: number;
  to: number;
}

interface Row {
  uid: string;
  windows: Window[];
  free: boolean[];
  /** Free at the same time as you. */
  common: boolean[];
  flexible: boolean;
  shared: number;
}

const clip = (windows: readonly Window[], span: Interval): Window[] =>
  windows
    .map((w) => ({ ...w, start: Math.max(w.start, span.start), end: Math.min(w.end, span.end) }))
    .filter((w) => w.end > w.start);

export function MatchesScreen() {
  const { user, profile, settings } = useReadySession();
  const tz = settings.timezone;
  const { myEntries, myEntriesState, myEntriesError, retry } = useData();
  const toast = useToast();
  const now = useNow();
  const today = todayIn(tz, now);
  const lastDay = horizonEnd(today);
  const [month, setMonth] = useState(() => monthOf(today));
  const [selectedRaw, setSelectedRaw] = useState(today);
  const selected = selectedRaw < today ? today : selectedRaw;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const byDate = useMemo(() => new Map(myEntries.map((e) => [e.date, e])), [myEntries]);
  const myMonth = useMemo(() => myEntries.filter((e) => monthOf(e.date) === month && e.endMs > now), [myEntries, month, now]);
  const feed = useMatchFeed(myMonth, month);
  const dayMatches = useMemo(
    () => computeDayMatches(myMonth, feed.others, { selfUid: user.uid, nowMs: now }),
    [myMonth, feed.others, user.uid, now],
  );
  const matchesByDate = useMemo(() => new Map(dayMatches.map((d) => [d.mine.date, d])), [dayMatches]);

  const myEntry = byDate.get(selected);
  // A day keeps the zone it was published in, as on the calendar and Availability.
  const dayTz = myEntry?.tz ?? tz;
  const columns = useMemo(() => hourColumns(selected, dayTz), [selected, dayTz]);
  const dm = matchesByDate.get(selected);
  const myWindows = useMemo(() => dm?.myWindows ?? [], [dm]);
  const meFree = useMemo(() => freeColumns(myWindows, columns), [myWindows, columns]);
  const past = useMemo(() => columns.map((c) => c.end <= now), [columns, now]);

  const rawRows = useMemo<Row[]>(
    () =>
      (dm?.people ?? [])
        .map((p) => {
          const free = freeColumns(p.windows, columns);
          const common = free.map((f, i) => f && meFree[i]);
          return {
            uid: p.uid,
            windows: p.windows,
            free,
            common,
            flexible: p.entries.every((e) => e.kind === 'flexible'),
            shared: common.filter(Boolean).length,
          };
        })
        .filter((r) => r.shared > 0)
        .sort((a, b) => b.shared - a.shared || a.uid.localeCompare(b.uid)),
    [dm, columns, meFree],
  );
  const profiles = useProfiles(useMemo(() => rawRows.map((r) => r.uid), [rawRows]));
  // People whose profile was deleted can't be added to groups.
  const rows = useMemo(() => rawRows.filter((r) => profiles[r.uid] !== null), [rawRows, profiles]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.uid, r])), [rows]);

  const selectDay = (date: string) => {
    setSelectedRaw(date);
    setSelection(null);
  };

  const changeMonth = (n: number) => {
    const next = addMonths(month, n);
    setMonth(next);
    selectDay(next === monthOf(today) ? today : `${next}-01`);
  };

  // Cell taps read the latest state through a ref so rows can stay memoized.
  const live = useRef({ selection, rowsById, meFree, profiles });
  useLayoutEffect(() => {
    live.current = { selection, rowsById, meFree, profiles };
  });

  const onCell = useCallback(
    (uid: string, col: number) => {
      const { selection: sel, rowsById: byId, meFree: mine, profiles: names } = live.current;
      const row = byId.get(uid);
      const name = names[uid]?.displayName;
      if (!row?.common[col] || !name) return;
      // Tapping a ticked cell takes that person out.
      if (sel && sel.uids.includes(uid) && col >= sel.from && col <= sel.to) {
        const uids = sel.uids.filter((u) => u !== uid);
        setSelection(uids.length ? { ...sel, uids } : null);
        return;
      }
      // Grow the match when everyone is free across the wider span; otherwise start over here.
      if (sel) {
        const uids = sel.uids.includes(uid) ? sel.uids : [...sel.uids, uid];
        const from = Math.min(sel.from, col);
        const to = Math.max(sel.to, col);
        const lists = [mine, ...uids.map((u) => byId.get(u)?.free)];
        const fits = lists.every((free) => free && HOUR_LIST.slice(from, to + 1).every((c) => free[c]));
        if (fits) {
          if (uids.length > MAX_GROUP_SIZE - 1) {
            toast(`Groups can have up to ${MAX_GROUP_SIZE} people, including you.`, 'info');
            return;
          }
          setSelection({ uids, from, to });
          return;
        }
      }
      setSelection({ uids: [uid], from: col, to: col });
    },
    [toast],
  );

  const overlap = useMemo(() => {
    if (!selection) return null;
    const span = { start: columns[selection.from].start, end: columns[selection.to].end };
    return overlapAcross([clip(myWindows, span), ...selection.uids.map((u) => clip(rowsById.get(u)?.windows ?? [], span))]);
  }, [selection, columns, myWindows, rowsById]);

  // Open on the first hour you share with someone, else your first free hour, else 6 AM.
  const focusCol = useMemo(() => {
    const first = rows.length ? Math.min(...rows.map((r) => r.common.indexOf(true))) : meFree.indexOf(true);
    return first >= 0 ? Math.max(0, first - 1) : FOCUS_HOUR;
  }, [rows, meFree]);

  const months = { prev: month > monthOf(today), next: month < monthOf(lastDay) };
  const myFreeToday = meFree.some(Boolean);
  const complete = dm ? feed.isComplete(dm.mine) : true;
  const when = selection ? formatHourRange(selection.from, selection.to + 1) : '';

  return (
    <main className={cls('screen screen--matches', selection && 'has-selection')}>
      <TopBar>
        <h1 className="topbar-title">Matches</h1>
      </TopBar>

      <section className="card month-card" aria-label="Calendar">
        <div className="calendar-nav">
          <button type="button" className="icon-btn" onClick={() => changeMonth(-1)} disabled={!months.prev} aria-label="Previous month">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <h2 className="calendar-range" aria-live="polite">
            {formatMonth(month)}
          </h2>
          <button type="button" className="icon-btn" onClick={() => changeMonth(1)} disabled={!months.next} aria-label="Next month">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <MonthGrid
          month={month}
          selected={selected}
          today={today}
          lastDay={lastDay}
          dayOf={(date) => dayFreeFromEntry(byDate.get(date))}
          countOf={(date) => matchesByDate.get(date)?.people.length ?? 0}
          onSelect={selectDay}
        />
      </section>

      <section className="stack timeline-section" aria-labelledby="timeline-title">
        <div className="timeline-head">
          <h2 id="timeline-title" className="section-title">
            {formatLongDay(selected)}
          </h2>
          {rows.length > 0 && (
            <span className="muted small">
              {rows.length} {rows.length === 1 ? 'person' : 'people'} free with you
            </span>
          )}
        </div>
        {dayTz !== tz && <p className="muted small">Times in {dayTz}, the zone this day was set in.</p>}

        {myEntriesState === 'loading' && <Spinner label="Loading" />}
        {myEntriesState === 'error' && <InlineError message={myEntriesError ?? 'Couldn’t load your availability.'} onRetry={retry} />}
        {feed.state === 'error' && <InlineError message={feed.error ?? 'Couldn’t load matches.'} onRetry={feed.retry} />}

        {myEntriesState === 'ready' && (
          <Timeline
            key={selected}
            meUid={user.uid}
            meName={profile.displayName}
            meFree={meFree}
            past={past}
            rows={rows}
            profiles={profiles}
            selection={selection}
            focusCol={focusCol}
            onCell={onCell}
          />
        )}

        {myEntriesState === 'ready' && !myFreeToday && (
          <div className="timeline-empty">
            <p className="muted">
              {myEntry ? 'Your free time on this day has already passed.' : 'You haven’t marked any free time on this day.'}
            </p>
            {!myEntry && (
              <Link to={`/availability?date=${selected}`} className="btn btn-secondary btn-sm">
                <CalendarPlus size={18} aria-hidden="true" /> Add free time
              </Link>
            )}
          </div>
        )}
        {myFreeToday && feed.state === 'loading' && <Spinner label="Finding matches" />}
        {myFreeToday && feed.state === 'ready' && rows.length === 0 && (
          <p className="muted timeline-empty">
            {complete ? 'No one else is free at the same time yet.' : 'No matches found so far — load more to keep checking.'}
          </p>
        )}
        {myFreeToday && rows.length > 0 && !selection && <p className="hint">Tap a shared hour to match. Tap more hours or people to grow it.</p>}

        {feed.state === 'ready' && feed.canLoadMore && (
          <div className="load-more">
            <p className="muted small">These are the first results we checked — more people may be free.</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={feed.loadMore}>
              Load more
            </button>
          </div>
        )}
        {feed.state === 'ready' && feed.hitLimit && (
          <p className="muted small">We checked as many entries as we can at once, so some matches may not be shown.</p>
        )}
      </section>

      {selection && (
        <div className="match-bar" role="region" aria-label="Your match">
          <AvatarStack
            people={[{ uid: user.uid, name: profile.displayName }, ...selection.uids.map((uid) => ({ uid, name: profiles[uid]?.displayName }))]}
            size={30}
          />
          <span className="match-bar-text">
            <strong>
              You + {selection.uids.map((u) => profiles[u]?.displayName ?? '…').join(', ')}
            </strong>
            <span>{when}</span>
          </span>
          <button type="button" className="icon-btn icon-btn--on-dark" onClick={() => setSelection(null)} aria-label="Clear match">
            <X size={20} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <MessageCirclePlus size={18} aria-hidden="true" /> Open chat
          </button>
        </div>
      )}

      {createOpen && selection && overlap && (
        <CreateGroupSheet
          date={selected}
          selected={selection.uids}
          profiles={profiles}
          overlap={overlap}
          fromHour={selection.from}
          toHour={selection.to + 1}
          tz={dayTz}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setSelection(null)}
        />
      )}
    </main>
  );
}

function MonthGrid({
  month,
  selected,
  today,
  lastDay,
  dayOf,
  countOf,
  onSelect,
}: {
  month: string;
  selected: string;
  today: string;
  lastDay: string;
  dayOf: (date: string) => DayFree;
  countOf: (date: string) => number;
  onSelect: (date: string) => void;
}) {
  const dates = monthDates(month);
  const lead = weekdayOf(dates[0]) - 1;
  return (
    <div className="month">
      {WEEKDAYS.map((w, i) => (
        <span key={i} className="month-wk" aria-hidden="true">
          {w}
        </span>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={`lead-${i}`} aria-hidden="true" />
      ))}
      {dates.map((date) => {
        const day = dayOf(date);
        const minutes = freeMinutes(day);
        const count = countOf(date);
        return (
          <button
            key={date}
            type="button"
            className={cls('month-day', minutes > 0 && 'has-free', date === selected && 'is-selected', date === today && 'is-today')}
            aria-pressed={date === selected}
            aria-label={`${formatLongDay(date)}${minutes ? `, free ${summaryLines(day).join(', ')}` : ''}${count ? `, ${count} ${count === 1 ? 'match' : 'matches'}` : ''}`}
            disabled={date < today || date > lastDay}
            onClick={() => onSelect(date)}
          >
            <span className="month-num">{Number(date.slice(8))}</span>
            {(minutes > 0 || count > 0) && (
              <span className="month-stats" aria-hidden="true">
                {minutes > 0 && (
                  <span className="month-stat">
                    {formatHoursShort(minutes)}
                  </span>
                )}
                {count > 0 && (
                  <span className="month-stat month-stat--matches">
                    <Users size={8} strokeWidth={3} />
                    {count}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Timeline({
  meUid,
  meName,
  meFree,
  past,
  rows,
  profiles,
  selection,
  focusCol,
  onCell,
}: {
  meUid: string;
  meName: string;
  meFree: boolean[];
  past: boolean[];
  rows: Row[];
  profiles: Record<string, { displayName: string } | null | undefined>;
  selection: Selection | null;
  focusCol: number;
  onCell: (uid: string, col: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const from = selection?.from ?? -1;
  const to = selection?.to ?? -1;

  // Remounted per day (keyed). Follow the data as it arrives until the user scrolls.
  const touched = useRef(false);
  useLayoutEffect(() => {
    if (!touched.current && scrollRef.current) scrollRef.current.scrollLeft = focusCol * CELL_W;
  }, [focusCol]);
  const touch = () => {
    touched.current = true;
  };

  return (
    <div
      className="timeline"
      ref={scrollRef}
      style={{ ['--tl-cell' as string]: `${CELL_W}px` }}
      onPointerDown={touch}
      onWheel={touch}
    >
      <div className="tl-row tl-hours" aria-hidden="true">
        <span className="tl-name" />
        {HOUR_LIST.map((h) => (
          <span key={h} className={cls('tl-hour', h >= from && h <= to && 'in-sel')}>
            {formatHourShort(h)}
          </span>
        ))}
      </div>
      <TimelineRow uid={meUid} name="You" avatarName={meName} isMe free={meFree} past={past} picked from={from} to={to} onCell={onCell} />
      {rows.map((r) => (
        <TimelineRow
          key={r.uid}
          uid={r.uid}
          name={profiles[r.uid]?.displayName}
          avatarName={profiles[r.uid]?.displayName}
          flexible={r.flexible}
          // Only the hours they share with you; the rest of their day isn't shown.
          free={r.common}
          past={past}
          picked={selection?.uids.includes(r.uid) ?? false}
          from={from}
          to={to}
          onCell={onCell}
        />
      ))}
    </div>
  );
}

const TimelineRow = memo(function TimelineRow({
  uid,
  name,
  avatarName,
  isMe = false,
  flexible = false,
  free,
  past,
  picked,
  from,
  to,
  onCell,
}: {
  uid: string;
  name: string | undefined;
  avatarName: string | undefined;
  isMe?: boolean;
  flexible?: boolean;
  /** Hours to show as free: all of yours, or just the ones someone shares with you. */
  free: boolean[];
  past: boolean[];
  picked: boolean;
  from: number;
  to: number;
  onCell: (uid: string, col: number) => void;
}) {
  const label = name ?? 'Loading…';
  return (
    <div className={cls('tl-row', isMe && 'tl-row--me')}>
      <span className="tl-name">
        <Avatar uid={uid} name={avatarName} size={26} />
        <span className="tl-name-text">
          <span>{label}</span>
          {flexible && <small>whole day</small>}
        </span>
      </span>
      {HOUR_LIST.map((h) => {
        const inSel = h >= from && h <= to;
        const ticked = inSel && picked && free[h];
        const className = cls(
          'tl-cell',
          free[h] && (isMe ? 'is-mine' : 'is-common'),
          past[h] && 'is-past',
          inSel && 'in-sel',
          inSel && free[h] && !picked && 'is-candidate',
          ticked && 'is-ticked',
        );
        const tick = ticked && <Check size={17} strokeWidth={3.5} aria-hidden="true" />;
        if (isMe || !free[h]) {
          return (
            <span key={h} className={className} aria-hidden="true">
              {tick}
            </span>
          );
        }
        return (
          <button
            key={h}
            type="button"
            className={className}
            aria-pressed={Boolean(ticked)}
            aria-label={`${label}, ${formatHourRange(h, h + 1)}, free with you`}
            onClick={() => onCell(uid, h)}
          >
            {tick}
          </button>
        );
      })}
    </div>
  );
});
