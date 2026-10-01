import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  wide?: boolean;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, subtitle, icon, tone = 'default', wide, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // Focus the first field (or the dialog) for keyboard users.
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, [data-autofocus]');
    (first ?? ref.current)?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          {icon && <div className={`modal-icon ${tone === 'danger' ? 'danger' : ''}`}>{icon}</div>}
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <p className="modal-sub">{subtitle}</p>}
          </div>
          <button className="icon-btn sm modal-close" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
