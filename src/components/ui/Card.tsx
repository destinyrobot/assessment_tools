import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`paper rounded-card border border-line/80 shadow-soft ${className}`}
      {...rest}
    />
  );
}

export function SectionTitle({
  index,
  title,
  hint,
  right,
}: {
  index?: string;
  title: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {index ? (
            <span className="rounded-full bg-orange-wash px-2 py-0.5 font-mono text-[11px] tracking-widest text-orange">
              {index}
            </span>
          ) : null}
          <h2 className="font-serif text-lg font-semibold tracking-wide text-ink">{title}</h2>
        </div>
        {hint ? <p className="mt-1 text-[13px] leading-relaxed text-brown-muted">{hint}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function BulletList({
  items,
  className = '',
  marker = 'dot',
}: {
  items: readonly string[];
  className?: string;
  marker?: 'dot' | 'dash' | 'num';
}) {
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((item, i) => (
        <li key={`${item.slice(0, 12)}-${i}`} className="flex gap-2.5 text-[15px] leading-[1.75] text-brown-soft">
          <span aria-hidden className="mt-[0.55em] shrink-0 leading-none">
            {marker === 'num' ? (
              <span className="font-mono text-[12px] text-orange">{String(i + 1).padStart(2, '0')}</span>
            ) : marker === 'dash' ? (
              <span className="block h-px w-3 self-center bg-orange/50" />
            ) : (
              <span className="block size-1.5 rounded-full bg-orange/70" />
            )}
          </span>
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Tag({ children, tone = 'warm' }: { children: ReactNode; tone?: 'warm' | 'plain' }) {
  return (
    <span
      className={
        tone === 'warm'
          ? 'rounded-full border border-orange/25 bg-orange-wash px-3 py-1 text-[13px] text-[#9a5a24]'
          : 'rounded-full border border-line bg-cream-deep/60 px-3 py-1 text-[13px] text-brown-soft'
      }
    >
      {children}
    </span>
  );
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`rule-dotted my-6 ${className}`} />;
}