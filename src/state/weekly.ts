import { useEffect, useRef } from 'react';
import { db } from '../firebase';
import { dateRange, dayFreeFromEntry, horizonEnd, planWrites, rulesOn, setRange, weekdayOf } from '../lib/slots';
import { addDays, todayIn } from '../lib/time';
import { writeDays } from '../services/availability';
import { useData } from './data';
import { useOnline } from './hooks';
import { useReadySession } from './session';

/**
 * Weekly repeats are copied onto concrete dates up to the planning horizon.
 * As days pass, this extends them onto newly reachable dates once per visit.
 * Dates already covered are never touched again, so a one-off change to a
 * single Friday sticks.
 */
export function useWeeklyTopUp(): void {
  const { user, settings } = useReadySession();
  const { myEntries, myEntriesState } = useData();
  const online = useOnline();
  const attempted = useRef<string | null>(null);
  const tz = settings.timezone;
  const today = todayIn(tz);
  const until = horizonEnd(today);

  useEffect(() => {
    if (myEntriesState !== 'ready' || !online) return;
    if (settings.publishConsentAt === null || settings.weekly.length === 0) return;
    if (settings.weeklyThrough !== null && settings.weeklyThrough >= until) return;
    if (attempted.current === until) return;
    attempted.current = until;

    const from = settings.weeklyThrough !== null && settings.weeklyThrough >= today ? addDays(settings.weeklyThrough, 1) : today;
    const byDate = new Map(myEntries.map((e) => [e.date, e]));
    const changes = dateRange(from, until).map((date) => {
      const before = dayFreeFromEntry(byDate.get(date));
      const after = rulesOn(settings.weekly, weekdayOf(date)).reduce((day, r) => setRange(day, r.start, r.end, true), before);
      return { date, before, after, exists: byDate.has(date) };
    });
    const plan = planWrites(user.uid, tz, Date.now(), changes, { skipInvalid: true });
    if (!plan.ok) return;
    writeDays(db, user.uid, plan.value, { weeklyThrough: until }).catch((err) => {
      console.warn('Couldn’t extend weekly repeats', err);
      attempted.current = null;
    });
  }, [myEntriesState, online, settings, myEntries, user.uid, tz, today, until]);
}
