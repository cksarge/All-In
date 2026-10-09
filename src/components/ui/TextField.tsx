import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  trailing?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, trailing, className, id, 'aria-describedby': extraDescribedBy, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errId = `${inputId}-err`;
  const describedBy =
    [hint && !error ? hintId : null, error ? errId : null, extraDescribedBy].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-cream/90">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-12 w-full rounded-xl border bg-ink-950/60 px-4 text-[0.97rem] text-ivory placeholder:text-subtle',
            'transition focus:outline-none focus:ring-2',
            error
              ? 'border-ruby-400/70 focus:border-ruby-400 focus:ring-ruby-400/25'
              : 'border-white/10 focus:border-gold-500/70 focus:ring-gold-500/20',
            trailing ? 'pr-12' : undefined,
          )}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div>}
      </div>
      {hint && !error && (
        <div id={hintId} className="text-xs text-muted">
          {hint}
        </div>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-ruby-300">
          {error}
        </p>
      )}
    </div>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type' | 'trailing'>>(
  function PasswordField(props, ref) {
    const [show, setShow] = useState(false);
    return (
      <TextField
        ref={ref}
        type={show ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="off"
        trailing={
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gold-300 hover:bg-white/5"
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        }
        {...props}
      />
    );
  },
);
