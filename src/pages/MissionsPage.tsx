import { useEffect, useState } from 'react';
import { CardBack } from '@/components/cards/PlayingCard';
import { Avatar } from '@/components/ui/Avatar';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { useNow } from '@/hooks/useNow';
import { friendlyError } from '@/lib/errors';
import { formatChips } from '@/lib/format';
import { KIND_NAME, missionText, seasonReady, type Mission, type Season, type SeasonTier } from '@/lib/live';
import { DEFAULT_LOADOUT, FELTS } from '@/lib/progress';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { countdown } from '@/lib/tournaments';
import { useAuth } from '@/stores/authStore';
import { useLive } from '@/stores/liveStore';
import { useProgress } from '@/stores/progressStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

/** "3d 4h", "5h 12m" or "4:07" until a moment. */
function until(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return countdown(ms);
}

export default function MissionsPage() {
  const { missions: data, offsetMs, fetchMissions } = useLive();
  const now = useNow(1000, offsetMs);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void fetchMissions();
  }, [fetchMissions]);
  // New missions the moment the day turns over.
  const dayEnds = data ? new Date(data.daily_ends_at).getTime() : 0;
  useEffect(() => {
    if (dayEnds && now > dayEnds + 1500) void fetchMissions();
  }, [now, dayEnds, fetchMissions]);

  if (!data) return <FullPageLoader label="Fetching your missions…" />;

  const claim = async (fn: 'missions_claim' | 'season_claim') => {
    if (busy) return;
    setBusy(fn);
    const { data: res, error } = await supabase.rpc(fn);
    setBusy(null);
    if (error) {
      playSound('error');
      return toast.error(friendlyError(error));
    }
    playSound('coins');
    if (fn === 'missions_claim') {
      const r = res as { chips: number; xp: number; points: number };
      toast.success('Mission rewards collected', `+${formatChips(r.chips)} chips, +${r.xp} XP${data.season ? `, +${r.points} season points` : ''}.`);
    } else {
      const r = res as { chips: number; cosmetics: string[] };
      toast.success('Season rewards collected', `${r.chips ? `+${formatChips(r.chips)} chips` : ''}${r.chips && r.cosmetics.length ? ' and ' : ''}${r.cosmetics.length ? `${r.cosmetics.length} new item${r.cosmetics.length === 1 ? '' : 's'} in your locker` : ''}.`);
    }
    void useWallet.getState().fetchStatus();
    void useProgress.getState().fetch();
    void fetchMissions();
  };

  const daily = data.missions.filter((m) => m.period === 'daily');
  const weekly = data.missions.filter((m) => m.period === 'weekly');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">Something new every day</p>
          <h1 className="font-display text-4xl font-bold text-ivory">Missions</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Three missions a day and three a week: one easy, one medium and one hard. Harder ones pay more. Each pays chips and XP{data.season ? ', and moves you along this month’s season track' : ''}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.to_collect > 0 && (
            <Button loading={busy === 'missions_claim'} onClick={() => void claim('missions_claim')}>
              Collect {data.to_collect} reward{data.to_collect === 1 ? '' : 's'}
            </Button>
          )}
          <ButtonLink to="/lounge" variant="ghost" size="sm">
            ← Lounge
          </ButtonLink>
        </div>
      </header>

      {data.season && <SeasonTrack season={data.season} now={now} busy={busy === 'season_claim'} onClaim={() => void claim('season_claim')} />}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <MissionList title="Today" resets={`New missions in ${until(new Date(data.daily_ends_at).getTime() - now)}`} missions={daily} season={Boolean(data.season)} />
        <MissionList title="This week" resets={`New missions in ${until(new Date(data.weekly_ends_at).getTime() - now)}`} missions={weekly} season={Boolean(data.season)} />
      </div>
    </div>
  );
}

function MissionList({ title, resets, missions, season }: { title: string; resets: string; missions: Mission[]; season: boolean }) {
  return (
    <section className="surface p-5" aria-label={`${title}'s missions`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-ivory">{title}</h2>
        <p className="text-xs tabular-nums text-muted">{resets}</p>
      </div>
      <ul className="mt-3 space-y-3">
        {missions.map((m) => (
          <MissionRow key={`${m.period}-${m.slot}`} m={m} season={season} />
        ))}
      </ul>
    </section>
  );
}

const TIER_STYLE = { easy: 'border-felt-400/50 text-felt-300', medium: 'border-gold-500/50 text-gold-200', hard: 'border-ruby-400/60 text-ruby-200' } as const;

export function MissionRow({ m, season, compact }: { m: Mission; season: boolean; compact?: boolean }) {
  const pct = Math.round((Math.min(m.progress, m.goal) / m.goal) * 100);
  return (
    <li className={cn('rounded-xl border p-3', m.done ? 'border-gold-500/40 bg-gold-500/[0.07]' : 'border-white/[0.07]')}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-sm font-medium', m.done ? 'text-gold-100' : 'text-cream')}>
          {m.tier && (
            <span className={cn('mr-2 rounded-full border px-1.5 py-0.5 align-middle text-[0.6rem] font-bold uppercase tracking-wider', TIER_STYLE[m.tier])}>{m.tier}</span>
          )}
          {missionText(m)}
        </p>
        <span className="shrink-0 text-xs font-semibold text-gold-200">{m.claimed ? 'Collected ✓' : m.done ? 'Done ✓' : `${formatChips(m.progress)} / ${formatChips(m.goal)}`}</span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={m.goal}
        aria-valuenow={Math.min(m.progress, m.goal)}
        aria-label={missionText(m)}
      >
        <div className={cn('h-full rounded-full transition-all', m.done ? 'bg-gold-400' : 'bg-felt-400')} style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <ChipAmount value={m.chips} className="text-cream/90" iconClassName="h-3.5 w-3.5" />
          <span>+{m.xp} XP</span>
          {season && <span>+{m.points} season points</span>}
        </p>
      )}
    </li>
  );
}

function SeasonTrack({ season, now, busy, onClaim }: { season: Season; now: number; busy: boolean; onClaim: () => void }) {
  const ready = seasonReady(season);
  const top = season.tiers[season.tiers.length - 1].points;
  const next = season.tiers.find((t) => t.points > season.points);
  return (
    <section
      aria-labelledby="season-h"
      className="mt-8 overflow-hidden rounded-3xl border p-5 shadow-card sm:p-7"
      style={{ borderColor: `${season.accent}66`, background: `linear-gradient(135deg, ${season.accent}26, rgb(15 20 18 / 0.9) 45%, rgb(10 13 12))` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: season.accent }}>
            This month&apos;s season · ends in {until(new Date(season.ends_at).getTime() - now)}
          </p>
          <h2 id="season-h" className="font-display text-3xl font-black text-ivory sm:text-4xl">
            {season.name}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-cream/85">{season.blurb}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-black tabular-nums text-ivory">
            {formatChips(season.points)} <span className="text-base font-semibold text-cream/70">/ {formatChips(top)}</span>
          </p>
          <p className="text-xs text-muted">{next ? `${formatChips(next.points - season.points)} points to the next reward` : 'Track complete'}</p>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={top} aria-valuenow={Math.min(season.points, top)} aria-label="Season progress">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (season.points / top) * 100)}%`, background: season.accent }} />
      </div>

      <ol className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {season.tiers.map((t) => (
          <Tier key={t.tier} t={t} season={season} />
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted">
          Season points come from missions. These rewards can only be earned this month: when it ends, the ones you haven&apos;t reached are gone for
          good. Anything you have reached is yours.
        </p>
        {ready > 0 && (
          <Button loading={busy} onClick={onClaim}>
            Collect {ready} season reward{ready === 1 ? '' : 's'}
          </Button>
        )}
      </div>
    </section>
  );
}

function Tier({ t, season }: { t: SeasonTier; season: Season }) {
  const username = useAuth((s) => s.profile?.username ?? '?');
  const reached = season.points >= t.points;
  const collected = season.claimed_tier >= t.tier;
  const r = t.reward;
  return (
    <li
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center',
        collected ? 'border-white/10 bg-white/[0.03] opacity-70' : reached ? 'border-gold-400/70 bg-gold-500/10' : 'border-white/[0.08] bg-ink-950/40',
      )}
    >
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
        {t.tier} · {formatChips(t.points)} pts
      </p>
      <div className="flex h-14 items-center justify-center">
        {!r ? (
          <ChipAmount value={t.chips} className="font-display text-lg font-bold text-gold-200" iconClassName="h-5 w-5" />
        ) : r.kind === 'avatar' ? (
          <Avatar username={username} loadout={{ ...DEFAULT_LOADOUT, avatar: r.key }} size={48} />
        ) : r.kind === 'frame' ? (
          <Avatar username={username} loadout={{ ...DEFAULT_LOADOUT, frame: r.key }} size={48} />
        ) : r.kind === 'card_back' ? (
          <span className="relative block h-14 w-10 overflow-hidden rounded-md shadow-lg" aria-hidden="true">
            <CardBack back={r.key} className="rounded-md" />
          </span>
        ) : r.kind === 'felt' ? (
          <span
            className="block h-10 w-16 rounded-lg border-4 border-[#3a2412]"
            style={{ backgroundColor: (FELTS[r.key] ?? FELTS.felt_classic).base, backgroundImage: `radial-gradient(ellipse at 50% 35%, rgb(${(FELTS[r.key] ?? FELTS.felt_classic).glow} / 0.5), transparent 70%)` }}
            aria-hidden="true"
          />
        ) : (
          <span className="rounded-full border border-gold-500/50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-gold-200">{r.name}</span>
        )}
      </div>
      <p className="text-xs font-medium leading-tight text-cream">{r ? `${KIND_NAME[r.kind]}: ${r.name}` : 'Chips'}</p>
      <p className={cn('text-[0.65rem] font-semibold', collected ? 'text-muted' : reached ? 'text-gold-200' : 'text-subtle')}>{collected ? 'Collected ✓' : reached ? 'Ready to collect' : 'Locked'}</p>
    </li>
  );
}
