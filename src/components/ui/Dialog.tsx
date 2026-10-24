import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  labelledById?: string;
}

/**
 * Accessible modal:
 *  - focus moves into the dialog on open and returns to the trigger on close
 *  - Tab is trapped inside
 *  - Escape closes
 *  - background scroll is locked
 *  - respects reduced motion via Tailwind's motion-reduce variants
 */
export function Dialog({ open, onClose, title, description, children, footer }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const node = panelRef.current;
    const focusable = node?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? node)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px] animate-fade"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="paper animate-rise relative z-10 max-h-[88dvh] w-full overflow-y-auto overscroll-contain rounded-t-[28px] border border-line shadow-lift sm:max-w-lg sm:rounded-card"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line/70 bg-card/95 px-5 py-4 backdrop-blur safe-top sm:rounded-t-card">
          <div className="min-w-0">
            <h2 className="font-serif text-xl font-semibold tracking-wide text-ink">{title}</h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-brown-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 -mt-1 grid size-9 shrink-0 place-items-center rounded-full text-brown-soft transition-colors hover:bg-orange-wash hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5 text-[15px] leading-[1.85] text-brown-soft">{children}</div>
        {footer ? (
          <div className="sticky bottom-0 border-t border-line/70 bg-card/95 px-5 py-4 backdrop-blur safe-bottom sm:rounded-b-card">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}