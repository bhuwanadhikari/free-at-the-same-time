import { onSnapshot } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from '../firebase';
import type { AvailabilityEntry } from '../lib/matching';
import { daySpan, todayIn } from '../lib/time';
import { entryFromData, myAvailabilityQuery } from '../services/availability';
import { errorMessage } from '../services/errors';
import { GROUPS_PAGE_SIZE, groupFromSnap, myGroupsQuery, type Group } from '../services/groups';

type LoadState = 'loading' | 'ready' | 'error';

interface DataValue {
  myEntries: AvailabilityEntry[];
  myEntriesState: LoadState;
  myEntriesError: string | null;
  groups: Group[];
  groupsState: LoadState;
  groupsError: string | null;
  groupsMayHaveMore: boolean;
  loadMoreGroups: () => void;
  retry: () => void;
}

const DataContext = createContext<DataValue | null>(null);

/**
 * The two listeners the whole signed-in app shares: your own availability
 * and your chat list. Everything else subscribes only while on screen.
 */
export function DataProvider({ uid, tz, children }: { uid: string; tz: string; children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [myEntries, setMyEntries] = useState<AvailabilityEntry[]>([]);
  const [myEntriesState, setMyEntriesState] = useState<LoadState>('loading');
  const [myEntriesError, setMyEntriesError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsState, setGroupsState] = useState<LoadState>('loading');
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupLimit, setGroupLimit] = useState(GROUPS_PAGE_SIZE);

  // Start of today in the user's zone; includes today's entries even if partly past.
  const fromMs = useMemo(() => daySpan(todayIn(tz), tz).start, [tz]);

  useEffect(() => {
    setMyEntriesState('loading');
    return onSnapshot(
      myAvailabilityQuery(db, uid, fromMs),
      (snap) => {
        setMyEntries(
          snap.docs
            .map((d) => entryFromData(d.id, d.data()))
            .filter((e): e is AvailabilityEntry => e !== null)
            .sort((a, b) => a.startMs - b.startMs),
        );
        setMyEntriesState('ready');
        setMyEntriesError(null);
      },
      (err) => {
        setMyEntriesState('error');
        setMyEntriesError(errorMessage(err));
      },
    );
  }, [uid, fromMs, attempt]);

  useEffect(() => {
    return onSnapshot(
      myGroupsQuery(db, uid, groupLimit),
      (snap) => {
        setGroups(snap.docs.map(groupFromSnap).filter((g): g is Group => g !== null && g.memberIds.includes(uid)));
        setGroupsState('ready');
        setGroupsError(null);
      },
      (err) => {
        setGroupsState('error');
        setGroupsError(errorMessage(err));
      },
    );
  }, [uid, groupLimit, attempt]);

  const loadMoreGroups = useCallback(() => setGroupLimit((n) => n + GROUPS_PAGE_SIZE), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<DataValue>(
    () => ({
      myEntries,
      myEntriesState,
      myEntriesError,
      groups,
      groupsState,
      groupsError,
      groupsMayHaveMore: groups.length >= groupLimit,
      loadMoreGroups,
      retry,
    }),
    [myEntries, myEntriesState, myEntriesError, groups, groupsState, groupsError, groupLimit, loadMoreGroups, retry],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside DataProvider');
  return value;
}
