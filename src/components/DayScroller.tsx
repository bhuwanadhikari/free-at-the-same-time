import { memo, useEffect, useRef } from 'react';
import { DAY_MINUTES, summaryLines, type DayFree } from '../lib/slots';
import { dayParts, formatLongDay } from '../lib/time';
import { cls } from './ui';

const MAX_LINES = 2;
const MAX_LINES_SELECTED = 4;

/** A vertical 24-hour bar: free time as solid stripes, drawn with one gradient. */
function barGradient(day: DayFree): string {
  if (day.spans.length === 0) return 'none';
  const pct = (m: number) => `${((Math.min(DAY_MINUTES, Math.max(0, m)) / DAY_MINUTES) * 100).toFixed(2)}%`;
  const stops = day.spans.flatMap((s) => [
    `transparent ${pct(s.start)}`,
    `var(--bar-fill) ${pct(s.start)}`,
    `var(--bar-fill) ${pct(s.end)}`,
    `transparent ${pct(s.end)}`,
  ]);
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

export function DayScroller({
  days,
  selected,
  today,
  isDisabled,
  dayOf,
  onSelect,
  resetKey,
}: {
  days: readonly string[];
  selected: string;
  today: string;
  isDisabled: (date: string) => boolean;
  dayOf: (date: string) => DayFree;
  onSelect: (date: string) => void;
  /** Changes when the list is swapped (e.g. a month filter), scrolling back to the top. */
  resetKey: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [resetKey]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-date="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, resetKey]);

  return (
    <div className="days" ref={listRef} role="group" aria-label="Days">
      {days.map((date, i) => {
        const day = dayOf(date);
        const isSelected = date === selected;
        const lines = summaryLines(day);
        const max = isSelected ? MAX_LINES_SELECTED : MAX_LINES;
        const shown = lines.length > max ? [...lines.slice(0, max - 1), `+${lines.length - max + 1} more`] : lines;
        const newMonth = i > 0 && date.slice(0, 7) !== days[i - 1].slice(0, 7);
        return (
          <DayCard
            key={date}
            date={date}
            selected={isSelected}
            isToday={date === today}
            disabled={isDisabled(date)}
            summary={shown.join('\n')}
            bar={isSelected ? barGradient(day) : null}
            monthBreak={newMonth}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

const DayCard = memo(function DayCard({
  date,
  selected,
  isToday,
  disabled,
  summary,
  bar,
  monthBreak,
  onSelect,
}: {
  date: string;
  selected: boolean;
  isToday: boolean;
  disabled: boolean;
  summary: string;
  bar: string | null;
  monthBreak: boolean;
  onSelect: (date: string) => void;
}) {
  const { weekday, day, month } = dayParts(date);
  const lines = summary ? summary.split('\n') : [];
  return (
    <>
      {monthBreak && (
        <span className="days-month" aria-hidden="true">
          {month}
        </span>
      )}
      <button
        type="button"
        data-date={date}
        className={cls('daycard', selected && 'is-selected', isToday && 'is-today', lines.length > 0 && 'has-free')}
        aria-pressed={selected}
        aria-label={`${formatLongDay(date)}${isToday ? ' (today)' : ''}: ${lines.length ? lines.join(', ') : 'no free time set'}`}
        disabled={disabled}
        onClick={() => onSelect(date)}
      >
        <span className="daycard-text">
          <span className="daycard-head">
            <span className="daycard-wk">{isToday ? 'Today' : weekday}</span>
            <span className="daycard-num">{day}</span>
            <span className="daycard-mo">{month}</span>
          </span>
          {lines.length > 0 && (
            <span className="daycard-free">
              {lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
          )}
        </span>
        {bar !== null && <span className="daycard-bar" style={{ backgroundImage: bar }} aria-hidden="true" />}
      </button>
    </>
  );
});
