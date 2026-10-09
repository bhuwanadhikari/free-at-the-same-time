import { ChevronRight, Download, Globe, LogOut, Pencil, Share, ShieldCheck, Smartphone } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BackBar } from '../components/AppChrome';
import { Avatar } from '../components/ui';
import { db } from '../firebase';
import { detectTimeZone, listTimeZones, shortZoneName } from '../lib/time';
import { DISPLAY_NAME_MAX } from '../lib/validation';
import { errorMessage } from '../services/errors';
import { updateDisplayName, updateTimezone } from '../services/profiles';
import { useOnline } from '../state/hooks';
import { isIOS, isStandaloneDisplay, promptInstall, useInstallPrompt } from '../state/install';
import { signOutAndClear, useReadySession } from '../state/session';
import { useToast } from '../state/toast';

export function ProfileScreen() {
  const { user, profile, settings } = useReadySession();
  const toast = useToast();
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.displayName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tzError, setTzError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const detected = useMemo(detectTimeZone, []);
  const zones = useMemo(() => listTimeZones(settings.timezone), [settings.timezone]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNameError(null);
    try {
      await updateDisplayName(db, user.uid, name);
      setEditing(false);
      toast('Display name updated.');
    } catch (err) {
      setNameError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function changeZone(tz: string) {
    setTzError(null);
    try {
      await updateTimezone(db, user.uid, tz);
      toast(`Time zone set to ${tz.replace(/_/g, ' ')}.`);
    } catch (err) {
      setTzError(errorMessage(err));
    }
  }

  async function signOutNow() {
    setSigningOut(true);
    try {
      await signOutAndClear();
    } catch (err) {
      toast(errorMessage(err), 'error');
      setSigningOut(false);
    }
  }

  return (
    <main className="screen">
      <BackBar title="Profile" fallback="/availability" />

      <section className="card profile-card">
        <Avatar uid={user.uid} name={profile.displayName} size={76} />
        {editing ? (
          <form className="profile-edit" onSubmit={saveName} noValidate>
            <label htmlFor="edit-name" className="field-label">
              Public display name
            </label>
            <input id="edit-name" className="input" value={name} maxLength={DISPLAY_NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
            {nameError && (
              <p className="error-text" role="alert">
                {nameError}
              </p>
            )}
            <div className="row">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditing(false);
                  setName(profile.displayName);
                  setNameError(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !online}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <div className="profile-name">
            <h2>{profile.displayName}</h2>
            <p className="muted small">Visible to other signed-in users</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden="true" /> Edit name
            </button>
          </div>
        )}
      </section>

      <section className="card stack">
        <div className="field">
          <label htmlFor="profile-tz">
            <Globe size={15} aria-hidden="true" /> Time zone
          </label>
          <select id="profile-tz" className="select" value={settings.timezone} onChange={(e) => void changeZone(e.target.value)} disabled={!online}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
                {z === detected ? ' (this device)' : ''}
              </option>
            ))}
          </select>
          <span className="hint">
            Currently {shortZoneName(settings.timezone)}. Used for your calendar and match times. Days you already published keep the zone
            they were set in.
          </span>
          {tzError && <p className="error-text">{tzError}</p>}
        </div>
        <p className="muted small">Signed in with Google as {user.email ?? 'your Google account'}. Only you can see this.</p>
      </section>

      <InstallCard />

      <Link to="/profile/privacy" className="link-row">
        <ShieldCheck size={22} aria-hidden="true" />
        <span className="link-row-text">
          <span className="link-row-name">Privacy & limits</span>
          <span className="link-row-meta">Who sees what, and what the app can’t do</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </Link>

      <button type="button" className="btn btn-danger btn-block" onClick={() => void signOutNow()} disabled={signingOut}>
        <LogOut size={18} aria-hidden="true" /> {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
      <p className="muted small center">Signing out clears this app’s data from this device.</p>
    </main>
  );
}

function InstallCard() {
  const deferred = useInstallPrompt();
  if (isStandaloneDisplay()) {
    return (
      <section className="card install-card">
        <Smartphone size={22} aria-hidden="true" />
        <p>You’re using the installed app. 🎉</p>
      </section>
    );
  }
  return (
    <section className="card stack install-card">
      <h2 className="card-title">
        <Download size={20} aria-hidden="true" /> Install the app
      </h2>
      {deferred ? (
        <>
          <p className="muted">Add freeatthesametime.com to your home screen for a full-screen, app-like experience.</p>
          <button type="button" className="btn btn-primary" onClick={() => void promptInstall()}>
            <Download size={18} aria-hidden="true" /> Install
          </button>
        </>
      ) : isIOS() ? (
        <p className="muted">
          Tap <Share size={15} aria-label="Share" className="inline-icon" /> <strong>Share</strong> (in Safari it may be under the ⋯ menu), then{' '}
          <strong>Add to Home Screen</strong>.
        </p>
      ) : (
        <p className="muted">
          Open your browser menu (⋮) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
        </p>
      )}
    </section>
  );
}
