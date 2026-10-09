import { CalendarHeart, MessageCircle, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { GoogleMark, Logo } from '../components/ui';
import { errorMessage, isSilentAuthError } from '../services/errors';
import { signInWithGoogle } from '../state/session';

const STEPS = [
  { icon: CalendarHeart, title: 'Mark when you’re free', text: 'A flexible day or exact hours.' },
  { icon: Sparkles, title: 'See who overlaps', text: 'People free at the same time as you.' },
  { icon: MessageCircle, title: 'Start a group chat', text: 'Pick people and make a plan.' },
];

export function SignInScreen({ authError }: { authError: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(authError);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      if (!isSilentAuthError(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="welcome">
      <div className="brand">
        <Logo size={34} />
        <span>freeatthesametime.com</span>
      </div>

      <div className="hero-art" aria-hidden="true">
        <span className="hero-ring hero-ring--a" />
        <span className="hero-ring hero-ring--b" />
        <span className="hero-lens" />
        <span className="hero-bubble hero-bubble--1">AM</span>
        <span className="hero-bubble hero-bubble--2">JK</span>
        <span className="hero-bubble hero-bubble--3">SR</span>
        <span className="hero-tag">
          <Sparkles size={14} /> 7–9 PM
        </span>
      </div>

      <h1 className="welcome-title">
        Find people who are <span className="grad-text">free</span> when you are.
      </h1>

      <ol className="welcome-steps">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <span className="welcome-step-icon">
              <Icon size={20} strokeWidth={2.25} aria-hidden="true" />
            </span>
            <span>
              <strong>{title}</strong>
              <span>{text}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="welcome-actions">
        <button type="button" className="btn btn-google btn-block" onClick={handleSignIn} disabled={busy} aria-busy={busy}>
          <GoogleMark />
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <p className="fine-print">Others only see the display name you choose, never your email.</p>
      </div>
    </main>
  );
}
