import { forwardRef, useCallback, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { keyLabel, useHotkeys } from '@/lib/hotkeys';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from './cn';
import { Spinner } from './Spinner';

type Variant = 'gold' | 'felt' | 'ruby' | 'outline' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold tracking-wide transition ' +
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
  /** A key that presses this button while it is on screen and enabled (see lib/hotkeys). */
  hotkey?: string | null;
  /** What the shortcut list calls it, when the button's own text will not do. */
  hotkeyLabel?: string;
}

/** The plain button. Nothing here knows about shortcuts, so the hundreds of buttons without one pay nothing for them. */
const PlainButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'hotkey' | 'hotkeyLabel'>>(function PlainButton(
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

/** A button that a key presses while it is on screen and enabled. */
const HotkeyButton = forwardRef<HTMLButtonElement, ButtonProps & { hotkey: string }>(function HotkeyButton({ hotkey, hotkeyLabel, title, ...rest }, ref) {
  const own = useRef<HTMLButtonElement | null>(null);
  // One function for the life of the button: a new one each render would make React detach and re-attach it.
  const setRef = useCallback(
    (el: HTMLButtonElement | null) => {
      own.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  useHotkeys([
    {
      key: hotkey,
      // Listed whenever the button is on screen, even while it cannot be pressed (Deal, before a bet).
      label: () => (own.current && own.current.offsetParent !== null ? (hotkeyLabel ?? own.current.getAttribute('aria-label') ?? own.current.textContent ?? '') : ''),
      run: () => own.current?.click(),
      enabled: () => Boolean(own.current && !own.current.disabled && own.current.offsetParent !== null),
    },
  ]);
  return <PlainButton ref={setRef} title={title ?? `Shortcut: ${keyLabel(hotkey)}`} aria-keyshortcuts={keyLabel(hotkey).replace(/ /g, '')} {...rest} />;
});

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ hotkey, hotkeyLabel, ...rest }, ref) {
  return hotkey ? <HotkeyButton ref={ref} hotkey={hotkey} hotkeyLabel={hotkeyLabel} {...rest} /> : <PlainButton ref={ref} {...rest} />;
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
