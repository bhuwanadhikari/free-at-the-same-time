import { Check, Repeat } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { cls } from '../components/ui';
import {
  DAY_MINUTES,
  HOURS,
  formatDuration,
  formatHour,
  ruleAt,
  weekdayName,
  weekdayOf,
  type DayFree,
  type Span,
  type WeeklyRule,
} from '../lib/slots';
import { formatDayLabel, formatLongDay } from '../lib/time';

export interface SlotEdit {
  /** The time the sheet opened with; it's replaced by `span` on this day. */
  original: Span;
  span: Span;
  /** Repeat `span` every week on this weekday. */
  repeat: boolean;
  /** The weekly repeat the sheet opened with, if any. */
  rule: WeeklyRule | null;
}

interface Props {
  open: boolean;
  date: string;
  hour: number | null;
  day: DayFree;
  rules: readonly WeeklyRule[];
  onClose: () => void;
  /** Resolves true once saved. */
  onSave: (edit: SlotEdit) => Promise<boolean>;
}

/** Edit one block of free time, and whether it repeats weekly. Nothing changes until Save. */
export function SlotSheet(props: Props) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title={formatLongDay(props.date)}>
      {/* Remount per slot so the times start from the tapped hour. */}
      {props.hour !== null && <SlotBody key={`${props.date}-${props.hour}`} {...props} hour={props.hour} />}
    </Sheet>
  );
}

/** The existing repeat at this hour, else the free block around it, else just the hour. */
function initialHours(day: DayFree, rule: WeeklyRule | undefined, hour: number): [number, number] {
  if (rule) return [Math.floor(rule.start / 60), Math.ceil(rule.end / 60)];
  const block = day.spans.find((s) => s.start <= hour * 60 && hour * 60 < s.end);
  if (block) return [Math.floor(block.start / 60), Math.min(HOURS, Math.ceil(Math.min(block.end, DAY_MINUTES) / 60))];
  return [hour, hour + 1];
}

function SlotBody({ date, hour, day, rules, onClose, onSave }: Props & { hour: number }) {
  const weekday = weekdayOf(date);
  const existing = ruleAt(rules, weekday, hour * 60) ?? null;
  const [initialFrom, initialTo] = initialHours(day, existing ?? undefined, hour);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [repeat, setRepeat] = useState(existing !== null);
  const [busy, setBusy] = useState(false);
  const dayName = weekdayName(weekday);
  const changed = from !== initialFrom || to !== initialTo || repeat !== (existing !== null);

  const save = async () => {
    setBusy(true);
    const ok = await onSave({
      original: { start: initialFrom * 60, end: initialTo * 60 },
      span: { start: from * 60, end: to * 60 },
      repeat,
      rule: existing,
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <>
      <p className="repeat-sentence">
        I’m free from{' '}
        <select
          className="repeat-select"
          aria-label="From"
          value={from}
          onChange={(e) => {
            const next = Number(e.target.value);
            setFrom(next);
            if (to <= next) setTo(next + 1);
          }}
        >
          {Array.from({ length: HOURS }, (_, h) => (
            <option key={h} value={h}>
              {formatHour(h)}
            </option>
          ))}
        </select>{' '}
        to{' '}
        <select className="repeat-select" aria-label="To" value={to} onChange={(e) => setTo(Number(e.target.value))}>
          {Array.from({ length: HOURS - from }, (_, i) => from + i + 1).map((h) => (
            <option key={h} value={h}>
              {h === HOURS ? 'midnight' : formatHour(h)}
            </option>
          ))}
        </select>
      </p>

      <label className={cls('check-row', repeat && 'is-checked')}>
        <input type="checkbox" className="sr-only" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
        <span className="check-row-box" aria-hidden="true">
          <Check size={16} strokeWidth={3} />
        </span>
        Every {dayName}
      </label>

      <div className="repeat-meta">
        <span className="repeat-duration">
          {repeat && <Repeat size={16} strokeWidth={2.5} aria-hidden="true" />}
          {formatDuration((to - from) * 60)} {repeat ? `every ${dayName}` : `on ${formatDayLabel(date)}`}
        </span>
        {repeat ? (
          <p className="hint">Adds this time to every upcoming {dayName}. You can still change a single day afterwards.</p>
        ) : (
          existing && <p className="hint">Saving stops this time repeating on other {dayName}s. This day keeps it.</p>
        )}
      </div>

      <button type="button" className="btn btn-primary btn-block" disabled={busy || !changed} aria-busy={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}
