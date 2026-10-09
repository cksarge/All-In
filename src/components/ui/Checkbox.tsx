import { useId, type ReactNode } from 'react';
import { cn } from './cn';

export function Checkbox({
  checked,
  onChange,
  children,
  error,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  error?: string | null;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <span className="relative mt-0.5 flex h-5 w-5 shrink-0">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            className={cn(
              'peer h-5 w-5 cursor-pointer appearance-none rounded-md border bg-ink-950/60 transition',
              'checked:border-gold-500 checked:bg-gold-500',
              error ? 'border-ruby-400' : 'border-white/25',
            )}
          />
          <svg
            viewBox="0 0 20 20"
            className="pointer-events-none absolute inset-0 hidden h-5 w-5 text-ink-950 peer-checked:block"
            aria-hidden="true"
          >
            <path d="M5 10.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-sm leading-relaxed text-cream/90">{children}</span>
      </label>
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1.5 pl-8 text-xs font-medium text-ruby-300">
          {error}
        </p>
      )}
    </div>
  );
}
