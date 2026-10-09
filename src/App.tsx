import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { BottomNav, ErrorBoundary, OfflineBanner, UpdatePrompt } from './components/AppChrome';
import { Logo, Spinner } from './components/ui';
import { firebaseConfigured } from './firebase';
import { AvailabilityScreen } from './screens/AvailabilityScreen';
import { ChatScreen } from './screens/ChatScreen';
import { ChatsScreen } from './screens/ChatsScreen';
import { MatchesScreen } from './screens/MatchesScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SignInScreen } from './screens/SignInScreen';
import { DataProvider, useData } from './state/data';
import { getLastSeen, useLocalVersion } from './state/local';
import { SessionProvider, useSession, type Session } from './state/session';
import { ToastProvider } from './state/toast';
import { useWeeklyTopUp } from './state/weekly';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SessionProvider>
          <OfflineBanner />
          <UpdatePrompt />
          <Shell />
        </SessionProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

function Shell() {
  const session = useSession();
  if (!firebaseConfigured) return <SetupNeeded />;
  switch (session.status) {
    case 'loading':
      return (
        <div className="center-screen">
          <Logo size={56} />
          <Spinner />
        </div>
      );
    case 'signedOut':
      return <SignInScreen authError={session.authError} />;
    case 'onboarding':
      return <OnboardingScreen user={session.user} />;
    case 'error':
      return (
        <div className="center-screen">
          <h1>Couldn’t load your account</h1>
          <p>{session.message}</p>
          <button type="button" className="btn btn-primary" onClick={session.retry}>
            Try again
          </button>
        </div>
      );
    case 'ready':
      return <SignedInApp session={session} />;
  }
}

function SignedInApp({ session }: { session: Extract<Session, { status: 'ready' }> }) {
  return (
    // Keyed by user so nothing from one account can leak into another.
    <DataProvider key={session.user.uid} uid={session.user.uid} tz={session.settings.timezone}>
      <MainRoutes uid={session.user.uid} />
    </DataProvider>
  );
}

function MainRoutes({ uid }: { uid: string }) {
  const location = useLocation();
  const { groups } = useData();
  const localVersion = useLocalVersion();
  useWeeklyTopUp();
  const inChat = /^\/chats\/[^/]+/.test(location.pathname);
  // The availability planner fills the screen and scrolls inside its columns.
  const fill = location.pathname === '/availability';
  const chatsUnread = useMemo(
    () => groups.some((g) => g.lastMessageAtMs > getLastSeen(uid, g.id)),
    // localVersion changes whenever a chat is marked as seen.
    [groups, uid, localVersion],
  );

  return (
    <div className={inChat ? 'app app--chat' : fill ? 'app app--fill' : 'app'}>
      <Routes>
        <Route path="/" element={<Navigate to="/availability" replace />} />
        <Route path="/availability" element={<AvailabilityScreen />} />
        <Route path="/matches" element={<MatchesScreen />} />
        <Route path="/chats" element={<ChatsScreen />} />
        <Route path="/chats/:groupId" element={<ChatRoute />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/profile/privacy" element={<PrivacyScreen />} />
        <Route path="*" element={<Navigate to="/availability" replace />} />
      </Routes>
      {!inChat && <BottomNav chatsUnread={chatsUnread} />}
    </div>
  );
}

/** Fresh state per conversation. */
function ChatRoute() {
  const { groupId } = useParams();
  return <ChatScreen key={groupId} />;
}

function SetupNeeded() {
  return (
    <div className="center-screen">
      <Logo size={56} />
      <h1>Firebase isn’t configured</h1>
      <p>
        Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Firebase web app settings, and restart the dev server. See the
        README for details.
      </p>
    </div>
  );
}
