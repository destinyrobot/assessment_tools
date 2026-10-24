export function FullPageLoader({ label = '正在加载…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <span className="relative grid size-12 place-items-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-orange/25 border-t-orange motion-reduce:animate-none" />
        <span className="size-2 rounded-full bg-orange" />
      </span>
      <p className="text-sm tracking-widest text-brown-muted">{label}</p>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-cream-deep/70 motion-reduce:animate-none ${className}`} />;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <svg viewBox="0 0 64 64" className="size-16 text-orange/40" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="32" cy="32" r="22" strokeDasharray="4 6" />
        <path d="M32 20v14l9 6" strokeLinecap="round" />
      </svg>
      <div>
        <p className="font-serif text-lg font-semibold text-ink">{title}</p>
        {body ? <p className="mt-2 max-w-sm text-sm leading-relaxed text-brown-muted">{body}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = '再试一次',
  children,
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <svg viewBox="0 0 64 64" className="size-14 text-[#B5565A]/70" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M32 12l22 40H10z" strokeLinejoin="round" />
        <path d="M32 26v14" strokeLinecap="round" />
        <circle cx="32" cy="45.5" r="1.8" fill="currentColor" stroke="none" />
      </svg>
      <div>
        <p className="font-serif text-lg font-semibold text-ink">{title}</p>
        {body ? <p className="mt-2 max-w-sm text-sm leading-relaxed text-brown-muted">{body}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-2xl bg-orange px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-[#bd6a29]"
          >
            {retryLabel}
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}