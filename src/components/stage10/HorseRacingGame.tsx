import { useRemembered } from '@/hooks/useRemembered';
import { useEffect, useRef, useState } from 'react';
import { BetStepper, SoloGate, SoloShell } from '@/components/solo/SoloShell';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { useLiveRoom } from '@/hooks/useLiveRoom';
import { useNow } from '@/hooks/useNow';
import { formatChipsCompact } from '@/lib/format';
import { settleBalance, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface Config {
  bet_seconds: number;
  race_seconds: number;
  result_seconds: number;
  return_pct: number;
  max_bets: number;
}
interface Horse {
  no: number;
  name: string;
  chance: number;
  /** What a bet returns, in hundredths of the bet. */
  win: number;
  place: number;
}
type Kind = 'win' | 'place';
interface MyBet {
  horse: number;
  kind: Kind;
  amount: number;
  units: number;
  payout: number;
  settled: boolean;
}
interface State {
  server_now: string;
  round: {
    id: string;
    round_no: number;
    phase: 'betting' | 'racing' | 'done';
    betting_ends_at: string;
    started_at: string | null;
    ends_at: string | null;
    horses: Horse[];
    /** Horse numbers, first to last. Null while bets are open. */
    result: number[] | null;
  };
  mine: MyBet[];
  pool: { horse: number; amount: number; players: number }[];
  players: number;
  recent: { name: string; no: number; win: number }[];
}

const SILKS = ['#c9303f', '#3566c4', '#d4af37', '#2f9e6b', '#8a4fc7', '#e07b2c'];
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const odds = (units: number) => `${(units / 100).toFixed(2)}×`;

export function HorseRacingGame() {
  const { info, error, load } = useSoloGame<Config>('horse_racing', 'race_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Walking to the track…" />;
  return <Room info={info} />;
}

/** A steady number from 0 to 1 for a race and a horse, so every browser draws the same wobble. */
function seeded(id: string, n: number) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * How far along the track (0 to 1) a horse is, `t` (0 to 1) of the way through the race.
 * The finishing order is already fixed by the server; this only draws it. The horse that
 * finishes in place `place` reaches the line a little later than the one ahead of it, and
 * each surges and fades on the way so the lead changes.
 */
function progress(id: string, horse: number, place: number, t: number) {
  const finish = 0.84 + place * 0.03;
  const u = Math.min(1, t / finish);
  if (u >= 1) return 1;
  const a = seeded(id, horse);
  const b = seeded(id, horse + 17);
  const wobble = Math.sin((u * (1.5 + a * 2) + b) * Math.PI * 2) * 0.06 * (1 - u) * Math.min(1, u * 6);
  return Math.max(0, Math.min(0.995, u + wobble));
}

function Room({ info }: { info: SoloInfo<Config> }) {
  const c = info.config;
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const { state, error, offsetMs, call } = useLiveRoom<State>({
    stateFn: 'race_state',
    tables: ['race_rounds', 'race_bets'],
    pollMs: () => 1000,
  });
  const now = useNow(60, offsetMs);
  const [betIndex, setBetIndex] = useRemembered(`bet:${info.game}`, 0, (v) => Number.isInteger(v) && v >= 0 && v < info.bets.length);
  const [busy, setBusy] = useState<string | null>(null);
  const bet = info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);

  const round = state?.round;
  const phase = round?.phase;
  const mine = state?.mine ?? [];
  const staked = mine.reduce((n, b) => n + b.amount, 0);
  const won = mine.reduce((n, b) => n + b.payout, 0);

  // Sounds, and the balance once the race is over (winnings are paid as it ends).
  const lastPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = round ? `${round.id}-${round.phase}` : undefined;
    if (key === lastPhase.current) return;
    lastPhase.current = key;
    if (phase === 'racing') playSound('whoosh');
    if (phase === 'done') {
      void useWallet.getState().fetchStatus();
      if (staked > 0) playSound(won > 0 ? 'win' : 'lose');
    }
  }, [round, phase, staked, won]);

  if (!state || !round) return <SoloGate error={error} onRetry={() => undefined} label="Walking to the track…" />;

  const countdown = phase === 'betting' ? Math.max(0, Math.ceil((new Date(round.betting_ends_at).getTime() - now) / 1000)) : 0;
  const t =
    phase === 'racing' && round.started_at && round.ends_at
      ? Math.max(0, Math.min(1, (now - new Date(round.started_at).getTime()) / (new Date(round.ends_at).getTime() - new Date(round.started_at).getTime())))
      : phase === 'done'
        ? 1
        : 0;
  const placeOf = (no: number) => (round.result ? round.result.indexOf(no) : 0);
  const winner = phase === 'done' && round.result ? round.horses[round.result[0] - 1] : null;
  const myBet = (no: number, kind: Kind) => mine.find((b) => b.horse === no && b.kind === kind);
  const canBet = phase === 'betting' && mine.length < c.max_bets;

  const place = async (horse: Horse, kind: Kind) => {
    if (busy || phase !== 'betting') return;
    if (myBet(horse.no, kind)) return toast.info('You already have that bet', 'One Win and one Place bet per horse.');
    if (mine.length >= c.max_bets) return toast.info(`${c.max_bets} bets is the most for one race`);
    if (balance < bet) return toast.info('Not enough chips for that bet', 'Lower your bet, or pick up free chips in the lounge.');
    setBusy(`${horse.no}-${kind}`);
    const [res, err] = await call<{ balance: number }>('race_bet', { p_horse: horse.no, p_kind: kind, p_amount: bet });
    setBusy(null);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('chip');
    settleBalance(res.balance);
  };

  const status =
    phase === 'betting'
      ? `Race ${round.round_no} starts in ${countdown}s. ${mine.length ? `You have ${mine.length} bet${mine.length === 1 ? '' : 's'} on.` : 'Pick a horse to Win or to Place.'}`
      : phase === 'racing'
        ? 'And they’re off!'
        : winner
          ? `${winner.name} wins!${staked > 0 ? (won > 0 ? ` You collect ${won.toLocaleString('en-US')}.` : ' No luck this time.') : ''}`
          : 'Race over';

  return (
    <SoloShell
      info={info}
      chat="room:horse_racing"
      tier={tier?.tier}
      status={status}
      wide
      controls={
        <>
          <BetStepper bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={phase !== 'betting'} tiers={info.tiers} label="Each bet" />
          <p className="hidden min-w-0 flex-1 text-sm text-cream/80 sm:block">
            {phase === 'betting'
              ? canBet
                ? 'Tap Win or Place next to a horse.'
                : 'That’s all your bets for this race.'
              : phase === 'racing'
                ? 'Bets are closed. Good luck!'
                : 'Next race in a moment.'}
          </p>
          {staked > 0 && (
            <p className="ml-auto text-sm text-cream/80">
              On this race: <ChipAmount value={staked} className="font-semibold text-ivory" iconClassName="h-3.5 w-3.5" />
            </p>
          )}
        </>
      }
      rules={
        <>
          <p>
            Everyone in the room watches the same race. Six horses run, each with its own chance of winning, shown as the price next to
            its name. You have {c.bet_seconds} seconds to bet before the off.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-ivory">Win</strong>: your horse must come first. The price is what comes back for each chip you bet, so
              3.00× on a 100 bet returns 300.
            </li>
            <li>
              <strong className="text-ivory">Place</strong>: your horse must come first or second. It pays less, because it happens more often.
            </li>
            <li>You can make up to {c.max_bets} bets on one race: one Win and one Place per horse.</li>
            <li>The favourite has the lowest price and wins most often. An outsider wins rarely and pays a lot when it does.</li>
            <li>Winnings are paid when the race finishes.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Prices are set from each horse&apos;s real chance so that every bet returns about {c.return_pct}% over time, whichever horse you
            pick. The finishing order is drawn by the server at the moment betting closes, not before. What other players bet does not change
            the prices. Play chips have no cash value.
          </p>
        </>
      }
    >
      {/* The track */}
      <div className="felt relative overflow-hidden rounded-2xl border border-white/10 p-2 sm:p-3" aria-label="The track">
        <div className="absolute bottom-2 right-[9%] top-2 w-1 bg-[repeating-linear-gradient(0deg,#fff_0_6px,#111_6px_12px)] opacity-80 sm:bottom-3 sm:top-3" aria-hidden="true" />
        <ul className="relative space-y-1">
          {round.horses.map((h) => {
            const pl = placeOf(h.no);
            const x = phase === 'betting' ? 0 : progress(round.id, h.no, pl, t);
            const finished = phase !== 'betting' && x >= 1;
            return (
              <li key={h.no} className="relative h-8 rounded-md bg-black/20 sm:h-9">
                <span
                  className="absolute left-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[0.65rem] font-black text-white"
                  style={{ background: SILKS[h.no - 1] }}
                  aria-hidden="true"
                >
                  {h.no}
                </span>
                <span
                  className="absolute top-1/2 -translate-y-1/2 text-2xl leading-none sm:text-3xl"
                  style={{ left: `calc(1.75rem + (91% - 4.25rem) * ${x.toFixed(4)})` }}
                  aria-hidden="true"
                >
                  <span className="inline-block -scale-x-100">🏇</span>
                </span>
                {finished && round.result && (
                  <span
                    className={cn(
                      'absolute right-1 top-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold',
                      pl === 0 ? 'bg-gold-400 text-ink-950' : pl === 1 ? 'bg-ivory/90 text-ink-950' : 'bg-ink-950/70 text-cream/80',
                    )}
                  >
                    {ORDINAL[pl]}
                  </span>
                )}
                <span className="sr-only">
                  {h.name}
                  {finished ? `, ${ORDINAL[pl]}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
        {phase === 'betting' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-full bg-ink-950/75 px-4 py-1.5 text-sm font-semibold text-ivory">
              Off in <span className="inline-block min-w-[2ch] text-center tabular-nums text-gold-200">{countdown}</span>s
            </p>
          </div>
        )}
        {winner && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-full bg-gradient-to-r from-gold-300 to-gold-500 px-4 py-1.5 text-sm font-bold text-ink-950 shadow-lg">
              {winner.name} wins at {odds(winner.win)}
            </p>
          </div>
        )}
      </div>

      {/* The card: prices and your bets */}
      <ul className="mt-3 divide-y divide-white/[0.06]" aria-label="Runners and prices">
        {round.horses.map((h) => {
          const pool = state.pool.find((p) => p.horse === h.no);
          const pl = placeOf(h.no);
          return (
            <li key={h.no} className="flex items-center gap-2 py-1.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-white" style={{ background: SILKS[h.no - 1] }}>
                {h.no}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm font-semibold', phase === 'done' && pl === 0 ? 'text-gold-200' : 'text-ivory')}>{h.name}</p>
                <p className="text-[0.65rem] text-cream/55">{pool ? `${formatChipsCompact(pool.amount)} riding · ${pool.players} player${pool.players === 1 ? '' : 's'}` : 'No bets yet'}</p>
              </div>
              {(['win', 'place'] as const).map((kind) => {
                const b = myBet(h.no, kind);
                const hit = phase === 'done' && Boolean(b) && b!.payout > 0;
                const lost = phase === 'done' && Boolean(b) && b!.payout === 0;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={phase !== 'betting' || Boolean(b) || !canBet || busy !== null}
                    onClick={() => void place(h, kind)}
                    aria-label={`${h.name} to ${kind}, pays ${odds(h[kind])}${b ? `, you have ${b.amount} on it` : ''}`}
                    className={cn(
                      'w-[4.6rem] shrink-0 rounded-lg border px-1.5 py-1 text-center transition sm:w-24',
                      hit
                        ? 'border-gold-300 bg-gold-500/25'
                        : lost
                          ? 'border-white/10 opacity-45'
                          : b
                            ? 'border-felt-300 bg-felt-600/40'
                            : 'border-white/15 bg-ink-950/40 enabled:hover:border-gold-400/70 disabled:opacity-60',
                    )}
                  >
                    <span className="block text-[0.6rem] uppercase tracking-wider text-cream/60">{kind === 'win' ? 'Win' : 'Place'}</span>
                    <span className="block text-sm font-bold tabular-nums text-ivory">{odds(h[kind])}</span>
                    {b && (
                      <span className={cn('block text-[0.65rem] font-semibold tabular-nums', hit ? 'text-gold-200' : 'text-felt-300')}>
                        {hit ? `+${b.payout.toLocaleString('en-US')}` : b.amount.toLocaleString('en-US')}
                      </span>
                    )}
                  </button>
                );
              })}
            </li>
          );
        })}
      </ul>

      {state.recent.length > 0 && (
        <div className="mt-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-cream/65">Recent winners</p>
          <div className="scrollbar-thin mt-1 flex gap-1 overflow-x-auto pb-1">
            {state.recent.map((r, i) => (
              <span
                key={i}
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                  r.win >= 1000 ? 'bg-gold-500/25 text-gold-200' : r.win >= 500 ? 'bg-felt-600/50 text-felt-300' : 'bg-ink-950/60 text-cream/75',
                )}
              >
                {r.name} · {odds(r.win)}
              </span>
            ))}
          </div>
        </div>
      )}
    </SoloShell>
  );
}
