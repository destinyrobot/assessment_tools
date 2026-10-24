import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-orange text-white shadow-soft hover:bg-[#bd6a29] active:bg-[#a85e23] disabled:bg-orange/50',
  secondary:
    'bg-card text-brown border border-line hover:bg-orange-wash/70 active:bg-orange-wash disabled:opacity-50',
  ghost: 'text-brown-soft hover:bg-orange-wash/60 active:bg-orange-wash disabled:opacity-50',
  danger: 'bg-[#B5565A] text-white hover:bg-[#a04b4f] active:bg-[#8f4347] disabled:opacity-50',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm rounded-xl gap-1.5',
  md: 'h-11 px-5 text-[15px] rounded-2xl gap-2',
  lg: 'h-13 px-7 text-base rounded-2xl gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, block = false, icon, children, className = '', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center font-medium tracking-[0.01em]',
        'transition-[background-color,transform,box-shadow] duration-150',
        'active:scale-[0.985] motion-reduce:active:scale-100',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        'select-none touch-manipulation',
        VARIANTS[variant],
        SIZES[size],
        block ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      <span>{children}</span>
    </button>
  );
});

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}