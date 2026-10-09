import type { ReactNode } from 'react';
import { Button } from './Button';
import { ChipIcon } from './ChipIcon';
import { Spinner } from './Spinner';
import { cn } from './cn';

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-10 text-muted', className)}>
      <Spinner className="h-7 w-7 text-gold-400" label={label} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function FullPageLoader({ label = 'Shuffling up…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <ChipIcon className="h-12 w-12 animate-spin-slow" />
      <p className="font-display text-lg text-cream/80">{label}</p>
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 px-4 py-8 text-center', className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ruby-900/60 text-ruby-300">
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
          <path d="M12 7v6m0 4h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
      <p className="font-semibold text-ivory">{title}</p>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  icon,
  action,
  className,
}: {
  title: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-8 text-center', className)}>
      <div className="mb-1 text-gold-400/80">{icon ?? <ChipIcon className="h-9 w-9 opacity-70" color="onyx" />}</div>
      <p className="font-semibold text-ivory">{title}</p>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-white/[0.06]', className)} aria-hidden="true" />;
}
