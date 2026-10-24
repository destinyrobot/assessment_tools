import { useEffect, useRef, useState } from 'react';
import { subscribeToasts, type ToastItem } from './toast';

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  useEffect(
    () =>
      subscribeToasts((item) => {
        counter.current += 1;
        const id = counter.current;
        setItems((prev) => [...prev.slice(-2), { ...item, id }]);
        window.setTimeout(
          () => setItems((prev) => prev.filter((i) => i.id !== id)),
          item.tone === 'error' ? 6000 : 3200,
        );
      }),
    [],
  );

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="status"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={[
            'animate-rise pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lift backdrop-blur',
            item.tone === 'success'
              ? 'border-accent-green/25 bg-[#f1f5ee]/95 text-[#42563b]'
              : item.tone === 'error'
                ? 'border-[#B5565A]/25 bg-[#fbeeed]/95 text-[#8f4347]'
                : 'border-line bg-card/95 text-brown',
          ].join(' ')}
        >
          <span className="min-w-0 flex-1 leading-relaxed">{item.message}</span>
          {item.action ? (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick();
                setItems((prev) => prev.filter((i) => i.id !== item.id));
              }}
              className="shrink-0 rounded-full border border-current/25 px-3 py-1 text-xs font-medium"
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}