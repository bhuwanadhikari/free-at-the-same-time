import { LoaderCircle, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { avatarColor, initials } from '../lib/avatar';

export const cls = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

export function Avatar({ uid, name, size = 40 }: { uid: string; name: string | undefined; size?: number }) {
  return (
    <span
      className={cls('avatar', name === undefined && 'avatar--loading')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: avatarColor(uid) }}
      aria-hidden="true"
    >
      {name === undefined ? '' : initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 28 }: { people: { uid: string; name: string | undefined }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack" aria-hidden="true">
      {shown.map((p) => (
        <Avatar key={p.uid} uid={p.uid} name={p.name} size={size} />
      ))}
      {extra > 0 && (
        <span className="avatar avatar--more" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

export function GroupAvatar({ id, name, size = 52 }: { id: string; name: string; size?: number }) {
  return (
    <span className="group-avatar" style={{ width: size, height: size, background: avatarColor(id), fontSize: Math.round(size * 0.34) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return <img src="/favicon.svg" width={size} height={size} alt="" className="logo" />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <LoaderCircle size={22} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  );
}

/** Two overlapping rings with an icon — the app's visual motif. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <span className="empty-ring empty-ring--a" />
        <span className="empty-ring empty-ring--b" />
        <span className="empty-icon">
          <Icon size={30} strokeWidth={2.25} />
        </span>
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
