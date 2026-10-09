import { useNavigate } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { playSound } from '@/lib/sound';
import { useAuth } from '@/stores/authStore';
import { useSettings, type MotionPreference } from '@/stores/settingsStore';

const MOTION_OPTIONS: { value: MotionPreference; label: string; hint: string }[] = [
  { value: 'system', label: 'Match my device', hint: 'Follow your operating system setting.' },
  { value: 'reduce', label: 'Reduced', hint: 'Minimal animation: no flying chips, spins or confetti.' },
  { value: 'full', label: 'Full', hint: 'All animations on.' },
];

export default function SettingsPage() {
  const { soundOn, setSoundOn, motion, setMotion, setTourSeen } = useSettings();
  const { status, user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="font-display text-4xl font-bold text-ivory">Settings</h1>

      <section className="surface mt-8 p-6" aria-labelledby="sound-h">
        <h2 id="sound-h" className="font-display text-xl font-bold text-ivory">Sound</h2>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-cream" id="sound-label">Sound effects</p>
            <p className="text-sm text-muted">Chips, cards, dice and win sounds. Also in the top bar.</p>
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

      <section className="surface mt-5 p-6" aria-labelledby="motion-h">
        <h2 id="motion-h" className="font-display text-xl font-bold text-ivory">Motion</h2>
        <fieldset className="mt-4">
          <legend className="sr-only">Animation level</legend>
          <div className="grid gap-2">
            {MOTION_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition',
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
                  <span className="block font-medium text-cream">{o.label}</span>
                  <span className="block text-sm text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {status === 'signedIn' && (
        <section className="surface mt-5 p-6" aria-labelledby="account-h">
          <h2 id="account-h" className="font-display text-xl font-bold text-ivory">Account</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Username</dt>
              <dd className="font-medium text-cream">{profile?.username ?? '…'}</dd>
            </div>
            <div>
              <dt className="text-muted">Email</dt>
              <dd className="truncate font-medium text-cream">{user?.email}</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTourSeen(false);
                navigate('/lounge?tour=1');
              }}
            >
              Replay welcome tour
            </Button>
            <ButtonLink to="/forgot-password" variant="ghost" size="sm">
              Change password
            </ButtonLink>
            <Button
              variant="ghost"
              size="sm"
              className="text-ruby-300"
              onClick={async () => {
                await signOut();
                navigate('/');
              }}
            >
              Log out
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
