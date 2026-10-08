import type { User } from 'firebase/auth';
import { ArrowRight, Globe } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Avatar, Logo } from '../components/ui';
import { db } from '../firebase';
import { detectTimeZone, listTimeZones } from '../lib/time';
import { DISPLAY_NAME_MAX, cleanName, validateDisplayName } from '../lib/validation';
import { errorMessage } from '../services/errors';
import { createAccount } from '../services/profiles';
import { useOnline } from '../state/hooks';
import { signOutAndClear } from '../state/session';

export function OnboardingScreen({ user }: { user: User }) {
  const detected = useMemo(detectTimeZone, []);
  // Suggest the Google first name; the user decides what is public.
  const [name, setName] = useState(() => (user.displayName ?? '').split(' ')[0].slice(0, DISPLAY_NAME_MAX));
  const [timezone, setTimezone] = useState(detected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();
  const zones = useMemo(() => listTimeZones(detected), [detected]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = cleanName(name);
    const problem = validateDisplayName(clean);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createAccount(db, user.uid, { displayName: clean, timezone });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="welcome">
      <div className="brand">
        <Logo size={34} />
        <span>freeatthesametime.com</span>
      </div>
      <form className="onboarding card" onSubmit={submit} noValidate>
        <div className="onboarding-avatar">
          <Avatar uid={user.uid} name={cleanName(name) || '?'} size={88} />
        </div>
        <h1>Make it yours</h1>
        <p className="muted">Pick the name other people will see. Your avatar uses your initials.</p>

        <div className="field">
          <label htmlFor="display-name">Public display name</label>
          <input
            id="display-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="nickname"
            enterKeyHint="next"
            required
          />
          <span className="hint">Visible to other signed-in users. Your email stays private.</span>
        </div>

        <div className="field">
          <label htmlFor="timezone">
            <Globe size={15} aria-hidden="true" /> Time zone
          </label>
          <select id="timezone" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
                {z === detected ? ' (detected)' : ''}
              </option>
            ))}
          </select>
          <span className="hint">We detected this from your device. Change it if it’s wrong.</span>
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!online && <p className="hint">You’re offline. Connect to continue.</p>}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !online} aria-busy={busy}>
          {busy ? 'Saving…' : 'Continue'} <ArrowRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => void signOutAndClear()}>
          Use a different Google account
        </button>
      </form>
    </main>
  );
}
