import { CircleCheck, Clock, Handshake, MessagesSquare } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Sheet } from '../components/Sheet';
import { Avatar } from '../components/ui';
import { db } from '../firebase';
import { describeWindows } from '../lib/describe';
import type { Overlap } from '../lib/matching';
import { formatDayLabel, formatLongDay } from '../lib/time';
import { GROUP_NAME_MAX } from '../lib/validation';
import { errorMessage } from '../services/errors';
import { createGroup, hasGroup, slotGroupId } from '../services/groups';
import type { PublicProfile } from '../services/profiles';
import { useOnline } from '../state/hooks';
import { useReadySession } from '../state/session';
import { useToast } from '../state/toast';

const formatClock = (h: number) => `${String(h).padStart(2, '0')}:00`;

type Profiles = Record<string, PublicProfile | null | undefined>;

export function CreateGroupSheet({
  date,
  selected,
  profiles,
  overlap,
  fromHour,
  toHour,
  tz,
  onClose,
  onCreated,
}: {
  date: string;
  selected: string[];
  profiles: Profiles;
  overlap: Overlap;
  /** The hours picked on the timeline: [fromHour, toHour), 24-hour clock. */
  fromHour: number;
  toHour: number;
  tz: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user, profile } = useReadySession();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const when = `${formatClock(fromHour)} - ${formatClock(toHour)}`;
  const [name, setName] = useState(`${formatDayLabel(date)} | ${when}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!online) {
      setError('You’re offline. Connect to create the chat.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Same people + same slot = same id, so a repeat opens the existing chat.
      const slotId = await slotGroupId({ memberIds: [user.uid, ...selected], date, fromHour, toHour, tz });
      if (await hasGroup(db, slotId, user.uid)) {
        onCreated();
        toast('You already have a chat for this time.', 'info');
        navigate(`/chats/${slotId}`);
        return;
      }
      await createGroup(db, { groupId: slotId, creatorUid: user.uid, name, memberIds: selected });
      onCreated();
      toast('Chat created. Everyone can message right away.');
      navigate(`/chats/${slotId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={busy ? () => {} : onClose} title="Open a group chat">
      <form className="stack" onSubmit={submit} noValidate>
        <p className="when-chip">
          <Clock size={16} aria-hidden="true" />
          {formatLongDay(date)} · {when}
        </p>

        <div className="field">
          <label htmlFor="group-name">Chat name</label>
          <input
            id="group-name"
            className="input"
            value={name}
            maxLength={GROUP_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            enterKeyHint="done"
            required
          />
        </div>

        <div className="field">
          <span className="field-label">Members ({selected.length + 1})</span>
          <ul className="member-chips">
            <li>
              <Avatar uid={user.uid} name={profile.displayName} size={30} />
              You
            </li>
            {selected.map((uid) => (
              <li key={uid}>
                <Avatar uid={uid} name={profiles[uid]?.displayName} size={30} />
                {profiles[uid]?.displayName ?? '…'}
              </li>
            ))}
          </ul>
        </div>

        <OverlapSummary overlap={overlap} tz={tz} anchorDate={date} />

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !online} aria-busy={busy}>
          {busy ? 'Opening…' : 'Open group chat'}
        </button>
      </form>
    </Sheet>
  );
}

export function OverlapSummary({
  overlap,
  tz,
  anchorDate,
}: {
  overlap: Overlap;
  tz: string;
  anchorDate: string;
}) {
  if (overlap.status === 'confirmed') {
    return (
      <div className="summary summary--ok" role="status">
        <CircleCheck size={20} aria-hidden="true" />
        <span>
          <strong>Everyone’s free {describeWindows(overlap.confirmed, tz, anchorDate)}</strong>
          <span>Confirmed overlap for the whole group.</span>
        </span>
      </div>
    );
  }
  if (overlap.status === 'tentative') {
    return (
      <div className="summary summary--warn" role="status">
        <Handshake size={20} aria-hidden="true" />
        <span>
          <strong>Possible {describeWindows(overlap.tentative, tz, anchorDate)}</strong>
        </span>
      </div>
    );
  }
  return (
    <div className="summary summary--info" role="status">
      <MessagesSquare size={20} aria-hidden="true" />
      <span>
        <strong>No time that works for everyone</strong>
        <span>You can still start a discussion group, it just isn’t a confirmed match.</span>
      </span>
    </div>
  );
}
