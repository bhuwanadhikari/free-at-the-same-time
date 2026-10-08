import { ArrowRight, Clock, Globe, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, Sheet } from '../components/Sheet';
import { cls } from '../components/ui';
import { db } from '../firebase';
import {
  MAX_RANGES_PER_DAY,
  buildEntry,
  crossesMidnight,
  draftFromEntry,
  sameDraft,
  type DayDraft,
  type RangeDraft,
} from '../lib/availability';
import type { AvailabilityEntry, AvailabilityKind } from '../lib/matching';
import { formatDayLabel } from '../lib/time';
import { publishEntries, removeEntries } from '../services/availability';
import { errorMessage } from '../services/errors';
import { recordPublishConsent } from '../services/profiles';
import { useOnline } from '../state/hooks';
import { useToast } from '../state/toast';

const DEFAULT_RANGE: RangeDraft = { start: '18:00', end: '21:00' };
const PRESETS: { label: string; range: RangeDraft }[] = [
  { label: 'Morning', range: { start: '09:00', end: '12:00' } },
  { label: 'Lunch', range: { start: '12:00', end: '14:00' } },
  { label: 'Afternoon', range: { start: '14:00', end: '18:00' } },
  { label: 'Evening', range: { start: '18:00', end: '22:00' } },
  { label: 'Late night', range: { start: '21:00', end: '01:00' } },
];

export const CONSENT_TEXT =
  'Your display name and published availability are visible to other signed-in users. People with matching availability can add you directly to a group chat. You can leave any group at any time.';

function initialDraft(entries: AvailabilityEntry[], dateCount: number): DayDraft {
  if (entries.length === dateCount && entries.length > 0) {
    const first = draftFromEntry(entries[0]);
    if (entries.every((e) => sameDraft(draftFromEntry(e), first))) return first;
  }
  return { kind: 'flexible', ranges: [] };
}

interface Props {
  open: boolean;
  dates: string[];
  entries: AvailabilityEntry[];
  uid: string;
  tz: string;
  hasConsented: boolean;
  onClose: (done: boolean) => void;
}

export function DayEditor(props: Props) {
  const title =
    props.dates.length === 1 ? formatDayLabel(props.dates[0] ?? '') : `${props.dates.length} days`;
  return (
    <Sheet open={props.open} onClose={() => props.onClose(false)} title={title}>
      {/* Remount per opening so the form starts from the selected days. */}
      <EditorBody key={props.dates.join(',')} {...props} />
    </Sheet>
  );
}

function EditorBody({ dates, entries, uid, tz, hasConsented, onClose }: Props) {
  const start = initialDraft(entries, dates.length);
  const [kind, setKind] = useState<AvailabilityKind>(start.kind);
  const [ranges, setRanges] = useState<RangeDraft[]>(start.ranges.length ? start.ranges : [DEFAULT_RANGE]);
  const [busy, setBusy] = useState<'publish' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const online = useOnline();
  const toast = useToast();

  const draft: DayDraft = { kind, ranges: kind === 'hours' ? ranges : [] };
  const built = dates.map((date) => ({ date, result: buildEntry(uid, date, tz, draft) }));
  const firstProblem = built.find((b) => !b.result.ok);
  const problem =
    firstProblem && !firstProblem.result.ok
      ? `${dates.length > 1 ? `${formatDayLabel(firstProblem.date)}: ` : ''}${firstProblem.result.error}`
      : null;
  const otherZone = entries.find((e) => e.tz !== tz);

  const updateRange = (i: number, patch: Partial<RangeDraft>) =>
    setRanges((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const applyPreset = (range: RangeDraft) =>
    setRanges((list) => {
      const untouched = list.length === 1 && list[0].start === DEFAULT_RANGE.start && list[0].end === DEFAULT_RANGE.end;
      if (untouched) return [range];
      if (list.some((r) => r.start === range.start && r.end === range.end)) return list;
      return list.length < MAX_RANGES_PER_DAY ? [...list, range] : list;
    });

  async function publish() {
    if (!online) {
      setError('You’re offline. Connect to publish.');
      return;
    }
    const entriesToSave = built.flatMap((b) => (b.result.ok ? [b.result.value] : []));
    if (entriesToSave.length !== dates.length) return;
    setBusy('publish');
    setError(null);
    try {
      if (!hasConsented) await recordPublishConsent(db, uid);
      await publishEntries(db, entriesToSave);
      setConsentOpen(false);
      toast(dates.length === 1 ? 'Published. Check Matches to see who’s free.' : `Published ${dates.length} days.`);
      onClose(true);
    } catch (err) {
      setError(errorMessage(err));
      setConsentOpen(false);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!online) {
      setError('You’re offline. Connect to remove availability.');
      setRemoveOpen(false);
      return;
    }
    setBusy('remove');
    setError(null);
    try {
      await removeEntries(db, uid, entries.map((e) => e.date));
      toast(entries.length === 1 ? 'Availability removed.' : `Removed ${entries.length} days.`);
      setRemoveOpen(false);
      onClose(true);
    } catch (err) {
      setError(errorMessage(err));
      setRemoveOpen(false);
    } finally {
      setBusy(null);
    }
  }

  const onPublishClick = () => {
    if (problem) {
      setError(problem);
      return;
    }
    // Never publish automatically: the first publication needs explicit consent.
    if (!hasConsented) setConsentOpen(true);
    else void publish();
  };

  return (
    <>
      {dates.length > 1 && <p className="muted small">Applies to {dates.map(formatDayLabel).join(', ')}.</p>}

      <fieldset className="choices">
        <legend className="sr-only">How are you free?</legend>
        <label className={cls('choice', kind === 'flexible' && 'is-checked')}>
          <input type="radio" name="kind" className="sr-only" checked={kind === 'flexible'} onChange={() => setKind('flexible')} />
          <span className="choice-icon choice-icon--flexible" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <span className="choice-text">
            <strong>Free this day — time flexible</strong>
            <span>You’re around, timing is open. Others see “time flexible”, not specific hours.</span>
          </span>
        </label>
        <label className={cls('choice', kind === 'hours' && 'is-checked')}>
          <input type="radio" name="kind" className="sr-only" checked={kind === 'hours'} onChange={() => setKind('hours')} />
          <span className="choice-icon choice-icon--hours" aria-hidden="true">
            <Clock size={20} />
          </span>
          <span className="choice-text">
            <strong>Free during these hours</strong>
            <span>Add one or more time ranges.</span>
          </span>
        </label>
      </fieldset>

      {kind === 'hours' && (
        <div className="ranges">
          <div className="presets" role="group" aria-label="Quick ranges">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip" onClick={() => applyPreset(p.range)}>
                {p.label}
              </button>
            ))}
          </div>
          {ranges.map((r, i) => (
            <div key={i} className="range-row">
              <label className="time-field">
                <span>From</span>
                <input type="time" className="time-input" value={r.start} step={300} onChange={(e) => updateRange(i, { start: e.target.value })} required />
              </label>
              <ArrowRight size={18} className="range-arrow" aria-hidden="true" />
              <label className="time-field">
                <span>To{crossesMidnight(r) ? ' (next day)' : ''}</span>
                <input type="time" className="time-input" value={r.end} step={300} onChange={(e) => updateRange(i, { end: e.target.value })} required />
              </label>
              <button
                type="button"
                className="icon-btn icon-btn--plain"
                onClick={() => setRanges((list) => list.filter((_, j) => j !== i))}
                disabled={ranges.length === 1}
                aria-label={`Remove time range ${i + 1}`}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
          ))}
          {ranges.length < MAX_RANGES_PER_DAY && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRanges((list) => [...list, { start: '12:00', end: '14:00' }])}>
              <Plus size={18} aria-hidden="true" /> Add another range
            </button>
          )}
        </div>
      )}

      <p className="hint tz-hint">
        <Globe size={14} aria-hidden="true" /> Times are in {tz.replace(/_/g, ' ')}.
        {otherZone && ` Some of these days were set in ${otherZone.tz.replace(/_/g, ' ')}; publishing uses your current time zone.`}
      </p>

      {(error || problem) && (
        <p className="error-text" role="alert">
          {error ?? problem}
        </p>
      )}

      <div className="editor-actions">
        {entries.length > 0 && (
          <button type="button" className="btn btn-danger" onClick={() => setRemoveOpen(true)} disabled={busy !== null}>
            <Trash2 size={18} aria-hidden="true" /> Remove
          </button>
        )}
        <button type="button" className="btn btn-primary grow" onClick={onPublishClick} disabled={busy !== null || !online} aria-busy={busy === 'publish'}>
          {busy === 'publish' ? 'Publishing…' : entries.length ? 'Publish changes' : 'Publish'}
        </button>
      </div>

      <ConfirmDialog
        open={consentOpen}
        title="Before you publish"
        confirmLabel="I understand — publish"
        cancelLabel="Not now"
        busy={busy === 'publish'}
        onConfirm={() => void publish()}
        onCancel={() => setConsentOpen(false)}
      >
        <p>{CONSENT_TEXT}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={removeOpen}
        title={entries.length === 1 ? 'Remove this day?' : `Remove ${entries.length} days?`}
        confirmLabel="Remove"
        tone="danger"
        busy={busy === 'remove'}
        onConfirm={() => void remove()}
        onCancel={() => setRemoveOpen(false)}
      >
        <p>People won’t see you as free on {entries.length === 1 ? 'this day' : 'these days'}. Chats you’re already in stay as they are.</p>
      </ConfirmDialog>
    </>
  );
}
