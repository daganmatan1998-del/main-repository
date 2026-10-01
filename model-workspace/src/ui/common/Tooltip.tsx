import { cloneElement, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  label: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement<{ onMouseEnter?: (e: React.MouseEvent) => void; onMouseLeave?: (e: React.MouseEvent) => void; onMouseDown?: (e: React.MouseEvent) => void }>;
}

/** Hover tooltip with optional keyboard shortcut; rendered in a portal so panels never clip it. */
export function Tooltip({ label, shortcut, side = 'bottom', children }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const x = side === 'left' ? r.left - 8 : side === 'right' ? r.right + 8 : r.left + r.width / 2;
      const y = side === 'top' ? r.top - 8 : side === 'bottom' ? r.bottom + 8 : r.top + r.height / 2;
      setPos({ x, y });
    }, 380);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };
  const transform =
    side === 'top' ? 'translate(-50%, -100%)' : side === 'bottom' ? 'translate(-50%, 0)' : side === 'left' ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
  return (
    <>
      {cloneElement(children, {
        onMouseEnter: (e: React.MouseEvent) => {
          children.props.onMouseEnter?.(e);
          show(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          children.props.onMouseLeave?.(e);
          hide();
        },
        onMouseDown: (e: React.MouseEvent) => {
          children.props.onMouseDown?.(e);
          hide();
        },
      })}
      {pos &&
        createPortal(
          <div className="tip-bubble" style={{ left: pos.x, top: pos.y, transform }}>
            {label}
            {shortcut && <kbd>{shortcut}</kbd>}
          </div>,
          document.body,
        )}
    </>
  );
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  side?: Props['side'];
}

export function IconButton({ label, shortcut, active, size = 'md', side, className = '', children, ...rest }: IconButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={side}>
      <button
        type="button"
        aria-label={label}
        className={`icon-btn ${size === 'sm' ? 'sm' : ''} ${active ? 'active' : ''} ${className}`}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
