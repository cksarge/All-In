import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonLink } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/components/ui/cn';
import { SettingsButton } from '@/components/settings/SettingsModal';
import { useAuth } from '@/stores/authStore';
import { seasonReady } from '@/lib/live';
import { useLive } from '@/stores/liveStore';
import { useDm } from '@/stores/dmStore';
import { useProgress } from '@/stores/progressStore';
import { useUi } from '@/stores/uiStore';
import { BalancePill } from './BalancePill';
import { MusicControl } from './MusicControl';
import { SoundToggle } from './SoundToggle';

const navCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-lg px-3 py-2 text-sm font-medium transition',
    isActive ? 'text-gold-300' : 'text-cream/75 hover:bg-white/[0.05] hover:text-ivory',
  );

function UserMenu() {
  const { profile, signOut } = useAuth();
  const openSettings = useUi((s) => s.openSettings);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const me = useProgress((s) => s.me);
  // A dot on the avatar when something is waiting: rewards to collect or a friend request.
  const unread = useLive((s) => s.unread);
  const rewards = useLive((s) => (s.missions ? s.missions.to_collect + seasonReady(s.missions.season) : 0));
  const messages = useDm((s) => s.unread);
  const waiting = Boolean(me && (me.unclaimed_chips > 0 || me.friend_requests > 0)) || unread > 0 || rewards > 0 || messages > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-10 items-center gap-2 rounded-xl pl-0.5 pr-0.5 transition hover:bg-white/[0.06] md:pl-1 md:pr-2"
      >
        <span className="relative">
          <Avatar username={profile?.username ?? '?'} loadout={me?.loadout} size={34} me />
          {waiting && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900 bg-gold-400" aria-hidden="true" />}
        </span>
        <span className="hidden max-w-28 truncate text-sm font-medium text-cream md:inline">{profile?.username ?? '…'}</span>
        {me && <span className="hidden rounded-full border border-gold-500/40 px-1.5 text-[0.65rem] font-bold tabular-nums text-gold-200 lg:inline">Lv {me.level}</span>}
      </button>
      {open && (
        <div
          role="menu"
          className="surface absolute right-0 top-12 z-40 w-52 overflow-hidden border-white/10 bg-ink-800 p-1.5"
        >
          <p className="truncate px-3 py-2 text-xs text-muted">
            Signed in as <span className="font-semibold text-cream">{profile?.username}</span>
          </p>
          <Link role="menuitem" to="/lounge" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Lounge
          </Link>
          <Link role="menuitem" to="/lobby" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Lobby
          </Link>
          <Link role="menuitem" to="/tournaments" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Tournaments
          </Link>
          <Link role="menuitem" to="/missions" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Missions
            {rewards > 0 && <span className="ml-2 text-xs text-gold-300">rewards waiting</span>}
          </Link>
          <Link role="menuitem" to="/practice" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Practice
          </Link>
          <Link role="menuitem" to="/inbox" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Inbox
            {unread > 0 && <span className="ml-2 rounded-full bg-gold-500 px-1.5 text-xs font-bold text-ink-950">{unread}</span>}
          </Link>
          <Link role="menuitem" to="/profile" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Profile
            {me && me.unclaimed_chips > 0 && <span className="ml-2 text-xs text-gold-300">rewards waiting</span>}
          </Link>
          <Link role="menuitem" to="/locker" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Locker
          </Link>
          <Link role="menuitem" to="/friends" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Friends
            {me && me.friend_requests + messages > 0 && <span className="ml-2 rounded-full bg-gold-500 px-1.5 text-xs font-bold text-ink-950">{me.friend_requests + messages}</span>}
          </Link>
          <Link role="menuitem" to="/clubs" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Clubs
          </Link>
          <Link role="menuitem" to="/leaderboards" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            Leaderboards
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              openSettings();
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.06]"
          >
            Settings
          </button>
          <Link role="menuitem" to="/how-chips-work" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/[0.06]">
            How chips work
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ruby-300 hover:bg-white/[0.06]"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

/** The bell in the top bar (wide screens; on a phone the inbox is in the account menu). */
function InboxBell() {
  const unread = useLive((s) => s.unread);
  return (
    <Link
      to="/inbox"
      aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
      className="relative hidden h-10 w-10 items-center justify-center rounded-xl text-cream/80 transition hover:bg-white/[0.06] hover:text-ivory sm:flex"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute right-1 top-1 min-w-4 rounded-full bg-gold-500 px-1 text-center text-[0.6rem] font-bold leading-4 text-ink-950" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

export function SiteHeader() {
  const status = useAuth((s) => s.status);
  const signedIn = status === 'signedIn';

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/80 backdrop-blur-md">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-gold-500 focus:px-3 focus:py-2 focus:text-ink-950"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-1 px-3 xs:gap-2 sm:gap-3 sm:px-4">
        <Logo to={signedIn ? '/lounge' : '/'} compact={signedIn} className="mr-auto sm:mr-4" />
        <nav aria-label="Main" className="mr-auto hidden items-center gap-1 sm:flex">
          {signedIn && (
            <>
              <NavLink to="/lounge" className={navCls}>
                Lounge
              </NavLink>
              <NavLink to="/lobby" className={navCls}>
                Lobby
              </NavLink>
              <NavLink to="/tournaments" className={navCls}>
                Tournaments
              </NavLink>
              <NavLink to="/profile" className={navCls}>
                Profile
              </NavLink>
            </>
          )}
          {/* Signed-in players have this in the account menu and the footer. */}
          {!signedIn && (
            <NavLink to="/how-chips-work" className={navCls}>
              How chips work
            </NavLink>
          )}
        </nav>
        {signedIn && <BalancePill />}
        <div className="flex items-center">
          {signedIn && <InboxBell />}
          <SoundToggle />
          <MusicControl />
          <SettingsButton />
        </div>
        {signedIn ? (
          <UserMenu />
        ) : status === 'signedOut' ? (
          <div className="flex items-center gap-1.5">
            <ButtonLink to="/login" variant="ghost" size="sm">
              Log in
            </ButtonLink>
            <ButtonLink to="/signup" size="sm" className="whitespace-nowrap">
              Play free
            </ButtonLink>
          </div>
        ) : null}
      </div>
    </header>
  );
}
