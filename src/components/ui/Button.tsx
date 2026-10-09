import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from './cn';
import { Spinner } from './Spinner';

type Variant = 'gold' | 'felt' | 'ruby' | 'outline' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold tracking-wide transition ' +
  'duration-150 disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2';

const variants: Record<Variant, string> = {
  gold:
    'text-ink-950 bg-gradient-to-b from-gold-300 via-gold-500 to-gold-600 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_10px_24px_-10px_rgba(212,175,55,0.7)] ' +
    'hover:from-gold-200 hover:via-gold-400 hover:to-gold-500',
  felt:
    'text-ivory bg-gradient-to-b from-felt-500 to-felt-700 border border-felt-400/40 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset] hover:from-felt-400 hover:to-felt-600',
  ruby:
    'text-ivory bg-gradient-to-b from-ruby-500 to-ruby-700 border border-ruby-400/40 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset] hover:from-ruby-400 hover:to-ruby-600',
  outline: 'text-gold-300 border border-gold-500/50 hover:bg-gold-500/10 hover:border-gold-400',
  ghost: 'text-cream/85 hover:text-ivory hover:bg-white/[0.06]',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-5 text-[0.95rem]',
  lg: 'h-13 px-7 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'gold', size = 'md', loading, block, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], block && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" label="Working" /> : icon}
      <span>{children}</span>
    </button>
  );
});

export function ButtonLink({
  variant = 'gold',
  size = 'md',
  block,
  className,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; block?: boolean }) {
  return <Link className={cn(base, variants[variant], sizes[size], block && 'w-full', className)} {...rest} />;
}
