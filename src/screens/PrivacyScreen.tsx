import { ShieldCheck } from 'lucide-react';
import { BackBar } from '../components/AppChrome';

export function PrivacyScreen() {
  return (
    <main className="screen">
      <BackBar title="Privacy & limits" fallback="/profile" />

      <section className="card stack info-card">
        <h2 className="card-title">
          <ShieldCheck size={20} aria-hidden="true" /> What others can see
        </h2>
        <ul className="plain-list">
          <li>Other signed-in users see your display name and published availability, including the time zone each day was set in.</li>
          <li>Anyone with matching availability can add you to a group chat without an invitation. You can leave any group at any time.</li>
          <li>There’s no server-side matching or spam filtering, so the app can’t verify why someone added you.</li>
        </ul>
      </section>

      <section className="card stack">
        <h2 className="card-title">Limits</h2>
        <ul className="plain-list">
          <li>Chats are plain text. Updates show while the app is open; there are no notifications when it’s closed.</li>
          <li>This runs on a free hosting plan with daily limits. If it hits them, things may pause until the next day.</li>
        </ul>
      </section>
    </main>
  );
}
