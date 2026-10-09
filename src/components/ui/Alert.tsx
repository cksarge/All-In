import type { ReactNode } from 'react';
import { cn } from './cn';

const tones = {
  error: 'border-ruby-400/40 bg-ruby-900/40 text-ruby-300',
  success: 'border-felt-400/40 bg-felt-900/50 text-felt-300',
  info: 'border-gold-500/30 bg-gold-800/20 text-gold-200',
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-xl border px-4 py-3 text-sm leading-relaxed', tones[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5', 'text-cream/85')}>{children}</div>}
    </div>
  );
}
