import { CalendarHeart, ChevronLeft, ChevronRight, Clock, Globe, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { InlineError, ScreenHeader, Spinner, cls } from '../components/ui';
import { describeEntry } from '../lib/describe';
import type { AvailabilityEntry } from '../lib/matching';
import { addDays, dayParts, formatDayLabel, formatLongDay, todayIn } from '../lib/time';
import { useData } from '../state/data';
import { useNow } from '../state/hooks';
import { useReadySession } from '../state/session';
import { DayEditor } from './DayEditor';

const PAGE_DAYS = 14;
/** Twelve weeks ahead; firestore.rules allows up to 100 days. */
const MAX_PAGES = 6;

export function AvailabilityScreen() {
  const { user, settings } = useReadySession();
  const tz = settings.timezone;
  const { myEntries, myEntriesState, myEntriesError, retry } = useData();
  const now = useNow();
  const today = todayIn(tz, now);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);

  const days = useMemo(() => Array.from({ length: PAGE_DAYS }, (_, i) => addDays(today, page * PAGE_DAYS + i)), [today, page]);
  const byDate = useMemo(() => new Map(myEntries.map((e) => [e.date, e])), [myEntries]);
  const visible = days.map((d) => byDate.get(d)).filter((e): e is AvailabilityEntry => Boolean(e));

  const toggle = (date: string) =>
    setSelected((list) => (list.includes(date) ? list.filter((d) => d !== date) : [...list, date].sort()));

  const openFor = (dates: string[]) => {
    setSelected(dates);
    setEditorOpen(true);
  };

  const closeEditor = (done: boolean) => {
    setEditorOpen(false);
    if (done) setSelected([]);
  };

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="Availability"
        icon={CalendarHeart}
        title={
          <>
            When are you <span className="grad-text">free</span>?
          </>
        }
        subtitle="Tap one or more days, then set your free time. Nothing is shared until you publish."
      />

      <section className="card calendar-card" aria-label="Two-week calendar">
        <div className="calendar-nav">
          <button type="button" className="icon-btn" onClick={() => setPage((p) => p - 1)} disabled={page === 0} aria-label="Previous two weeks">
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <div className="calendar-range" aria-live="polite">
            {formatDayLabel(days[0])} – {formatDayLabel(days[days.length - 1])}
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setPage((p) => p + 1)}
            disabled={page === MAX_PAGES - 1}
            aria-label="Next two weeks"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        </div>

        <div className="calendar-grid">
          {days.map((date) => {
            const entry = byDate.get(date);
            const isSelected = selected.includes(date);
            const { weekday, day } = dayParts(date);
            const status = entry ? (entry.kind === 'flexible' ? 'free, time flexible' : 'free during set hours') : 'not set';
            return (
              <button
                key={date}
                type="button"
                className={cls('day', entry && `day--${entry.kind}`, isSelected && 'is-selected', date === today && 'is-today')}
                aria-pressed={isSelected}
                aria-label={`${formatLongDay(date)}${date === today ? ' (today)' : ''}: ${status}`}
                onClick={() => toggle(date)}
              >
                <span className="day-weekday">{weekday}</span>
                <span className="day-num">{day}</span>
                <span className="day-status" aria-hidden="true">
                  {entry?.kind === 'flexible' && <Sparkles size={15} strokeWidth={2.5} />}
                  {entry?.kind === 'hours' && <Clock size={15} strokeWidth={2.5} />}
                  {!entry && <span className="day-dot" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="legend" aria-hidden="true">
          <span>
            <span className="legend-swatch legend-swatch--flexible">
              <Sparkles size={12} strokeWidth={2.5} />
            </span>
            Time flexible
          </span>
          <span>
            <span className="legend-swatch legend-swatch--hours">
              <Clock size={12} strokeWidth={2.5} />
            </span>
            Specific hours
          </span>
        </div>
      </section>

      <section className="stack">
        <h2 className="section-title">Published for these dates</h2>
        {myEntriesState === 'loading' && <Spinner label="Loading your availability" />}
        {myEntriesState === 'error' && <InlineError message={myEntriesError ?? 'Couldn’t load your availability.'} onRetry={retry} />}
        {myEntriesState === 'ready' && visible.length === 0 && (
          <p className="muted">Nothing published here yet. Select days above to add your free time.</p>
        )}
        {visible.length > 0 && (
          <ul className="pub-list stagger">
            {visible.map((entry) => (
              <li key={entry.id}>
                <button type="button" className="pub-row" onClick={() => openFor([entry.date])}>
                  <span className={cls('pub-icon', `pub-icon--${entry.kind}`)} aria-hidden="true">
                    {entry.kind === 'flexible' ? <Sparkles size={18} /> : <Clock size={18} />}
                  </span>
                  <span className="pub-text">
                    <strong>{formatDayLabel(entry.date)}</strong>
                    <span>{describeEntry(entry)}</span>
                    {entry.tz !== tz && (
                      <span className="tz-note">
                        <Globe size={12} aria-hidden="true" /> Set in {entry.tz.replace(/_/g, ' ')}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={18} className="pub-chevron" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected.length > 0 && !editorOpen && (
        <div className="selection-bar" role="region" aria-label="Selected days">
          <span className="selection-count">
            <strong>{selected.length}</strong> {selected.length === 1 ? 'day' : 'days'} selected
          </span>
          <button type="button" className="icon-btn icon-btn--on-dark" onClick={() => setSelected([])} aria-label="Clear selection">
            <X size={20} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditorOpen(true)}>
            Set free time
          </button>
        </div>
      )}

      <DayEditor
        open={editorOpen}
        dates={selected}
        entries={selected.map((d) => byDate.get(d)).filter((e): e is AvailabilityEntry => Boolean(e))}
        uid={user.uid}
        tz={tz}
        hasConsented={settings.publishConsentAt !== null}
        onClose={closeEditor}
      />
    </main>
  );
}
