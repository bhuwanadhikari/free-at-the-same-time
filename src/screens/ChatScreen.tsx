import { doc, onSnapshot, type QueryDocumentSnapshot } from 'firebase/firestore';
import { ArrowLeft, DoorOpen, RefreshCw, SendHorizontal, Users, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, Sheet } from '../components/Sheet';
import { Avatar, EmptyState, Spinner, cls } from '../components/ui';
import { db } from '../firebase';
import { linkify } from '../lib/links';
import { dateOf, formatDayLabel, formatTime, todayIn } from '../lib/time';
import { MESSAGE_MAX, cleanMessage } from '../lib/validation';
import { errorMessage } from '../services/errors';
import { groupFromSnap, leaveGroup, type Group } from '../services/groups';
import {
  MESSAGE_PAGE_SIZE,
  fetchOlderMessages,
  latestMessagesQuery,
  messageFromSnap,
  newMessageId,
  sendMessage,
  type ChatMessage,
} from '../services/messages';
import { useOnline, useProfiles } from '../state/hooks';
import { forgetGroup, markSeen } from '../state/local';
import { useReadySession } from '../state/session';
import { useToast } from '../state/toast';

interface Outgoing {
  id: string;
  text: string;
  status: 'sending' | 'failed' | 'sent';
  error?: string;
}

const RUN_GAP_MS = 5 * 60_000;

export function ChatScreen() {
  const { groupId = '' } = useParams();
  const { user, settings } = useReadySession();
  const uid = user.uid;
  const tz = settings.timezone;
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();

  const [group, setGroup] = useState<Group | null>(null);
  const [access, setAccess] = useState<'loading' | 'ok' | 'gone'>('loading');
  const [messages, setMessages] = useState<Map<string, ChatMessage>>(new Map());
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [draft, setDraft] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const leavingRef = useRef(false);
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const preserveFrom = useRef<number | null>(null);

  // Group doc: name, members, and whether I still have access.
  useEffect(() => {
    setAccess('loading');
    return onSnapshot(
      doc(db, 'groups', groupId),
      (snap) => {
        const g = groupFromSnap(snap);
        if (!g || !g.memberIds.includes(uid)) {
          setAccess('gone');
          return;
        }
        setGroup(g);
        setAccess('ok');
        markSeen(uid, groupId, Math.max(g.lastMessageAtMs, Date.now()));
      },
      () => {
        if (!leavingRef.current) setAccess('gone');
      },
    );
  }, [groupId, uid]);

  // Latest page of messages, live. Only while I'm a member.
  useEffect(() => {
    if (access !== 'ok') return;
    return onSnapshot(
      latestMessagesQuery(db, groupId),
      (snap) => {
        if (!cursorRef.current && !snap.metadata.fromCache) {
          cursorRef.current = snap.docs[snap.docs.length - 1] ?? null;
          setHasOlder(snap.size === MESSAGE_PAGE_SIZE);
        }
        setMessages((prev) => {
          const next = new Map(prev);
          // "removed" only means a message slid out of the latest page; keep it.
          for (const change of snap.docChanges()) {
            if (change.type === 'removed') continue;
            const m = messageFromSnap(change.doc);
            if (m) next.set(m.id, m);
          }
          return next;
        });
      },
      () => {
        if (!leavingRef.current) setAccess('gone');
      },
    );
  }, [access, groupId]);

  // Drop outgoing items once the server copy shows up in the listener.
  useEffect(() => {
    setOutbox((list) => (list.some((o) => messages.has(o.id)) ? list.filter((o) => !messages.has(o.id)) : list));
  }, [messages]);

  const ordered = useMemo(
    () => [...messages.values()].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id)),
    [messages],
  );
  const pending = outbox.filter((o) => !messages.has(o.id));

  const memberUids = useMemo(() => (group ? [...new Set([...group.originalMemberIds, ...group.memberIds])] : []), [group]);
  const profiles = useProfiles(memberUids);
  const nameOf = (id: string) => (id === uid ? 'You' : (profiles[id]?.displayName ?? 'Former member'));

  // Keep the view pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (preserveFrom.current !== null) {
      el.scrollTop = el.scrollHeight - preserveFrom.current;
      preserveFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [ordered.length, pending.length, access]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function loadOlder() {
    if (!cursorRef.current || loadingOlder) return;
    setLoadingOlder(true);
    setHistoryError(null);
    try {
      const page = await fetchOlderMessages(db, groupId, cursorRef.current);
      if (page.cursor) cursorRef.current = page.cursor;
      setHasOlder(page.hasMore);
      if (scrollRef.current) preserveFrom.current = scrollRef.current.scrollHeight - scrollRef.current.scrollTop;
      setMessages((prev) => {
        const next = new Map(prev);
        for (const m of page.messages) next.set(m.id, m);
        return next;
      });
    } catch (err) {
      setHistoryError(errorMessage(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  const attempt = useCallback(
    async (item: { id: string; text: string }) => {
      setOutbox((list) => list.map((o) => (o.id === item.id ? { ...o, status: 'sending', error: undefined } : o)));
      try {
        // Same id on every retry, so a message is never stored twice.
        await sendMessage(db, { groupId, messageId: item.id, uid, text: item.text });
        setOutbox((list) => list.map((o) => (o.id === item.id ? { ...o, status: 'sent' } : o)));
      } catch (err) {
        setOutbox((list) => list.map((o) => (o.id === item.id ? { ...o, status: 'failed', error: errorMessage(err) } : o)));
      }
    },
    [groupId, uid],
  );

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = cleanMessage(draft);
    if (!text || text.length > MESSAGE_MAX || !online) return;
    const item: Outgoing = { id: newMessageId(db, groupId), text, status: 'sending' };
    setOutbox((list) => [...list, item]);
    setDraft('');
    stickToBottom.current = true;
    void attempt(item);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on devices with a physical keyboard; Shift+Enter adds a line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(hover: hover)').matches) {
      e.preventDefault();
      submit();
    }
  }

  async function confirmLeave() {
    if (!group) return;
    setLeaving(true);
    setLeaveError(null);
    leavingRef.current = true;
    try {
      await leaveGroup(db, groupId, uid);
      // Clear the conversation from local state; the listeners stop on unmount.
      setMessages(new Map());
      setOutbox([]);
      forgetGroup(uid, groupId);
      toast(`You left ${group.name}.`);
      navigate('/chats', { replace: true });
    } catch (err) {
      leavingRef.current = false;
      setLeaveError(errorMessage(err));
      setLeaving(false);
    }
  }

  if (access === 'gone') {
    return (
      <main className="screen">
        <EmptyState
          icon={DoorOpen}
          title="This chat isn’t available"
          action={
            <Link to="/chats" className="btn btn-primary">
              Back to chats
            </Link>
          }
        >
          You’re not a member of this group, or you left it.
        </EmptyState>
      </main>
    );
  }

  const today = todayIn(tz);
  const overLimit = draft.length > MESSAGE_MAX;

  return (
    <div className="chat">
      <header className="chat-header">
        <Link to="/chats" className="icon-btn icon-btn--plain" aria-label="Back to chats">
          <ArrowLeft size={22} aria-hidden="true" />
        </Link>
        <button type="button" className="chat-title" onClick={() => setMembersOpen(true)} disabled={!group}>
          <span className="chat-title-name">{group?.name ?? 'Loading…'}</span>
          {group && (
            <span className="chat-title-meta">
              {group.memberIds.length} {group.memberIds.length === 1 ? 'member' : 'members'} · tap for details
            </span>
          )}
        </button>
        <button type="button" className="icon-btn icon-btn--plain" onClick={() => setMembersOpen(true)} aria-label="Members and leave group" disabled={!group}>
          <Users size={22} aria-hidden="true" />
        </button>
      </header>

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {access === 'loading' && <Spinner label="Loading chat" />}
        {hasOlder && (
          <div className="older">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {historyError && <p className="error-text center">{historyError}</p>}
        {access === 'ok' && ordered.length === 0 && pending.length === 0 && (
          <div className="chat-intro">
            <p>
              <strong>Say hi 👋</strong>
            </p>
            <p className="muted small">Everyone in this group can read and send messages. Paste a link (like a WhatsApp group invite) and it becomes clickable.</p>
          </div>
        )}

        <ol className="messages" aria-label="Messages">
          {ordered.map((m, i) => {
            const prev = ordered[i - 1];
            const next = ordered[i + 1];
            const day = dateOf(m.createdAtMs, tz);
            const newDay = !prev || dateOf(prev.createdAtMs, tz) !== day;
            const first = newDay || prev.senderId !== m.senderId || m.createdAtMs - prev.createdAtMs > RUN_GAP_MS;
            const last =
              !next || next.senderId !== m.senderId || next.createdAtMs - m.createdAtMs > RUN_GAP_MS || dateOf(next.createdAtMs, tz) !== day;
            const mine = m.senderId === uid;
            const left = group && !mine && !group.memberIds.includes(m.senderId);
            return (
              <Fragment key={m.id}>
                {newDay && <li className="day-sep">{day === today ? 'Today' : formatDayLabel(day)}</li>}
                <li className={cls('msg', mine && 'msg--mine', first && 'msg--first')}>
                  {first && !mine && (
                    <span className="msg-sender">
                      {nameOf(m.senderId)}
                      {left && ' (left)'}
                    </span>
                  )}
                  <div className="bubble">
                    {mine ? <span className="sr-only">You: </span> : !first && <span className="sr-only">{nameOf(m.senderId)}: </span>}
                    <MessageText text={m.text} />
                  </div>
                  {last && <time className="msg-time">{formatTime(m.createdAtMs, tz)}</time>}
                </li>
              </Fragment>
            );
          })}
          {pending.map((o) => (
            <li key={o.id} className={cls('msg', 'msg--mine', 'msg--first', o.status === 'failed' ? 'msg--failed' : 'msg--pending')}>
              <div className="bubble">
                <MessageText text={o.text} />
              </div>
              {o.status === 'failed' ? (
                <span className="msg-failed" role="alert">
                  Not sent{o.error ? ` — ${o.error}` : ''}
                  <button type="button" className="link-btn" onClick={() => void attempt(o)} disabled={!online}>
                    <RefreshCw size={13} aria-hidden="true" /> Retry
                  </button>
                  <button type="button" className="link-btn" onClick={() => setOutbox((list) => list.filter((x) => x.id !== o.id))}>
                    <X size={13} aria-hidden="true" /> Discard
                  </button>
                </span>
              ) : (
                o.status === 'sending' && <span className="msg-time">Sending…</span>
              )}
            </li>
          ))}
        </ol>
      </div>

      <form className="composer" onSubmit={submit}>
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <textarea
          id="composer-input"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={online ? 'Message' : 'Offline — reconnect to send'}
          enterKeyHint="send"
          disabled={access !== 'ok'}
          aria-invalid={overLimit}
        />
        <button type="submit" className="send-btn" disabled={!cleanMessage(draft) || overLimit || !online || access !== 'ok'} aria-label="Send message">
          <SendHorizontal size={21} aria-hidden="true" />
        </button>
      </form>
      {overLimit && (
        <p className="composer-error" role="alert">
          Messages can be up to {MESSAGE_MAX} characters.
        </p>
      )}

      <Sheet open={membersOpen && !leaveOpen} onClose={() => setMembersOpen(false)} title="Members">
        {group && (
          <>
            <ul className="member-list">
              {group.memberIds.map((id) => (
                <li key={id}>
                  <Avatar uid={id} name={id === uid ? (profiles[id]?.displayName ?? 'You') : profiles[id]?.displayName} size={40} />
                  <span>
                    {id === uid ? `${profiles[id]?.displayName ?? 'You'} (you)` : (profiles[id]?.displayName ?? '…')}
                    {id === group.createdBy && <span className="muted small"> · started this chat</span>}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-danger btn-block" onClick={() => setLeaveOpen(true)}>
              <DoorOpen size={18} aria-hidden="true" /> Leave group
            </button>
          </>
        )}
      </Sheet>

      <ConfirmDialog
        open={leaveOpen}
        title={`Leave ${group?.name ?? 'group'}?`}
        confirmLabel="Leave group"
        tone="danger"
        busy={leaving}
        error={leaveError}
        onConfirm={() => void confirmLeave()}
        onCancel={() => {
          setLeaveOpen(false);
          setLeaveError(null);
        }}
      >
        <p>You’ll stop seeing this conversation and can’t rejoin it. Your earlier messages stay visible to the others.</p>
      </ConfirmDialog>
    </div>
  );
}

function MessageText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((seg, i) =>
        seg.type === 'link' ? (
          <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {seg.text}
          </a>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}
