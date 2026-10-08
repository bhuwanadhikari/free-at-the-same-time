import { Info } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Sheet } from '../components/Sheet';
import { Avatar } from '../components/ui';
import { db } from '../firebase';
import type { Overlap } from '../lib/matching';
import { formatDayLabel } from '../lib/time';
import { GROUP_NAME_MAX } from '../lib/validation';
import { errorMessage } from '../services/errors';
import { createGroup, newGroupId } from '../services/groups';
import type { PublicProfile } from '../services/profiles';
import { useOnline } from '../state/hooks';
import { useReadySession } from '../state/session';
import { useToast } from '../state/toast';
import { OverlapSummary } from './MatchesScreen';

export function CreateGroupSheet({
  date,
  selected,
  profiles,
  overlap,
  tz,
  onClose,
  onCreated,
}: {
  date: string;
  selected: string[];
  profiles: Record<string, PublicProfile | null | undefined>;
  overlap: Overlap;
  tz: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user, profile } = useReadySession();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  // One id per sheet: repeated taps can't create duplicates, but opening the
  // sheet again makes an intentionally separate group.
  const [groupId] = useState(() => newGroupId(db));
  const [name, setName] = useState(`${formatDayLabel(date)} plans`);
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
      await createGroup(db, { groupId, creatorUid: user.uid, name, memberIds: selected });
      onCreated();
      toast('Chat created. Everyone can message right away.');
      navigate(`/chats/${groupId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={busy ? () => {} : onClose} title="New group chat">
      <form className="stack" onSubmit={submit} noValidate>
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

        <OverlapSummary overlap={overlap} profiles={profiles} selfUid={user.uid} tz={tz} anchorDate={date} />

        <p className="note">
          <Info size={16} aria-hidden="true" />
          Everyone you selected joins immediately — there are no invitations. Anyone can leave at any time.
        </p>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !online} aria-busy={busy}>
          {busy ? 'Creating…' : 'Create chat'}
        </button>
      </form>
    </Sheet>
  );
}
