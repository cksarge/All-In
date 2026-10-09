import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { playSound } from '@/lib/sound';
import { useAuth } from '@/stores/authStore';
import { useSettings, type MotionPreference } from '@/stores/settingsStore';
import { useUi } from '@/stores/uiStore';

const MOTION_OPTIONS: { value: MotionPreference; label: string; hint: string }[] = [
  { value: 'system', label: 'Match my device', hint: 'Follow your operating system setting.' },
  { value: 'reduce', label: 'Reduced', hint: 'Minimal animation: no flying chips, spins or confetti.' },
  { value: 'full', label: 'Full', hint: 'All animations on.' },
];

/** Settings popup. Opened from the gear in the top bar, the account menu, the footer, or /settings. */
export function SettingsModal() {
  const { settingsOpen, closeSettings } = useUi();
  const { soundOn, setSoundOn, motion, setMotion, setTourSeen } = useSettings();
  const { status, user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const go = (to: string) => {
    closeSettings();
    navigate(to);
  };

  return (
    <Modal open={settingsOpen} onClose={closeSettings} title="Settings" className="max-h-[90dvh] max-w-lg overflow-y-auto">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-2xl font-bold text-ivory">Settings</h2>
        <button
          type="button"
          onClick={closeSettings}
          aria-label="Close settings"
          className="rounded-lg p-1.5 text-muted transition hover:bg-white/[0.06] hover:text-ivory"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <section className="mt-6" aria-labelledby="sound-h">
        <h3 id="sound-h" className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Sound</h3>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-cream" id="sound-label">Sound effects</p>
            <p className="text-sm text-muted">Chips, cards, dice and win sounds.</p>
          </div>
          <button
            role="switch"
            aria-checked={soundOn}
            aria-labelledby="sound-label"
            onClick={() => {
              setSoundOn(!soundOn);
              if (!soundOn) window.setTimeout(() => playSound('chip'), 0);
            }}
            className={cn(
              'relative h-7 w-12 shrink-0 rounded-full border transition',
              soundOn ? 'border-gold-500 bg-gold-500' : 'border-white/20 bg-ink-950',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5.5 w-5.5 rounded-full bg-ivory shadow transition-all',
                soundOn ? 'left-[calc(100%-1.5rem)]' : 'left-0.5',
              )}
            />
          </button>
        </div>
      </section>

      <div className="gold-rule my-6" />

      <section aria-labelledby="motion-h">
        <h3 id="motion-h" className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Motion</h3>
        <fieldset className="mt-3">
          <legend className="sr-only">Animation level</legend>
          <div className="grid gap-2">
            {MOTION_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                  motion === o.value ? 'border-gold-500/60 bg-gold-500/10' : 'border-white/10 hover:border-white/20',
                )}
              >
                <input
                  type="radio"
                  name="motion"
                  value={o.value}
                  checked={motion === o.value}
                  onChange={() => setMotion(o.value)}
                  className="mt-1 accent-gold-500"
                />
                <span>
                  <span className="block text-sm font-medium text-cream">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {status === 'signedIn' && (
        <>
          <div className="gold-rule my-6" />
          <section aria-labelledby="account-h">
            <h3 id="account-h" className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Account</h3>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-muted">Username</dt>
                <dd className="truncate font-medium text-cream">{profile?.username ?? '…'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted">Email</dt>
                <dd className="truncate font-medium text-cream">{user?.email}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTourSeen(false);
                  go('/lounge?tour=1');
                }}
              >
                Replay welcome tour
              </Button>
              <Button variant="ghost" size="sm" onClick={() => go('/forgot-password')}>
                Change password
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-ruby-300"
                onClick={async () => {
                  closeSettings();
                  await signOut();
                  navigate('/');
                }}
              >
                Log out
              </Button>
            </div>
          </section>
        </>
      )}
    </Modal>
  );
}

export function SettingsButton() {
  const openSettings = useUi((s) => s.openSettings);
  return (
    <button
      type="button"
      onClick={openSettings}
      aria-label="Open settings"
      title="Settings"
      className="flex h-10 w-9 items-center justify-center rounded-xl text-cream/80 sm:w-10 transition hover:bg-white/[0.06] hover:text-ivory"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  );
}
