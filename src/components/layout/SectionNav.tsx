import { NavLink } from 'react-router-dom';
import { cn } from '@/components/ui/cn';
import { useProgress } from '@/stores/progressStore';

const LINKS = [
  { to: '/profile', label: 'Profile' },
  { to: '/locker', label: 'Locker' },
  { to: '/friends', label: 'Friends' },
  { to: '/leaderboards', label: 'Leaderboards' },
];

/** The row of links shared by the profile pages, so each one leads to the others. */
export function SectionNav() {
  const requests = useProgress((s) => s.me?.friend_requests ?? 0);
  return (
    <nav aria-label="Your pages" className="-mx-1 mb-5 flex gap-1 overflow-x-auto pb-1">
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end
          className={({ isActive }) =>
            cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
              isActive ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:border-white/20 hover:text-ivory',
            )
          }
        >
          {l.label}
          {l.to === '/friends' && requests > 0 && <span className="ml-1.5 rounded-full bg-gold-500 px-1.5 text-xs font-bold text-ink-950">{requests}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
