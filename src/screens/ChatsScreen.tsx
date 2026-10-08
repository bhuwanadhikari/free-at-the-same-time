import { MessageCircle, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, GroupAvatar, InlineError, ScreenHeader, Spinner } from '../components/ui';
import { formatRelative } from '../lib/time';
import { useData } from '../state/data';
import { useNow } from '../state/hooks';
import { getLastSeen, useLocalVersion } from '../state/local';
import { useReadySession } from '../state/session';

export function ChatsScreen() {
  const { user } = useReadySession();
  const { groups, groupsState, groupsError, groupsMayHaveMore, loadMoreGroups, retry } = useData();
  const now = useNow(30_000);
  useLocalVersion();

  return (
    <main className="screen">
      <ScreenHeader eyebrow="Chats" icon={MessageCircle} title="Your groups" subtitle="Plain text chats with people who are free when you are." />

      {groupsState === 'loading' && <Spinner label="Loading chats" />}
      {groupsState === 'error' && <InlineError message={groupsError ?? 'Couldn’t load chats.'} onRetry={retry} />}

      {groupsState === 'ready' && groups.length === 0 && (
        <EmptyState
          icon={MessageCircle}
          title="No chats yet"
          action={
            <Link to="/matches" className="btn btn-primary">
              <Sparkles size={18} aria-hidden="true" /> See matches
            </Link>
          }
        >
          Start one from Matches, or wait for someone free at the same time to add you.
        </EmptyState>
      )}

      {groups.length > 0 && (
        <ul className="chat-list stagger">
          {groups.map((g) => {
            const unread = g.lastMessageAtMs > getLastSeen(user.uid, g.id);
            return (
              <li key={g.id}>
                <Link to={`/chats/${g.id}`} className="chat-row">
                  <GroupAvatar id={g.id} name={g.name} />
                  <span className="chat-row-text">
                    <span className="chat-row-name">{g.name}</span>
                    <span className="chat-row-meta">
                      {g.memberIds.length} {g.memberIds.length === 1 ? 'member' : 'members'} · active {formatRelative(g.lastMessageAtMs, now)}
                    </span>
                  </span>
                  {unread && (
                    <span className="unread-dot">
                      <span className="sr-only">New activity</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {groupsMayHaveMore && (
        <div className="load-more">
          <button type="button" className="btn btn-secondary" onClick={loadMoreGroups}>
            Load more chats
          </button>
        </div>
      )}
    </main>
  );
}
