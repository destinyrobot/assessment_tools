import { BRAND } from '@/config/brand';

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`${BRAND.name} 标识`}
      className="shrink-0"
    >
      <rect width="64" height="64" rx="16" fill="#3A2E26" />
      <path
        d="M14 46 L32 14 L50 46"
        fill="none"
        stroke="#F0C79B"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M23 38 H41" stroke="#D2762F" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="50" r="3.6" fill="#D2762F" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-baseline gap-2 leading-none">
      <span className="font-serif text-[17px] font-semibold tracking-[0.18em] text-ink">
        {BRAND.name}
      </span>
      {!compact ? (
        <span className="font-mono text-[10px] tracking-[0.3em] text-brown-muted">
          {BRAND.englishName}
        </span>
      ) : null}
    </span>
  );
}

/** Decorative arcs used on the entry screen and export card. */
export function ArcDecor({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden
      className={`pointer-events-none absolute select-none ${className}`}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.5">
        <circle cx="100" cy="100" r="94" />
        <circle cx="100" cy="100" r="72" />
        <circle cx="100" cy="100" r="50" />
      </g>
      <circle cx="100" cy="6" r="3" fill="currentColor" opacity="0.7" />
      <circle cx="194" cy="100" r="3" fill="currentColor" opacity="0.7" />
      <circle cx="100" cy="194" r="3" fill="currentColor" opacity="0.7" />
    </svg>
  );
}