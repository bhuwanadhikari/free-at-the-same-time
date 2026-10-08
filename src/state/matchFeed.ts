import { onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import { DAY_MS } from '../lib/intervals';
import { MAX_ENTRY_SPAN_MS, type AvailabilityEntry } from '../lib/matching';
import { MATCH_MAX_LIMIT, MATCH_PAGE_SIZE, entryFromData, matchFeedQuery } from '../services/availability';
import { errorMessage } from '../services/errors';

const WINDOW_STEP_DAYS = 14;
const MAX_WINDOW_DAYS = 84;

export interface MatchFeed {
  /** My upcoming entries inside the current date window. */
  myDays: AvailabilityEntry[];
  others: AvailabilityEntry[];
  state: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** True once every entry in the window has been downloaded. */
  exhausted: boolean;
  /** Whether the results for one of my days are known to be complete. */
  isComplete: (mine: AvailabilityEntry) => boolean;
  canLoadMore: boolean;
  /** "more results" or "later dates" — what the next load will fetch. */
  nextLoad: 'more' | 'later' | null;
  hitLimit: boolean;
  loadMore: () => void;
  retry: () => void;
}

/**
 * Live, bounded query for other people's published availability around my
 * own upcoming days. Grows by pages (Load more), then by later date windows.
 */
export function useMatchFeed(myUpcoming: readonly AvailabilityEntry[]): MatchFeed {
  // Fixed per visit so the query (and its billing) doesn't churn every minute.
  const [anchor, setAnchor] = useState(() => Date.now());
  const [windowDays, setWindowDays] = useState(WINDOW_STEP_DAYS);
  const [limitN, setLimitN] = useState(MATCH_PAGE_SIZE);
  const [others, setOthers] = useState<AvailabilityEntry[]>([]);
  const [state, setState] = useState<MatchFeed['state']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [frontierMs, setFrontierMs] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const windowEnd = anchor + windowDays * DAY_MS;
  const myDays = useMemo(() => myUpcoming.filter((e) => e.startMs < windowEnd), [myUpcoming, windowEnd]);
  const hasLater = myUpcoming.length > myDays.length;

  // Plain numbers so the listener only restarts when the bounds really change.
  const from = myDays.length ? Math.max(anchor, Math.min(...myDays.map((e) => e.startMs))) : 0;
  const to = myDays.length ? Math.max(...myDays.map((e) => e.endMs)) + MAX_ENTRY_SPAN_MS : 0;

  useEffect(() => {
    if (!to) {
      setState('idle');
      setOthers([]);
      return;
    }
    setState((s) => (s === 'ready' ? s : 'loading'));
    return onSnapshot(
      matchFeedQuery(db, from, to, limitN),
      (snap) => {
        setOthers(snap.docs.map((d) => entryFromData(d.id, d.data())).filter((e): e is AvailabilityEntry => e !== null));
        setExhausted(snap.size < limitN);
        const last = snap.docs[snap.docs.length - 1];
        setFrontierMs(last ? last.get('endAt').toMillis() : to);
        setState('ready');
        setError(null);
      },
      (err) => {
        setState('error');
        setError(errorMessage(err));
      },
    );
  }, [from, to, limitN, attempt]);

  const canPageMore = !exhausted && limitN < MATCH_MAX_LIMIT;
  const canWiden = hasLater && windowDays < MAX_WINDOW_DAYS;
  const nextLoad = canPageMore ? 'more' : exhausted && canWiden ? 'later' : null;

  const loadMore = useCallback(() => {
    if (nextLoad === 'more') setLimitN((n) => Math.min(n + MATCH_PAGE_SIZE, MATCH_MAX_LIMIT));
    else if (nextLoad === 'later') setWindowDays((d) => Math.min(d + WINDOW_STEP_DAYS, MAX_WINDOW_DAYS));
  }, [nextLoad]);

  const retry = useCallback(() => {
    setError(null);
    setAnchor(Date.now());
    setAttempt((n) => n + 1);
  }, []);

  const isComplete = useCallback(
    (mine: AvailabilityEntry) => exhausted || frontierMs >= mine.endMs + MAX_ENTRY_SPAN_MS,
    [exhausted, frontierMs],
  );

  return {
    myDays,
    others,
    state,
    error,
    exhausted,
    isComplete,
    canLoadMore: nextLoad !== null,
    nextLoad,
    hitLimit: !exhausted && limitN >= MATCH_MAX_LIMIT,
    loadMore,
    retry,
  };
}
