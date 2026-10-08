import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { db } from '../firebase';
import { fetchProfile, type PublicProfile } from '../services/profiles';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Current time, refreshed every `everyMs`. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Profiles by uid: undefined while loading, null if the user no longer exists. */
export function useProfiles(uids: readonly string[]): Record<string, PublicProfile | null | undefined> {
  const key = useMemo(() => [...new Set(uids)].sort().join(','), [uids]);
  const [profiles, setProfiles] = useState<Record<string, PublicProfile | null>>({});

  useEffect(() => {
    let cancelled = false;
    for (const uid of key ? key.split(',') : []) {
      fetchProfile(db, uid).then(
        (profile) => {
          if (!cancelled) setProfiles((prev) => (prev[uid] === profile ? prev : { ...prev, [uid]: profile }));
        },
        () => {
          // Leave as loading; a later render retries because failures are not cached.
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  return profiles;
}
