import { useRemembered } from '@/hooks/useRemembered';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BetStepper, SoloGate, SoloShell } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { useLiveRoom } from '@/hooks/useLiveRoom';
import { useNow } from '@/hooks/useNow';
import { chipsFor, timesBet } from '@/lib/slots';
import { settleBalance, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface Config {
  sell_seconds: number;
  calls: number;
  interval_ms: number;
  cooldown_seconds: number;
  max_cards: number;
  /** [a line by this call, prize in hundredths of the card price] */
  returns: [number, number][];
}
interface Card {
  id: string;
  /** 25 numbers, column by column (B, I, N, G, O); 0 is the free centre. */
  numbers: number[];
  price: number;
  line_at: number | null;
  payout: number;
}
interface State {
  server_now: string;
  round: { id: string; phase: 'selling' | 'calling' | 'done'; selling_ends_at: string; started_at: string | null; ended_at: string | null } | null;
  called: number[];
  cards: Card[];
  players: { username: string; cards: number }[];
  winners: { username: string; payout: number; line_at: number }[];
}

const LETTERS = ['B', 'I', 'N', 'G', 'O'];
/** Ball colour per column, each with a text colour that shows up on it. */
const BALL_BG = ['bg-sapphire-500 text-ivory', 'bg-ruby-500 text-ivory', 'bg-ivory text-ink-950', 'bg-felt-500 text-ivory', 'bg-gold-500 text-ink-950'];
const letterOf = (n: number) => LETTERS[Math.floor((n - 1) / 15)];
const LINES: number[][] = [
  ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => c * 5 + r)),
  ...[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => c * 5 + r)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

export function BingoGame() {
  const { info, error, load } = useSoloGame<Config>('bingo', 'more_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Opening the bingo hall…" />;
  return <Hall info={info} />;
}

function BingoCard({ card, called, done }: { card: Card; called: Set<number>; done: boolean }) {
  const marked = (i: number) => card.numbers[i] === 0 || called.has(card.numbers[i]);
  const full = LINES.filter((l) => l.every(marked));
  const winning = new Set(done && card.line_at ? full.flat() : []);
  const best = Math.max(...LINES.map((l) => l.filter(marked).length));
  return (
    <div className={cn('rounded-xl border p-2', card.payout > 0 ? 'border-gold-300 bg-gold-500/10' : 'border-white/10 bg-ink-950/40')}>
      <div className="grid grid-cols-5 gap-0.5 text-center">
        {LETTERS.map((l) => (
          <span key={l} className="text-xs font-black text-gold-300" aria-hidden="true">{l}</span>
        ))}
        {[0, 1, 2, 3, 4].flatMap((r) =>
          [0, 1, 2, 3, 4].map((c) => {
            const i = c * 5 + r;
            const n = card.numbers[i];
            const on = marked(i);
            return (
              <span
                key={i}
                className={cn(
                  'flex aspect-square items-center justify-center rounded text-[0.7rem] font-bold tabular-nums sm:text-xs',
                  winning.has(i) ? 'bg-gold-400 text-ink-950' : on ? 'bg-ruby-600 text-ivory' : 'bg-ink-800 text-cream/80',
                )}
              >
                {n === 0 ? '★' : n}
              </span>
            );
          }),
        )}
      </div>
      <p className="mt-1.5 text-center text-xs text-cream/80">
        {done ? (
          card.payout > 0 ? (
            <>
              Line on call {card.line_at}: <ChipAmount value={card.payout} className="font-bold text-gold-200" iconClassName="h-3 w-3" />
            </>
          ) : (
            'No line this round'
          )
        ) : full.length > 0 ? (
          <span className="font-bold text-gold-200">Bingo!</span>
        ) : best === 4 ? (
          <span className="text-gold-200">One to go</span>
        ) : (
          <>
            Card for <ChipAmount value={card.price} iconClassName="h-3 w-3" />
          </>
        )}
      </p>
    </div>
  );
}

function Hall({ info }: { info: SoloInfo<Config> }) {
  const c = info.config;
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const { state, error, offsetMs, call } = useLiveRoom<State>({
    stateFn: 'bingo_state',
    tables: ['bingo_rounds'],
    pollMs: (s) => (s?.round?.phase === 'calling' ? 1000 : s?.round?.phase === 'selling' ? 1500 : 3000),
  });
  const now = useNow(250, offsetMs);
  const [betIndex, setBetIndex] = useRemembered(`bet:${info.game}`, 0, (v) => Number.isInteger(v) && v >= 0 && v < info.bets.length);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const price = info.bets[betIndex];
  const tier = info.tiers.find((t) => price >= t.min_bet && price <= t.max_bet);

  const round = state?.round ?? null;
  const phase = round?.phase;
  const called = state?.called ?? [];
  const calledSet = new Set(called);
  const lastBall = called[called.length - 1];
  const sellLeft = phase === 'selling' && round ? Math.max(0, Math.ceil((new Date(round.selling_ends_at).getTime() - now) / 1000)) : 0;
  const waitLeft = phase === 'done' && round?.ended_at ? Math.max(0, Math.ceil((new Date(round.ended_at).getTime() + c.cooldown_seconds * 1000 - now) / 1000)) : 0;
  const myCards = state?.cards ?? [];
  const canTake = (!round || phase === 'selling' || (phase === 'done' && waitLeft === 0)) && (phase !== 'selling' || myCards.length < c.max_cards);
  const room = phase === 'selling' ? c.max_cards - myCards.length : c.max_cards;
  const nowPays = c.returns.find(([by]) => called.length <= by)?.[1] ?? 0;

  // A sound per ball, and a balance refresh when the round is paid.
  const heard = useRef('');
  useEffect(() => {
    const key = `${round?.id}-${phase}-${called.length}`;
    if (key === heard.current) return;
    heard.current = key;
    if (phase === 'calling') playSound(myCards.some((k) => k.numbers.includes(lastBall)) ? 'pop' : 'click');
    if (phase === 'done') {
      void useWallet.getState().fetchStatus();
      if (myCards.length) playSound(myCards.some((k) => k.payout > 0) ? 'win' : 'lose');
    }
  }, [round?.id, phase, called.length, lastBall, myCards]);

  const takeCards = async () => {
    if (busy) return;
    const n = Math.min(count, room);
    if (balance < price * n) return toast.info('Not enough chips for those cards', 'Take fewer cards or a lower price.');
    setBusy(true);
    const [res, err] = await call<{ balance: number }>('bingo_buy', { p_price: price, p_count: n });
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('chip');
    settleBalance(res.balance);
  };

  if (!state) return <SoloGate error={error} onRetry={() => undefined} label="Finding a seat…" />;

  const status = !round
    ? 'Take a card to start a round'
    : phase === 'selling'
      ? `Balls roll in ${sellLeft}s`
      : phase === 'calling'
        ? `Ball ${called.length} of ${c.calls}`
        : state.winners.length
          ? `Round over: ${state.winners.length} winner${state.winners.length === 1 ? '' : 's'}`
          : 'Round over: no lines this time';

  return (
    <SoloShell
      info={info}
      chat="room:bingo"
      wide
      tier={tier?.tier}
      status={status}
      controls={
        <>
          <BetStepper label="Card price" bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy} tiers={info.tiers} />
          <div role="radiogroup" aria-label="Number of cards" className="flex items-center gap-1">
            <span className="mr-1 text-[0.65rem] uppercase tracking-wider text-muted">Cards</span>
            {Array.from({ length: c.max_cards }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                aria-label={`${n} card${n === 1 ? '' : 's'}`}
                disabled={busy || n > room}
                onClick={() => setCount(n)}
                className={cn(
                  'h-8 w-8 rounded-full border text-xs font-semibold transition disabled:opacity-40',
                  Math.min(count, room) === n ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:text-ivory',
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <Button size="lg" className="ml-auto min-w-40" loading={busy} disabled={!canTake || room <= 0} onClick={() => void takeCards()} hotkey="space" hotkeyLabel="Take cards">
            {phase === 'calling' ? 'Round in play' : phase === 'done' && waitLeft > 0 ? `Next round in ${waitLeft}s` : `Take ${Math.min(count, Math.max(room, 1))} card${Math.min(count, room) === 1 ? '' : 's'}`}
          </Button>
        </>
      }
      rules={
        <>
          <p>
            75-ball bingo in a room everyone shares. Take up to {c.max_cards} cards, then {c.calls} balls are called, one a second.
            Your cards are marked for you. The <strong className="text-ivory">sooner a card completes a line</strong>, the more it pays.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>A line is any full row, column or diagonal of five. The centre square is free.</li>
            <li>The first card taken opens the round and starts a {c.sell_seconds}-second countdown, so others can join in.</li>
            <li>Each card is paid on its own, by the house, for its first line only. Other players winning doesn&apos;t shrink your prize.</li>
            <li>Prizes are multiples of what you paid for the card:</li>
          </ul>
          <table className="w-full text-left">
            <caption className="sr-only">Prizes by how quickly a line is completed</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-1.5">Line completed by</th>
                <th scope="col" className="py-1.5">Pays</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {c.returns.map(([by, u], i) => (
                <tr key={by}>
                  <td className="py-1.5 text-ivory">
                    {i === 0 ? `Call ${by} or sooner` : `Calls ${c.returns[i - 1][0] + 1} to ${by}`}
                  </td>
                  <td className="py-1.5 text-gold-200">{timesBet(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            A little under half of all cards complete a line within {c.calls} calls, and the game returns about 94% over a very
            long run. The balls are drawn by the server when the countdown ends and revealed one at a time. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <motion.div
              key={lastBall ?? 'none'}
              initial={lastBall ? { scale: 0.4, rotate: -120 } : false}
              animate={{ scale: 1, rotate: 0 }}
              className={cn(
                'flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full font-display font-black shadow-[inset_0_-6px_10px_rgba(0,0,0,0.3),0_8px_16px_rgba(0,0,0,0.5)]',
                lastBall ? BALL_BG[Math.floor((lastBall - 1) / 15)] : 'bg-ink-950/50',
              )}
              aria-live="polite"
              aria-label={lastBall ? `${letterOf(lastBall)} ${lastBall}` : 'No ball yet'}
            >
              {lastBall ? (
                <>
                  <span className="text-xs leading-none">{letterOf(lastBall)}</span>
                  <span className="text-3xl leading-none">{lastBall}</span>
                </>
              ) : (
                <span className="text-2xl text-cream/40">?</span>
              )}
            </motion.div>
            <div className="text-sm text-cream/85">
              {phase === 'calling' ? (
                nowPays > 0 ? (
                  <>
                    A line now pays <strong className="text-gold-200">{timesBet(nowPays)}</strong>
                  </>
                ) : (
                  'Last calls'
                )
              ) : phase === 'selling' ? (
                <>
                  Starting in <strong className="text-gold-200">{sellLeft}s</strong>
                </>
              ) : phase === 'done' ? (
                'Round over'
              ) : (
                'Waiting for players'
              )}
              <p className="mt-0.5 text-xs text-cream/60">
                {state.players.length === 0 ? 'Nobody in yet' : `${state.players.length} playing: ${state.players.map((p) => `${p.username} (${p.cards})`).join(', ')}`}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-1.5 gap-y-0.5" aria-label={`Called so far: ${called.join(', ') || 'none'}`}>
            {LETTERS.map((l, c5) => (
              <div key={l} className="contents">
                <span className="text-xs font-black text-gold-300" aria-hidden="true">{l}</span>
                <div className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-px" aria-hidden="true">
                  {Array.from({ length: 15 }, (_, i) => c5 * 15 + i + 1).map((n) => (
                    <span key={n} className={cn('rounded-sm py-0.5 text-center text-[0.5rem] font-bold tabular-nums', calledSet.has(n) ? 'bg-ruby-600 text-ivory' : 'bg-ink-950/50 text-cream/35')}>
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {phase === 'done' && state.winners.length > 0 && (
            <ul className="mt-3 space-y-0.5 text-sm">
              {state.winners.map((w) => (
                <li key={w.username} className="flex justify-between gap-2">
                  <span className="truncate text-cream/85">{w.username} · call {w.line_at}</span>
                  <ChipAmount value={w.payout} className="text-gold-200" iconClassName="h-3.5 w-3.5" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {myCards.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 p-4 text-center text-sm text-cream/70">
              {phase === 'calling' ? (
                'This round is under way. You can take cards for the next one when it finishes.'
              ) : (
                <>
                  <p>Choose a card price and how many cards, then take them.</p>
                  <p className="mt-1 text-xs text-cream/50">
                    A line in the first {c.returns[0][0]} calls pays <ChipAmount value={chipsFor(price, c.returns[0][1])} iconClassName="h-3 w-3" /> on a{' '}
                    <ChipAmount value={price} iconClassName="h-3 w-3" /> card.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {myCards.map((k) => (
                <BingoCard key={k.id} card={k} called={calledSet} done={phase === 'done'} />
              ))}
            </div>
          )}
        </div>
      </div>
    </SoloShell>
  );
}
