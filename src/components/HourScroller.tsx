import { Check, ChevronDown, ChevronUp, Ellipsis, Hand, Repeat } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  DAY_MINUTES,
  EMPTY_DAY,
  HOURS,
  SLOT_FREE_MINUTES,
  WHOLE_DAY,
  formatHour,
  formatHourRange,
  formatSpanLabel,
  hourCoverage,
  setHours,
  type DayFree,
  type Span,
} from '../lib/slots';
import { cls } from './ui';

export const SLOT_H = 56;
const FOCUS_HOUR = 6;
const LONG_PRESS_MS = 300;
/** Movement before a long-press fires means the finger is scrolling. */
const SLOP_PX = 10;
/** Dragging this close to an edge scrolls the grid. */
const EDGE_PX = 56;
const MAX_AUTOSCROLL_PX = 22;
const HOUR_LIST = Array.from({ length: HOURS }, (_, h) => h);

interface Drag {
  anchor: number;
  current: number;
  /** Painting free time, or erasing it — decided by the slot the drag started on. */
  free: boolean;
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  hour: number;
  timer: number;
}

interface Props {
  day: DayFree;
  /** Hours before this one have already passed (today only). */
  firstOpenHour: number;
  /** Weekly repeats on this weekday, in minutes. */
  repeats: readonly Span[];
  onChange: (next: DayFree) => void;
  onMore: (hour: number) => void;
  showTip: boolean;
  onTipSeen: () => void;
}

const isFree = (minutes: number) => minutes >= SLOT_FREE_MINUTES;

function dragRange(d: Drag, firstOpenHour: number): [number, number] {
  return [Math.max(firstOpenHour, Math.min(d.anchor, d.current)), Math.max(d.anchor, d.current) + 1];
}

/**
 * A scrollable 24-hour day of one-hour slots. Tap toggles one hour;
 * long-press then drag paints (or erases) a range. Mouse users can drag
 * straight away. Gesture state lives in refs, so a drag only re-renders
 * when the pointer crosses into a different hour.
 */
export function HourScroller({ day, firstOpenHour, repeats, onChange, onMore, showTip, onTipSeen }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(false);
  const [atBottom, setAtBottom] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);

  const gesture = useRef<Gesture | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastY = useRef(0);
  const frame = useRef(0);
  // Handlers outlive renders; read the latest props through this.
  const live = useRef({ day, firstOpenHour, onChange, onTipSeen });
  useLayoutEffect(() => {
    live.current = { day, firstOpenHour, onChange, onTipSeen };
  });

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = FOCUS_HOUR * SLOT_H;
  }, []);

  // Chevrons show only when there's more to scroll that way.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !topRef.current || !bottomRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === topRef.current) setAtTop(entry.isIntersecting);
          else setAtBottom(entry.isIntersecting);
        }
      },
      { root },
    );
    io.observe(topRef.current);
    io.observe(bottomRef.current);
    return () => io.disconnect();
  }, []);

  // While dragging, stop the finger from scrolling the grid. React's touch
  // listeners are passive, so this one is attached by hand.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (dragRef.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => {
      el.removeEventListener('touchmove', block);
      if (gesture.current) window.clearTimeout(gesture.current.timer);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const hourAt = (clientY: number): number => {
    const rect = gridRef.current!.getBoundingClientRect();
    return Math.min(HOURS - 1, Math.max(0, Math.floor((clientY - rect.top) / SLOT_H)));
  };

  const startDrag = (hour: number) => {
    const d = { anchor: hour, current: hour, free: !isFree(hourCoverage(live.current.day)[hour]) };
    dragRef.current = d;
    setDrag(d);
  };

  const followPointer = () => {
    const d = dragRef.current;
    if (!d) return;
    const hour = Math.max(live.current.firstOpenHour, hourAt(lastY.current));
    if (hour !== d.current) {
      dragRef.current = { ...d, current: hour };
      setDrag(dragRef.current);
    }
  };

  const autoScroll = () => {
    cancelAnimationFrame(frame.current);
    const step = () => {
      const el = scrollRef.current;
      if (!el || !dragRef.current) return;
      const { top, bottom } = el.getBoundingClientRect();
      const y = lastY.current;
      const raw = y < top + EDGE_PX ? (y - top - EDGE_PX) / 3 : y > bottom - EDGE_PX ? (y - bottom + EDGE_PX) / 3 : 0;
      if (raw === 0) return;
      el.scrollTop += Math.max(-MAX_AUTOSCROLL_PX, Math.min(MAX_AUTOSCROLL_PX, raw));
      followPointer();
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  const finish = (commit: boolean) => {
    const g = gesture.current;
    const d = dragRef.current;
    if (g) window.clearTimeout(g.timer);
    cancelAnimationFrame(frame.current);
    gesture.current = null;
    dragRef.current = null;
    if (d) setDrag(null);
    if (!commit) return;
    const { day: current, firstOpenHour: open, onChange: change, onTipSeen: tipSeen } = live.current;
    if (d) {
      const [from, to] = dragRange(d, open);
      if (to > from) change(setHours(current, from, to, d.free));
      if (to - from > 1) tipSeen();
    } else if (g) {
      change(setHours(current, g.hour, g.hour + 1, !isFree(hourCoverage(current)[g.hour])));
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (gesture.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as Element).closest('.slot-more')) return;
    const hour = hourAt(e.clientY);
    if (hour < live.current.firstOpenHour) return;
    lastY.current = e.clientY;
    const g: Gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, hour, timer: 0 };
    gesture.current = g;
    if (e.pointerType === 'mouse') {
      e.currentTarget.setPointerCapture(e.pointerId);
      startDrag(hour);
      return;
    }
    g.timer = window.setTimeout(() => {
      if (gesture.current !== g) return;
      startDrag(hour);
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    lastY.current = e.clientY;
    if (!dragRef.current) {
      // Moved before the long-press: it's a scroll, not a selection.
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > SLOP_PX) {
        window.clearTimeout(g.timer);
        gesture.current = null;
      }
      return;
    }
    followPointer();
    autoScroll();
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id === e.pointerId) finish(true);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id === e.pointerId) finish(false);
  };

  // Keyboard users toggle through the slot buttons; pointer clicks are handled above.
  const toggleHour = useCallback((hour: number) => {
    const { day: current, onChange: change } = live.current;
    change(setHours(current, hour, hour + 1, !isFree(hourCoverage(current)[hour])));
  }, []);

  const shown = useMemo(() => {
    if (!drag) return day;
    const [from, to] = dragRange(drag, firstOpenHour);
    return setHours(day, from, to, drag.free);
  }, [day, drag, firstOpenHour]);
  const coverage = useMemo(() => hourCoverage(shown), [shown]);
  const repeatHours = useMemo(
    () => HOUR_LIST.map((h) => repeats.some((r) => Math.min(r.end, (h + 1) * 60) - Math.max(r.start, h * 60) >= SLOT_FREE_MINUTES)),
    [repeats],
  );

  const scrollByPage = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ top: dir * Math.round(el.clientHeight * 0.7), behavior: 'smooth' });
  };

  return (
    <div className="hours">
      <div className="hours-view">
        <div className="hours-scroll" ref={scrollRef}>
          <div ref={topRef} className="hours-sentinel" />
          <div
            ref={gridRef}
            className={cls('hours-grid', drag && 'is-dragging')}
            style={{ height: HOURS * SLOT_H }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={(e) => e.preventDefault()}
          >
            {shown.spans.map((s) => {
              const start = Math.max(0, s.start);
              const end = Math.min(DAY_MINUTES, s.end);
              return (
                <div
                  key={`${s.start}-${s.end}`}
                  className={cls('hours-block', shown.wholeDay && 'hours-block--day')}
                  style={{ top: (start / 60) * SLOT_H, height: ((end - start) / 60) * SLOT_H }}
                  aria-hidden="true"
                >
                  <span className="hours-block-label">{shown.wholeDay ? 'Free all day' : formatSpanLabel(start, end)}</span>
                </div>
              );
            })}
            {HOUR_LIST.map((h) => (
              <HourRow
                key={h}
                hour={h}
                free={isFree(coverage[h])}
                past={h < firstOpenHour}
                repeat={repeatHours[h]}
                actions={!drag}
                onMore={onMore}
                onToggle={toggleHour}
              />
            ))}
          </div>
          <div ref={bottomRef} className="hours-sentinel" />
        </div>

        <button
          type="button"
          className={cls('hours-chevron hours-chevron--up', !atTop && 'is-shown')}
          onClick={() => scrollByPage(-1)}
          aria-label="Earlier hours"
          tabIndex={atTop ? -1 : 0}
        >
          <ChevronUp size={20} strokeWidth={2.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cls('hours-chevron hours-chevron--down', !atBottom && 'is-shown')}
          onClick={() => scrollByPage(1)}
          aria-label="Later hours"
          tabIndex={atBottom ? -1 : 0}
        >
          <ChevronDown size={20} strokeWidth={2.5} aria-hidden="true" />
        </button>

        {showTip && (
          <div className="hours-tip" role="status">
            <Hand size={20} aria-hidden="true" />
            <span>
              <strong>Long-press, then drag</strong> to select your free time. Tap an hour to toggle just that hour.
            </span>
            <button type="button" className="btn btn-sm btn-primary" onClick={onTipSeen}>
              Got it
            </button>
          </div>
        )}
      </div>

      <label className={cls('check-row', day.wholeDay && 'is-checked')}>
        <input
          type="checkbox"
          className="sr-only"
          checked={day.wholeDay}
          onChange={(e) => onChange(e.target.checked ? WHOLE_DAY : EMPTY_DAY)}
        />
        <span className="check-row-box" aria-hidden="true">
          <Check size={12} strokeWidth={3.5} />
        </span>
        I am free whole day
      </label>
    </div>
  );
}

const HourRow = memo(function HourRow({
  hour,
  free,
  past,
  repeat,
  actions,
  onMore,
  onToggle,
}: {
  hour: number;
  free: boolean;
  past: boolean;
  repeat: boolean;
  actions: boolean;
  onMore: (hour: number) => void;
  onToggle: (hour: number) => void;
}) {
  const range = formatHourRange(hour, hour + 1);
  return (
    <div className={cls('slot-row', free && 'is-free', past && 'is-past')} style={{ height: SLOT_H }}>
      <span className="slot-label" aria-hidden="true">
        {formatHour(hour)}
      </span>
      <button
        type="button"
        className="slot"
        aria-pressed={free}
        aria-label={`${range}${repeat ? ', repeats weekly' : ''}`}
        disabled={past}
        onClick={(e) => {
          if (e.detail === 0) onToggle(hour);
        }}
      />
      {free && (repeat || (actions && !past)) && (
        <span className="slot-icons">
          {repeat && <Repeat size={14} strokeWidth={2.5} className="slot-repeat" aria-hidden="true" />}
          {actions && !past && (
            <button type="button" className="slot-more" aria-label={`Edit ${range}`} onClick={() => onMore(hour)}>
              <Ellipsis size={18} strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </span>
      )}
    </div>
  );
});
