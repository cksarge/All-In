import { Link } from 'react-router-dom';
import { cn } from './cn';
import { ChipIcon } from './ChipIcon';

export function Logo({ className, to = '/', compact }: { className?: string; to?: string; compact?: boolean }) {
  return (
    <Link to={to} className={cn('group inline-flex items-center gap-2.5', className)} aria-label="All In home">
      <ChipIcon className="h-8 w-8 transition-transform duration-500 group-hover:rotate-[200deg]" />
      <span className={cn('whitespace-nowrap font-display text-2xl font-bold tracking-tight', compact && 'hidden sm:inline')}>
        <span className="text-ivory">All</span> <span className="gold-text">In</span>
      </span>
    </Link>
  );
}
