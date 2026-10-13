import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IdentityCodeForm, setTwoStep } from '@/components/account/TwoStep';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { HAS_MUSIC, MUSIC_CREDITS } from '@/lib/music';
import { maskEmail } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { useAccount } from '@/stores/accountStore';
import { toast } from '@/stores/toastStore';
import { useAuth } from '@/stores/authStore';
import { useSettings, type MotionPreference } from '@/stores/settingsStore';
import { useUi } from '@/stores/uiStore';

const MOTION_OPTIONS: { value: MotionPreference; label: string; hint: string }[] = [
  { value: 'system', label: 'Match my device', hint: 'Follow your operating system setting.' },
  { value: 'reduce', label: 'Reduced', hint: 'Minimal animation: no flying chips, spins or confetti.' },
  { value: 'full', label: 'Full', hint: 'All animations on.' },
];

/** Two-step verification: a code by email after the password, at every login. */
function TwoStepSetting() {
  const account = useAccount((s) => s.account);
  const email = useAuth((s) => s.user?.email ?? '');
  const [busy, setBusy] = useState(false);
  // Switching it on from a session that has only the password: prove the codes arrive first.
  const [proving, setProving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Before 15_moderation.sql is current the server knows no such setting.
  if (!account || account.two_step === undefined) return null;
  const on = account.two_step;

  const apply = async (next: boolean) => {
    setBusy(true);
    setError(null);
    const err = await setTwoStep(next);
    setBusy(false);
    setProving(false);
    if (err !== null) {
      playSound('error');
      setError(err);
      return;
    }
    playSound('click');
    if (next) toast.success('Two-step verification is on', 'From your next login we will email you a code after your password.');
    else toast.info('Two-step verification is off', 'Your password alone logs you in again.');
  };

  return (
    <div className="mt-5 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-cream" id="two-step-label">Two-step verification</p>
          <p className="text-sm text-muted">
            Each time you log in, after your password, we email a 6-digit code to {maskEmail(email)}. Staying logged in needs no new code.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-labelledby="two-step-label"
          disabled={busy || proving}
          onClick={() => {
            if (!on && !account.verified) {
              setError(null);
              setProving(true);
            } else void apply(!on);
          }}
          className={cn('relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-60', on ? 'border-gold-500 bg-gold-500' : 'border-white/20 bg-ink-950')}
        >
          <span className={cn('absolute top-0.5 h-5.5 w-5.5 rounded-full bg-ivory shadow transition-all', on ? 'left-[calc(100%-1.5rem)]' : 'left-0.5')} />
        </button>
      </div>
      {proving && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-4 text-sm text-cream/85">
            First, let&apos;s make sure the codes reach you. Enter the 6-digit code we just sent to <strong className="text-cream">{maskEmail(email)}</strong>.
          </p>
          <IdentityCodeForm submitLabel="Verify and switch on" onVerified={() => apply(true)} />
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setProving(false)}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-ruby-300">{error}</p>}
    </div>
  );
}

/** Settings popup. Opened from the gear in the top bar, the account menu, the footer, or /settings. */
export function SettingsModal() {
  const { settingsOpen, closeSettings } = useUi();
  const { textSize, setTextSize, soundOn, setSoundOn, musicOn, setMusicOn, musicVolume, setMusicVolume, motion, setMotion, setTourSeen, tipsOn, setTipsOn, resetTips } = useSettings();
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
        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-cream" id="music-label">Music</p>
            <p className="text-sm text-muted">
              {HAS_MUSIC ? 'A playlist in a random order on every screen. Some games have a theme of their own.' : 'No music has been added to the game yet.'}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={musicOn}
            aria-labelledby="music-label"
            disabled={!HAS_MUSIC}
            onClick={() => setMusicOn(!musicOn)}
            className={cn(
              'relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-40',
              musicOn && HAS_MUSIC ? 'border-gold-500 bg-gold-500' : 'border-white/20 bg-ink-950',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5.5 w-5.5 rounded-full bg-ivory shadow transition-all',
                musicOn && HAS_MUSIC ? 'left-[calc(100%-1.5rem)]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        {HAS_MUSIC && (
          <label className="mt-3 flex items-center gap-3 text-sm text-muted">
            <span className="shrink-0">Music volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={musicVolume}
              disabled={!musicOn}
              onChange={(e) => setMusicVolume(Number(e.target.value))}
              className="h-2 min-w-0 flex-1 accent-gold-500 disabled:opacity-40"
            />
            <span className="w-9 shrink-0 text-right tabular-nums">{musicVolume}%</span>
          </label>
        )}
        {MUSIC_CREDITS && (
          <details className="mt-3 rounded-xl border border-white/10 p-3">
            <summary className="cursor-pointer text-sm font-medium text-cream">Music credits</summary>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">{MUSIC_CREDITS}</p>
          </details>
        )}
      </section>

      <div className="gold-rule my-6" />

      <section aria-labelledby="size-h">
        <h3 id="size-h" className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Size</h3>
        <p className="mt-2 text-sm text-muted">Makes everything on the site smaller or larger: text, cards, buttons and tables.</p>
        <div role="radiogroup" aria-label="Size of the site" className="mt-3 grid grid-cols-3 gap-2">
          {(
            [
              ['compact', 'Compact', 'Fits more in'],
              ['normal', 'Normal', 'The default'],
              ['large', 'Large', 'Easier to read'],
            ] as const
          ).map(([k, label, hint]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={textSize === k}
              onClick={() => setTextSize(k)}
              className={cn('rounded-xl border px-2 py-2 text-center transition', textSize === k ? 'border-gold-500/70 bg-gold-500/10' : 'border-white/10 hover:border-white/25')}
            >
              <span className="block text-sm font-medium text-cream">{label}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </button>
          ))}
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

      <div className="gold-rule my-6" />

      <section aria-labelledby="guides-h">
        <h3 id="guides-h" className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Game guides</h3>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-cream" id="guides-label">Show a short guide the first time I open a game</p>
            <p className="text-sm text-muted">A few plain steps. The full rules are always behind each game&apos;s Rules button.</p>
          </div>
          <button
            role="switch"
            aria-checked={tipsOn}
            aria-labelledby="guides-label"
            onClick={() => setTipsOn(!tipsOn)}
            className={cn('relative h-7 w-12 shrink-0 rounded-full border transition', tipsOn ? 'border-gold-500 bg-gold-500' : 'border-white/20 bg-ink-950')}
          >
            <span className={cn('absolute top-0.5 h-5.5 w-5.5 rounded-full bg-ivory shadow transition-all', tipsOn ? 'left-[calc(100%-1.5rem)]' : 'left-0.5')} />
          </button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 -ml-2"
          onClick={() => {
            resetTips();
            playSound('click');
          }}
        >
          Show every guide again
        </Button>
        {status === 'signedIn' && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setTourSeen(false);
              go('/lounge?tour=1');
            }}
          >
            Replay welcome tour
          </Button>
        )}
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
            <TwoStepSetting />
            <div className="mt-5 flex flex-wrap gap-2">
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
