import { useEffect, useRef, useState } from 'react';

/**
 * Numeric field with a draggable label (scrub left/right to change the value),
 * like professional 3D tools. Commits on Enter/blur; Escape reverts.
 */
export function NumberField({
  label,
  value,
  onChange,
  onCommit,
  step = 0.01,
  precision = 3,
  axis,
  suffix,
  disabled,
  min,
}: {
  label: string;
  value: number;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
  step?: number;
  precision?: number;
  axis?: 'x' | 'y' | 'z';
  suffix?: string;
  disabled?: boolean;
  min?: number;
}) {
  const [text, setText] = useState(() => fmt(value, precision));
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  useEffect(() => {
    if (!editing) setText(fmt(value, precision));
  }, [value, precision, editing]);

  const clamp = (v: number) => (min !== undefined ? Math.max(min, v) : v);
  const commitText = () => {
    setEditing(false);
    const v = evalNumber(text);
    if (v === null || !Number.isFinite(v)) {
      setText(fmt(value, precision));
      return;
    }
    if (Math.abs(clamp(v) - value) > 1e-9) onCommit(clamp(v));
    else setText(fmt(value, precision));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 2) d.moved = true;
    if (!d.moved) return;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const v = clamp(d.start + dx * step * mult);
    setText(fmt(v, precision));
    onChange?.(v);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const v = clamp(d.start + (e.clientX - d.x) * step * mult);
    if (Math.abs(v - d.start) > 1e-9) onCommit(v);
  };

  return (
    <label className={`num-field ${axis ?? ''} ${disabled ? 'disabled' : ''}`}>
      <span
        className="num-label"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag to adjust (Shift ×10, Alt ×0.1)"
      >
        {label}
      </span>
      <input
        className="num-input mono"
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(fmt(value, precision));
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1) * 10);
            onCommit(v);
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </label>
  );
}

function fmt(v: number, p: number): string {
  if (!Number.isFinite(v)) return '0';
  let s = v.toFixed(p);
  if (/^-0\.?0*$/.test(s)) s = '0';
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
}

/** Accepts plain numbers and simple arithmetic ("1.5*2", "90/4"). */
function evalNumber(s: string): number | null {
  const t = s.trim().replace(/,/g, '.');
  if (!t) return null;
  if (!/^[-+*/().\d\s eE]+$/.test(t)) return null;
  try {
    const v = Function(`"use strict"; return (${t});`)() as unknown;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function Slider({
  value, min, max, step, onChange, onCommit,
}: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; onCommit?: () => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ['--pct' as string]: `${pct}%` }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
    />
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
  );
}

export function Segmented<T extends string>({
  value, options, onChange, full,
}: { value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`segmented ${full ? 'full' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
