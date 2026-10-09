import type { DocumentData } from 'firebase/firestore';
import { CalendarDays, CloudUpload } from 'lucide-react';
import { DateTime } from 'luxon';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { TopBar } from '../components/AppChrome';
import { DayScroller } from '../components/DayScroller';
import { HourScroller } from '../components/HourScroller';
import { ConfirmDialog } from '../components/Sheet';
import { InlineError, Spinner } from '../components/ui';
import { db } from '../firebase';
import { MAX_RANGES_PER_DAY, TOO_MANY_RANGES } from '../lib/availability';
import type { AvailabilityEntry } from '../lib/matching';
import {
  addMonths,
  applyRuleChange,
  dateRange,
  dayFreeFromEntry,
  formatMonth,
  horizonEnd,
  monthDates,
  monthOf,
  normalizeRules,
  planWrites,
  rulesOn,
  weekdayName,
  weekdayOf,
  type DayFree,
  type Span,
  type WeeklyRule,
} from '../lib/slots';
import { DATE_RE, addDays, formatLongDay, todayIn } from '../lib/time';
import { writeDays } from '../services/availability';
import { errorMessage } from '../services/errors';
import { consentFields } from '../services/profiles';
import { useData } from '../state/data';
import { useNow, useOnline } from '../state/hooks';
import { hasSeenTip, markTipSeen } from '../state/local';
import { useReadySession } from '../state/session';
import { useToast } from '../state/toast';
import { SlotSheet, type SlotEdit } from './SlotSheet';

export const CONSENT_TEXT =
  'Your display name and published availability are visible to other signed-in users. People with matching availability can add you directly to a group chat. You can leave any group at any time.';

const NEXT_30 = 'next';
const NEXT_DAYS = 30;
/** Taps on the same day within this window are saved together. */
const SAVE_DELAY_MS = 400;
const TIP = 'hour-grid';

type Change = { date: string; day: DayFree };

const sameRule = (a: WeeklyRule, b: WeeklyRule) => a.weekday === b.weekday && a.start === b.start && a.end === b.end;

/**
 * Edits show immediately as local overrides and are written shortly after.
 * Firestore's own latency compensation then shows the write, so an override
 * is dropped once its save settles, unless a newer edit replaced it.
 */
function useDaySaver(uid: string, tz: string, byDate: Map<string, AvailabilityEntry>) {
  const toast = useToast();
  const [overrides, setOverrides] = useState<Record<string, DayFree>>({});
  const [saving, setSaving] = useState(0);
  const timers = useRef(new Map<string, number>());
  const versions = useRef(new Map<string, number>());
  const stored = useRef(byDate);
  const current = useRef(overrides);
  useLayoutEffect(() => {
    stored.current = byDate;
    current.current = overrides;
  });

  const stage = useCallback((changes: readonly Change[]): number[] => {
    const tokens = changes.map(({ date }) => {
      window.clearTimeout(timers.current.get(date));
      timers.current.delete(date);
      const v = (versions.current.get(date) ?? 0) + 1;
      versions.current.set(date, v);
      return v;
    });
    setOverrides((o) => {
      const next = { ...o };
      for (const c of changes) next[c.date] = c.day;
      return next;
    });
    return tokens;
  }, []);

  const release = useCallback((changes: readonly Change[], tokens: readonly number[]) => {
    setOverrides((o) => {
      const next = { ...o };
      changes.forEach((c, i) => {
        if (versions.current.get(c.date) === tokens[i]) delete next[c.date];
      });
      return next;
    });
  }, []);

  const flush = useCallback(
    async (changes: readonly Change[], tokens: readonly number[], settings?: DocumentData): Promise<boolean> => {
      const plan = planWrites(
        uid,
        tz,
        Date.now(),
        changes.map((c) => ({ date: c.date, before: dayFreeFromEntry(stored.current.get(c.date)), after: c.day, exists: stored.current.has(c.date) })),
      );
      if (!plan.ok) {
        toast(plan.error, 'error');
        release(changes, tokens);
        return false;
      }
      if (plan.value.length === 0 && !settings) {
        release(changes, tokens);
        return true;
      }
      setSaving((n) => n + 1);
      try {
        await writeDays(db, uid, plan.value, settings);
        return true;
      } catch (err) {
        toast(errorMessage(err), 'error');
        return false;
      } finally {
        setSaving((n) => n - 1);
        release(changes, tokens);
      }
    },
    [uid, tz, toast, release],
  );

  /** A grid edit: shown at once, saved shortly after the last change to that day. */
  const edit = useCallback(
    (date: string, day: DayFree) => {
      const [token] = stage([{ date, day }]);
      timers.current.set(
        date,
        window.setTimeout(() => {
          timers.current.delete(date);
          void flush([{ date, day }], [token]);
        }, SAVE_DELAY_MS),
      );
    },
    [stage, flush],
  );

  /** Shown but not saved (waiting for consent). */
  const hold = useCallback((date: string, day: DayFree) => void stage([{ date, day }]), [stage]);

  const saveNow = useCallback(
    (changes: readonly Change[], settings?: DocumentData) => flush(changes, stage(changes), settings),
    [stage, flush],
  );

  const saveHeld = useCallback(
    (settings?: DocumentData) => saveNow(Object.entries(current.current).map(([date, day]) => ({ date, day })), settings),
    [saveNow],
  );

  const discard = useCallback(() => {
    for (const t of timers.current.values()) window.clearTimeout(t);
    timers.current.clear();
    for (const date of Object.keys(current.current)) versions.current.set(date, (versions.current.get(date) ?? 0) + 1);
    setOverrides({});
  }, []);

  const dayOf = useCallback((date: string) => overrides[date] ?? dayFreeFromEntry(byDate.get(date)), [overrides, byDate]);

  return { dayOf, saving: saving > 0, edit, hold, saveNow, saveHeld, discard };
}

interface PendingConsent {
  run: () => Promise<boolean>;
  cancel: () => void;
}

export function AvailabilityScreen() {
  const { user, settings } = useReadySession();
  const tz = settings.timezone;
  const { myEntries, myEntriesState, myEntriesError, retry } = useData();
  const online = useOnline();
  const toast = useToast();
  const now = useNow();
  const today = todayIn(tz, now);
  const lastDay = horizonEnd(today);
  const [params] = useSearchParams();

  const [selectedRaw, setSelected] = useState(() => {
    const d = params.get('date');
    return d && DATE_RE.test(d) && d >= today && d <= lastDay ? d : today;
  });
  // After midnight, a day that just passed can't stay selected.
  const selected = selectedRaw < today ? today : selectedRaw;
  const [filter, setFilter] = useState(() => (selected > addDays(today, NEXT_DAYS - 1) ? monthOf(selected) : NEXT_30));

  const months = useMemo(() => {
    const out: string[] = [];
    for (let m = monthOf(today); m <= monthOf(lastDay); m = addMonths(m, 1)) out.push(m);
    return out;
  }, [today, lastDay]);
  const days = useMemo(() => (filter === NEXT_30 ? dateRange(today, addDays(today, NEXT_DAYS - 1)) : monthDates(filter)), [filter, today]);
  const isDisabled = useCallback((date: string) => date < today || date > lastDay, [today, lastDay]);

  const byDate = useMemo(() => new Map(myEntries.map((e) => [e.date, e])), [myEntries]);
  const saver = useDaySaver(user.uid, tz, byDate);
  const hasConsented = settings.publishConsentAt !== null;
  const [consent, setConsent] = useState<PendingConsent | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [slotHour, setSlotHour] = useState<number | null>(null);
  const [showTip, setShowTip] = useState(() => !hasSeenTip(TIP));

  const changeFilter = (value: string) => {
    setFilter(value);
    if (value === NEXT_30) setSelected(today);
    else setSelected(`${value}-01` < today ? today : `${value}-01`);
  };

  /** Runs `action` now, or after the one-time publishing consent. */
  const withConsent = (action: (settings?: DocumentData) => Promise<boolean>): Promise<boolean> => {
    if (hasConsented) return action();
    return new Promise((resolve) =>
      setConsent({
        run: async () => {
          const ok = await action(consentFields());
          resolve(ok);
          return ok;
        },
        cancel: () => resolve(false),
      }),
    );
  };

  const onDayChange = (next: DayFree) => {
    if (!online) {
      toast('You’re offline. Connect to change your free time.', 'error');
      return;
    }
    if (next.spans.length > MAX_RANGES_PER_DAY) {
      toast(TOO_MANY_RANGES, 'info');
      return;
    }
    if (hasConsented) {
      saver.edit(selected, next);
      return;
    }
    // Never publish without explicit consent the first time.
    saver.hold(selected, next);
    void withConsent((extra) => saver.saveHeld(extra)).then((ok) => {
      if (!ok) saver.discard();
    });
  };

  const weekday = weekdayOf(selected);
  const repeats = useMemo<Span[]>(() => rulesOn(settings.weekly, weekday), [settings.weekly, weekday]);
  const upcomingOnWeekday = () => dateRange(today, lastDay).filter((d) => weekdayOf(d) === weekday);

  /**
   * Saves the slot sheet: this day gets the new time in place of the old one.
   * Repeating writes it onto every upcoming same weekday too; unticking an
   * existing repeat takes it off the other days but leaves this one.
   */
  const saveSlot = ({ original, span, repeat, rule }: SlotEdit): Promise<boolean> => {
    if (!online) {
      toast('You’re offline. Connect to save.', 'error');
      return Promise.resolve(false);
    }
    const thisDay = applyRuleChange(saver.dayOf(selected), original, span);
    if (thisDay.spans.length > MAX_RANGES_PER_DAY) {
      toast(TOO_MANY_RANGES, 'info');
      return Promise.resolve(false);
    }
    return withConsent(async (extra) => {
      const weeklyChanged = repeat || rule !== null;
      const others = weeklyChanged
        ? upcomingOnWeekday()
            .filter((date) => date !== selected)
            .map((date) => ({ date, day: applyRuleChange(saver.dayOf(date), rule, repeat ? span : null) }))
        : [];
      const settingsPatch = weeklyChanged
        ? {
            weekly: normalizeRules([...settings.weekly.filter((r) => !rule || !sameRule(r, rule)), ...(repeat ? [{ weekday, ...span }] : [])]),
            // The first repeat starts the record; later ones leave the top-up's bookmark alone.
            ...(repeat && settings.weeklyThrough === null ? { weeklyThrough: lastDay } : {}),
            ...extra,
          }
        : extra;
      const ok = await saver.saveNow([{ date: selected, day: thisDay }, ...others], settingsPatch);
      if (ok) toast(repeat ? `Repeats every ${weekdayName(weekday)}.` : rule ? 'Stopped repeating.' : 'Saved.');
      return ok;
    });
  };

  const dismissTip = useCallback(() => {
    setShowTip(false);
    markTipSeen(TIP);
  }, []);

  const firstOpenHour = selected === today ? DateTime.fromMillis(now, { zone: tz }).hour : 0;
  const day = saver.dayOf(selected);

  return (
    <main className="screen screen--planner">
      <TopBar>
        <label className="month-filter">
          <CalendarDays size={16} strokeWidth={2.25} aria-hidden="true" />
          <span className="sr-only">Show days</span>
          <select value={filter} onChange={(e) => changeFilter(e.target.value)}>
            <option value={NEXT_30}>Next 30 days</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </label>
        {saver.saving && (
          <span className="save-status" role="status">
            <CloudUpload size={16} aria-hidden="true" /> Saving…
          </span>
        )}
      </TopBar>

      <div className="planner">
        <DayScroller
          days={days}
          selected={selected}
          today={today}
          isDisabled={isDisabled}
          dayOf={saver.dayOf}
          onSelect={setSelected}
          resetKey={filter}
        />

        <section className="planner-hours" aria-label={`Free time on ${formatLongDay(selected)}`}>
          <h2 className="planner-day">{formatLongDay(selected)}</h2>
          {myEntriesState === 'error' ? (
            <InlineError message={myEntriesError ?? 'Couldn’t load your availability.'} onRetry={retry} />
          ) : myEntriesState === 'loading' ? (
            <Spinner label="Loading your availability" />
          ) : (
            <HourScroller
              day={day}
              firstOpenHour={firstOpenHour}
              repeats={repeats}
              onChange={onDayChange}
              onMore={setSlotHour}
              showTip={showTip}
              onTipSeen={dismissTip}
            />
          )}
        </section>
      </div>

      <SlotSheet
        open={slotHour !== null}
        date={selected}
        hour={slotHour}
        day={day}
        rules={settings.weekly}
        onClose={() => setSlotHour(null)}
        onSave={saveSlot}
      />

      <ConfirmDialog
        open={consent !== null}
        title="Before you publish"
        confirmLabel="I understand, publish"
        cancelLabel="Not now"
        busy={consentBusy}
        onConfirm={async () => {
          if (!consent) return;
          setConsentBusy(true);
          await consent.run();
          setConsentBusy(false);
          setConsent(null);
        }}
        onCancel={() => {
          consent?.cancel();
          setConsent(null);
        }}
      >
        <p>{CONSENT_TEXT}</p>
      </ConfirmDialog>
    </main>
  );
}
