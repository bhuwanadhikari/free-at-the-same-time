import { ArrowLeft, CalendarHeart, MessageCircle, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useOnline } from '../state/hooks';
import { useReadySession } from '../state/session';
import { Avatar } from './ui';

const NAV = [
  { to: '/availability', label: 'Availability', icon: CalendarHeart },
  { to: '/matches', label: 'Matches', icon: Sparkles },
  { to: '/chats', label: 'Chats', icon: MessageCircle },
] as const;

/** Compact screen header; your profile always sits at the top right. */
export function TopBar({ children }: { children?: ReactNode }) {
  const { user, profile } = useReadySession();
  return (
    <header className="topbar">
      <div className="topbar-main">{children}</div>
      <Link to="/profile" className="topbar-profile" aria-label="Profile">
        <Avatar uid={user.uid} name={profile.displayName} size={32} />
      </Link>
    </header>
  );
}

/** Header for a pushed screen: back arrow plus title. */
export function BackBar({ title, fallback }: { title: string; fallback: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <header className="topbar">
      <div className="topbar-main">
        <button
          type="button"
          className="icon-btn icon-btn--plain"
          // Opened directly (no history in the app): go to the parent screen instead of leaving.
          onClick={() => (location.key === 'default' ? navigate(fallback) : navigate(-1))}
          aria-label="Back"
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="topbar-title">{title}</h1>
      </div>
    </header>
  );
}

export function BottomNav({ chatsUnread }: { chatsUnread: boolean }) {
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
          <span className="nav-icon">
            <Icon size={20} strokeWidth={2.25} aria-hidden="true" />
            {to === '/chats' && chatsUnread && <span className="nav-dot" />}
          </span>
          <span className="nav-label">
            {label}
            {to === '/chats' && chatsUnread && <span className="sr-only"> (new activity)</span>}
          </span>
        </NavLink>
      ))}
    </nav>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOff size={16} aria-hidden="true" />
      You’re offline. Nothing will be sent or saved until you reconnect.
    </div>
  );
}

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>A new version is ready.</span>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => updateServiceWorker(true)}>
        <RefreshCw size={16} aria-hidden="true" /> Reload
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('App crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center-screen">
        <h1>Something went wrong</h1>
        <p>Reloading usually fixes it.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
