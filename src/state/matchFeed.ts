import { onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { db } from '../firebase';
import { MAX_ENTRY_SPAN_MS, type AvailabilityEntry } from '../lib/matching';
import { MATCH_MAX_LIMIT, MATCH_PAGE_SIZE, entryFromData, matchFeedQuery } from '../services/availability';
import { errorMessage } from '../services/errors';

export interface MatchFeed {
  others: AvailabilityEntry[];
  state: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** True once every entry in range has been downloaded. */
  exhausted: boolean;
  /** Whether the results for one of my days are known to be complete. */
  isComplete: (mine: AvailabilityEntry) => boolean;
  canLoadMore: boolean;
  hitLimit: boolean;
  loadMore: () => void;
  retry: () => void;
}

/**
 * Live, bounded query for other people's published availability around
 * `myDays` (e.g. my upcoming days in the month on screen). Grows by pages.
 * Changing `resetKey` starts again from one page.
 */
export function useMatchFeed(myDays: readonly AvailabilityEntry[], resetKey: string): MatchFeed {
  // Fixed per visit so the query (and its billing) doesn't churn every minute.
  const [anchor, setAnchor] = useState(() => Date.now());
  const [limitN, setLimitN] = useState(MATCH_PAGE_SIZE);
  const [others, setOthers] = useState<AvailabilityEntry[]>([]);
  const [state, setState] = useState<MatchFeed['state']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [frontierMs, setFrontierMs] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setLimitN(MATCH_PAGE_SIZE), [resetKey]);

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

  const canLoadMore = !exhausted && limitN < MATCH_MAX_LIMIT;

  const loadMore = useCallback(() => setLimitN((n) => Math.min(n + MATCH_PAGE_SIZE, MATCH_MAX_LIMIT)), []);

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
    others,
    state,
    error,
    exhausted,
    isComplete,
    canLoadMore,
    hitLimit: !exhausted && limitN >= MATCH_MAX_LIMIT,
    loadMore,
    retry,
  };
}
