import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth, db, googleProvider } from '../firebase';
import { errorMessage, isSilentAuthError } from '../services/errors';
import { clearProfileCache, profileFromData, settingsFromData, type PublicProfile, type UserSettings } from '../services/profiles';
import { clearLocalAppState } from './local';

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut'; authError: string | null }
  | { status: 'onboarding'; user: User }
  | { status: 'ready'; user: User; profile: PublicProfile; settings: UserSettings }
  | { status: 'error'; message: string; retry: () => void };

const SessionContext = createContext<Session>({ status: 'loading' });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [settings, setSettings] = useState<UserSettings | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        setUser(next);
        setProfile(undefined);
        setSettings(undefined);
        setLoadError(null);
      }),
    [],
  );

  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      if (!isSilentAuthError(err)) setAuthError(errorMessage(err));
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const onError = (err: unknown) => setLoadError(errorMessage(err));
    const stopProfile = onSnapshot(doc(db, 'profiles', user.uid), (s) => setProfile(profileFromData(s.data())), onError);
    const stopSettings = onSnapshot(doc(db, 'settings', user.uid), (s) => setSettings(settingsFromData(s.data())), onError);
    return () => {
      stopProfile();
      stopSettings();
    };
  }, [user, attempt]);

  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((n) => n + 1);
  }, []);

  const session = useMemo<Session>(() => {
    if (user === undefined) return { status: 'loading' };
    if (user === null) return { status: 'signedOut', authError };
    if (loadError) return { status: 'error', message: loadError, retry };
    if (profile === undefined || settings === undefined) return { status: 'loading' };
    if (profile === null || settings === null) return { status: 'onboarding', user };
    return { status: 'ready', user, profile, settings };
  }, [user, profile, settings, loadError, authError, retry]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export const useSession = (): Session => useContext(SessionContext);

export function useReadySession(): Extract<Session, { status: 'ready' }> {
  const session = useSession();
  if (session.status !== 'ready') throw new Error('Session is not ready');
  return session;
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Popup first; installed apps and popup-hostile browsers fall back to a redirect. */
export async function signInWithGoogle(): Promise<void> {
  if (isStandalone()) {
    await signInWithRedirect(auth, googleProvider);
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    throw err;
  }
}

/** Signs out and wipes everything private held in this browser tab. */
export async function signOutAndClear(): Promise<void> {
  await signOut(auth);
  clearProfileCache();
  clearLocalAppState();
  // A full reload drops all in-memory state, listeners and cached documents.
  window.location.replace('/');
}
