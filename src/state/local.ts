import { useSyncExternalStore } from 'react';

// Per-device conveniences only (which chats you've opened). Never authoritative.
const PREFIX = 'fatst:';
const EVENT = 'fatst-local-change';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage may be unavailable (private mode); the app works without it.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function clearLocalAppState(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    sessionStorage.clear();
  } catch {
    // Ignore unavailable storage.
  }
}

const seenKey = (uid: string, groupId: string) => `${uid}:seen:${groupId}`;

export function getLastSeen(uid: string, groupId: string): number {
  return Number(read(seenKey(uid, groupId)) ?? 0);
}

export function markSeen(uid: string, groupId: string, atMs: number): void {
  if (atMs > getLastSeen(uid, groupId)) write(seenKey(uid, groupId), String(atMs));
}

export function forgetGroup(uid: string, groupId: string): void {
  write(seenKey(uid, groupId), null);
}

let version = 0;
const subscribe = (cb: () => void) => {
  const handler = () => {
    version++;
    cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
};

/** Re-renders when local "seen" markers change. */
export function useLocalVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
