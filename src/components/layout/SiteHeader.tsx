import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ButtonLink } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/components/ui/cn';
import { SettingsButton } from '@/components/settings/SettingsModal';
import { useAuth } from '@/stores/authStore';
import { useUi } from '@/stores/uiStore';
import { BalancePill } from './BalancePill';
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

  const initial = (profile?.username ?? '?').slice(0, 1).toUpperCase();

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
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold-500/50 bg-gradient-to-br from-ruby-600 to-ruby-800 font-display text-sm font-bold text-gold-200">
          {initial}
        </span>
        <span className="hidden max-w-28 truncate text-sm font-medium text-cream md:inline">{profile?.username ?? '…'}</span>
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
            </>
          )}
          <NavLink to="/how-chips-work" className={navCls}>
            How chips work
          </NavLink>
        </nav>
        {signedIn && <BalancePill />}
        <div className="flex items-center">
          <SoundToggle />
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
