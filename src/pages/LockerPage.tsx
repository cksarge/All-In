import { SectionNav } from '@/components/layout/SectionNav';
import { useEffect, useState } from 'react';
import { CardBack } from '@/components/cards/PlayingCard';
import { LevelBadge } from '@/components/progress/bits';
import { Avatar } from '@/components/ui/Avatar';
import { FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { FELTS, KIND_LABELS, type Cosmetic, type CosmeticKind, type Loadout } from '@/lib/progress';
import { playSound } from '@/lib/sound';
import { useAuth } from '@/stores/authStore';
import { useProgress } from '@/stores/progressStore';
import { toast } from '@/stores/toastStore';

const KINDS: CosmeticKind[] = ['avatar', 'frame', 'title', 'card_back', 'felt'];
const SLOT: Record<CosmeticKind, keyof Loadout> = { avatar: 'avatar', frame: 'frame', title: 'title', card_back: 'card_back', felt: 'felt' };

/** What one cosmetic looks like, shown on the player's own avatar where that makes sense. */
function Preview({ c, username, loadout }: { c: Cosmetic; username: string; loadout: Loadout }) {
  if (c.kind === 'avatar') return <Avatar username={username} loadout={{ avatar: c.key, frame: loadout.frame }} size={56} me />;
  if (c.kind === 'frame') return <Avatar username={username} loadout={{ avatar: loadout.avatar, frame: c.key }} size={56} me />;
  if (c.kind === 'title') return <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-gold-200">{c.name}</span>;
  if (c.kind === 'card_back') {
    return (
      <span className="relative block h-[4.2rem] w-12 overflow-hidden rounded-md shadow-lg" aria-hidden="true">
        <CardBack back={c.key} className="rounded-md" />
      </span>
    );
  }
  const f = FELTS[c.key] ?? FELTS.felt_classic;
  return (
    <span
      className="block h-14 w-24 rounded-xl border-4 border-[#3a2412]"
      style={{ backgroundColor: f.base, backgroundImage: `radial-gradient(ellipse at 50% 35%, rgb(${f.glow} / 0.5), transparent 70%)` }}
      aria-hidden="true"
    />
  );
}

export default function LockerPage() {
  const username = useAuth((s) => s.profile?.username);
  const { me, cosmetics, achievements, equip, fetch, fetchCatalogue } = useProgress();
  const [kind, setKind] = useState<CosmeticKind>('avatar');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void fetchCatalogue().then(() => fetch());
  }, [fetch, fetchCatalogue]);

  if (!me || !username || cosmetics.length === 0) return <FullPageLoader label="Opening your locker…" />;

  const owned = new Set(me.owned);
  // One-of-a-kind items (granted by hand, with no level or achievement behind them) are only shown to their owner.
  const listed = cosmetics.filter((c) => owned.has(c.key) || c.unlock_level !== null || achievements.some((a) => a.cosmetic_key === c.key));
  const items = listed.filter((c) => c.kind === kind);
  const how = (c: Cosmetic) => {
    if (c.unlock_level) return `Reach level ${c.unlock_level}`;
    const a = achievements.find((x) => x.cosmetic_key === c.key);
    return a ? `Achievement: ${a.name}` : 'Not available yet';
  };

  const put = async (c: Cosmetic) => {
    setBusy(c.key);
    const err = await equip(c.key);
    setBusy(null);
    if (err) {
      playSound('error');
      return toast.error(err);
    }
    playSound('chip');
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <SectionNav />
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">Earned, never sold</p>
      <h1 className="font-display text-4xl font-bold text-ivory">Locker</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
        Everything here is unlocked by playing: reaching levels and earning achievements. You are <LevelBadge level={me.level} /> and own{' '}
        {me.owned.length} of {listed.length}.
      </p>

      <div role="tablist" aria-label="Kind of item" className="mt-6 flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
              kind === k ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:border-white/20 hover:text-ivory',
            )}
          >
            {KIND_LABELS[k]}
            <span className="ml-1.5 text-xs opacity-60">
              {listed.filter((c) => c.kind === k && owned.has(c.key)).length}/{listed.filter((c) => c.kind === k).length}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        {kind === 'card_back' || kind === 'felt'
          ? 'This changes how the tables look on your screen. Other players see their own choice.'
          : 'Other players see this next to your name.'}
      </p>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((c) => {
          const have = owned.has(c.key);
          const on = me.loadout[SLOT[kind]] === c.key;
          return (
            <li key={c.key}>
              <button
                type="button"
                disabled={!have || on || busy !== null}
                aria-pressed={on}
                onClick={() => void put(c)}
                className={cn(
                  'flex h-full w-full flex-col items-center gap-2 rounded-2xl border p-4 text-center transition',
                  on
                    ? 'border-gold-300 bg-gold-500/10 shadow-glow-gold'
                    : have
                      ? 'border-white/10 bg-ink-800/80 hover:border-gold-500/40'
                      : 'border-white/[0.06] bg-ink-950/40',
                )}
              >
                <span className={cn('flex h-16 items-center justify-center', !have && 'opacity-35 grayscale')}>
                  <Preview c={c} username={username} loadout={me.loadout} />
                </span>
                <span className={cn('text-sm font-semibold', have ? 'text-ivory' : 'text-cream/60')}>{c.name}</span>
                <span className={cn('text-xs', on ? 'font-semibold text-gold-200' : have ? 'text-felt-300' : 'text-subtle')}>
                  {on ? 'Equipped' : have ? (busy === c.key ? 'Putting it on…' : 'Tap to equip') : `🔒 ${how(c)}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
