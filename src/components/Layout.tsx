import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ArcDecor, LogoMark, Wordmark } from './Brand';
import { BRAND } from '@/config/brand';

export function Layout({
  children,
  showHeader = true,
  headerRight,
}: {
  children: ReactNode;
  showHeader?: boolean;
  headerRight?: ReactNode;
}) {
  const { pathname } = useLocation();
  const isShare = pathname.startsWith('/s/');

  return (
    <div className="grain relative flex min-h-[100dvh] flex-col">
      <ArcDecor
        className="pointer-events-none fixed -right-28 -top-28 -z-10 size-[420px] text-orange/25 sm:-right-40 sm:-top-40 sm:size-[560px]"
      />
      <ArcDecor
        className="pointer-events-none fixed -bottom-40 -left-32 -z-10 size-[380px] rotate-45 text-brown/15"
      />

      {showHeader ? (
        <header className="safe-top sticky top-0 z-30 border-b border-line/60 bg-cream/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link
              to={isShare ? '/' : '/'}
              className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 transition-opacity hover:opacity-80"
            >
              <LogoMark size={30} />
              <Wordmark compact />
            </Link>
            <div className="flex shrink-0 items-center gap-2">{headerRight}</div>
          </div>
        </header>
      ) : null}

      <main className="flex-1 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">{children}</div>
      </main>

      {showHeader ? (
        <footer className="border-t border-line/50 bg-cream/70">
          <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6 text-[12px] leading-relaxed text-brown-muted sm:px-6">
            <p className="font-serif text-[13px] tracking-widest text-brown-soft">{BRAND.theme}</p>
            <p>{BRAND.disclaimer}</p>
            <p>
              © {new Date().getFullYear()} {BRAND.name} · v{BRAND.version}
            </p>
          </div>
        </footer>
      ) : null}
    </div>
  );
}