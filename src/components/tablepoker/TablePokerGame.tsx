import { useState, type ReactNode } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from '@/components/solo/SoloShell';
import { ACTION_KEYS } from '@/lib/hotkeys';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { HAND_NAMES, holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

/**
 * One screen for the six card games against the dealer in 19_table_poker.sql.
 * The server says what the player may do next (`actions`, with what each costs),
 * so this only lays the cards out and words things.
 */
interface Config {
  spots: string[];
  reserve: number;
  upfront?: number;
  paytables: { title: string; key: string }[];
  [table: string]: unknown;
}
interface Round {
  game: string;
  stage: string;
  hand: number[];
  board: number[];
  dealer: number[];
  main: number;
  bets: Record<string, number>;
  made: string | null;
  actions: { key: string; cost: number }[];
  round_id: string;
  balance?: number;
  final?: boolean;
  outcome?: 'win' | 'lose' | 'tie' | 'fold' | 'no_qualify' | 'push';
  dealer_made?: string | null;
  qualifies?: boolean | null;
  returns?: Record<string, number>;
  staked?: number;
  win?: number;
}

/** How each game is laid out and worded. */
interface Layout {
  dealer: number;
  board: number;
  /** What the dealer needs to play, for the status line and rules. */
  qualify?: string;
  spotLabels: Record<string, string>;
  rules: ReactNode;
  tip: string;
}

const ACTION_LABEL: Record<string, string> = { fold: 'Fold', raise: 'Raise', call: 'Call', play: 'Play', pull: 'Take one back', ride: 'Let it ride', bet1: 'Bet 1×', bet2: 'Bet 2×', bet3: 'Bet 3×' };
const OUTCOME: Record<string, string> = {
  win: 'You win!',
  lose: 'No win this hand.',
  tie: 'A tie: your bets come back.',
  push: 'A push: your bets come back.',
  fold: 'You folded.',
  no_qualify: "The dealer doesn't qualify.",
};
const STAGE: Record<string, string> = { first: 'First choice', second: 'Second choice', third: 'Third street', fourth: 'Fourth street', fifth: 'Fifth street' };
const B = ({ children }: { children: ReactNode }) => <strong className="text-ivory">{children}</strong>;

const LAYOUTS: Record<string, Layout> = {
  caribbean_stud: {
    dealer: 5,
    board: 0,
    qualify: 'ace-king high or better',
    spotLabels: { ante: 'Ante', raise: 'Raise' },
    rules: (
      <>
        <p>
          You and the dealer each get five cards, and one of the dealer&apos;s is turned up. After looking at your hand, <B>Fold</B> and lose the
          ante, or <B>Raise</B> by twice the ante.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            The dealer needs <B>ace-king high or better</B> to qualify. If not, your ante pays 1 to 1 and the raise comes back.
          </li>
          <li>If the dealer qualifies and your hand is better, the ante pays 1 to 1 and the raise pays by the table below.</li>
          <li>A tie returns both bets. If the dealer&apos;s hand is better, both lose.</li>
        </ul>
      </>
    ),
    tip: 'A simple guide: raise with any pair or better, fold with less than ace-king.',
  },
  casino_holdem: {
    dealer: 2,
    board: 5,
    qualify: 'a pair of fours or better',
    spotLabels: { ante: 'Ante', call: 'Call' },
    rules: (
      <>
        <p>
          Texas Hold&apos;em against the dealer. You get two cards and see the three-card flop. <B>Fold</B> and lose the ante, or <B>Call</B> for twice
          the ante to see the last two cards.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Both hands use the best five of their two cards and the five on the board.</li>
          <li>
            The dealer needs <B>a pair of fours or better</B> to qualify. If not, the ante pays by the table below and the call comes back.
          </li>
          <li>If the dealer qualifies and you win, the ante pays by the table and the call pays 1 to 1. A tie returns both.</li>
        </ul>
      </>
    ),
    tip: 'A simple guide: call with any pair, any ace or king, or any draw to a straight or flush. Fold two low cards that miss the flop.',
  },
  let_it_ride: {
    dealer: 0,
    board: 2,
    spotLabels: { bet: 'Bets riding' },
    rules: (
      <>
        <p>
          There is no dealer hand. You put down <B>three equal bets</B> and get three cards; two shared cards are face down. Twice you choose to{' '}
          <B>take one bet back</B> or <B>let it ride</B>: once before the first shared card is turned, once before the second.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Your five cards are your three and the two shared ones.</li>
          <li>Every bet still riding is paid by the table below. The lowest paying hand is a pair of tens.</li>
          <li>A bet you take back is returned at once. The last bet always plays.</li>
        </ul>
      </>
    ),
    tip: 'A simple guide: let it ride with a paying hand already made, or three cards to a straight flush. Otherwise take the bet back.',
  },
  mississippi_stud: {
    dealer: 0,
    board: 3,
    spotLabels: { ante: 'Ante', third: '3rd street', fourth: '4th street', fifth: '5th street' },
    rules: (
      <>
        <p>
          There is no dealer hand. You get two cards and three shared cards are face down. Before each shared card is turned you either <B>Fold</B>{' '}
          or <B>bet 1, 2 or 3 times your ante</B>.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>After the last card, all your bets are paid by the table below on your five cards.</li>
          <li>A pair of jacks or better wins. A pair of sixes to tens returns your bets. Anything less loses them.</li>
          <li>Folding gives up everything you have put in so far.</li>
        </ul>
      </>
    ),
    tip: 'A simple guide: bet 3× with any pair, 1× with at least one card of six or higher, and fold two low cards that don’t match.',
  },
  four_card_poker: {
    dealer: 6,
    board: 0,
    spotLabels: { ante: 'Ante', aces_up: 'Aces Up', raise: 'Raise' },
    rules: (
      <>
        <p>
          You get five cards and make your best <B>four-card</B> hand. The dealer gets six cards to make theirs, with one turned up. <B>Fold</B>, or{' '}
          <B>raise 1, 2 or 3 times your ante</B>.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Four-card order: four of a kind, straight flush, three of a kind, flush, straight, two pair, pair, high card.</li>
          <li>The dealer always plays, and you win ties. Win and the ante and raise both pay 1 to 1.</li>
          <li>
            <B>Aces Up</B> is a side bet on your own hand: a pair of aces or better pays, whatever the dealer has.
          </li>
        </ul>
      </>
    ),
    tip: 'A simple guide: raise 3× with a pair of tens or better, 1× with a pair of twos to nines, and fold anything less.',
  },
  teen_patti: {
    dealer: 3,
    board: 0,
    qualify: 'queen high or better',
    spotLabels: { ante: 'Ante', pair_plus: 'Pair Plus', play: 'Play' },
    rules: (
      <>
        <p>
          Three cards each. Look at yours, then <B>Play</B> (a second bet equal to your ante) or <B>Fold</B>.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Teen Patti order: <B>trail</B> (three of a kind), <B>pure sequence</B> (straight flush), <B>sequence</B> (straight), <B>colour</B> (flush),
            pair, high card. A-K-Q is the best sequence and A-2-3 the second best.
          </li>
          <li>
            The dealer needs <B>queen high or better</B> to qualify. If not, your ante pays 1 to 1 and the Play bet comes back.
          </li>
          <li>If the dealer qualifies, the better hand wins both bets at 1 to 1. A tie returns them.</li>
          <li>
            <B>Pair Plus</B> is a side bet on your own cards, paid even if you fold.
          </li>
        </ul>
      </>
    ),
    tip: 'A simple guide: play with queen-six-four or better, fold anything lower.',
  },
};

export function TablePokerGame({ gameKey }: { gameKey: string }) {
  const { info, error, load, call } = useSoloGame<Config, Round>(gameKey, 'game_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Opening the table…" />;
  return <Table info={info} call={call} />;
}

function Table({ info, call }: { info: SoloInfo<Config, Round>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const game = info.game;
  const cfg = info.config;
  const lay = LAYOUTS[game];
  const s = useSpotBets(info.tiers, info.game);
  const [round, setRound] = useState<Round | null>(info.round as Round | null);
  const [shown, setShown] = useState(true);
  // While the last cards are being turned, keep showing only what was face up before.
  const [before, setBefore] = useState({ board: 0, dealer: 0 });
  const [busy, setBusy] = useState(false);
  const mainKey = cfg.spots[0];
  const live = round && !round.final ? round : null;
  const done = round?.final ? round : null;

  const deal = async () => {
    if (busy) return;
    const main = s.bets[mainKey] ?? 0;
    if (!main) return toast.info(`Put chips on ${lay.spotLabels[mainKey]} first`);
    const upfront = s.total + main * ((cfg.upfront ?? 1) - 1);
    if (s.balance < upfront + main * cfg.reserve) return toast.info('Not enough chips', 'You need enough for the bets that come later in the hand too.');
    setBusy(true);
    s.remember();
    const bets = Object.fromEntries(Object.entries(s.bets).filter(([, v]) => v > 0));
    const [res, err] = await call<Round>('tp_deal', { p_game: game, p_tier: s.tierKey, p_bets: bets });
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    setShown(true);
    setRound(res);
    settleBalance(res.balance ?? s.balance);
    s.clear();
  };

  const act = async (key: string, cost: number) => {
    if (busy || !live) return;
    setBusy(true);
    const start = useWallet.getState().status?.balance ?? 0;
    // The server pays as it reveals: hold the header until the cards have turned.
    holdBalance(start - cost);
    const [res, err] = await call<Round>('tp_act', { p_game: game, p_action: key });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound(cost > 0 ? 'chip' : key === 'fold' ? 'click' : 'card');
    if (res.final) {
      setBefore({ board: live.board.length, dealer: live.dealer.length });
      setShown(false);
      setRound(res);
      await sleep(900);
      setShown(true);
      settleBalance(res.balance ?? start);
      playSound((res.win ?? 0) > (res.staked ?? 0) ? 'win' : res.win === res.staked ? 'chip' : 'lose');
    } else {
      setRound(res);
      settleBalance(res.balance ?? start);
    }
    setBusy(false);
  };

  const betting = !live && s.total > 0;
  const view = betting ? null : round;
  const made = view?.made ? HAND_NAMES[view.made] ?? view.made : null;
  const status = live
    ? STAGE[live.stage]
      ? `${STAGE[live.stage]}: ${made ? `you have ${made.toLowerCase()}.` : 'your move.'}`
      : made
        ? `You have ${made.toLowerCase()}.`
        : 'Your move.'
    : done && !betting
      ? shown
        ? `${OUTCOME[done.outcome ?? 'lose']}${done.outcome === 'no_qualify' ? ' Your ante is paid.' : ''}`
        : 'The cards are turned…'
      : `Place your ${lay.spotLabels[mainKey].toLowerCase()}`;

  // Every spot that has, or can have, chips on it this hand.
  const spotKeys = [...new Set([...cfg.spots, ...Object.keys(lay.spotLabels)])];
  const amount = (k: string) => (view ? view.bets[k] ?? 0 : s.bets[k] ?? 0);
  const spotState = (k: string) => (done && shown && !betting && (done.bets[k] ?? 0) > 0 ? ((done.returns?.[k] ?? 0) > (done.bets[k] ?? 0) ? 'win' : (done.returns?.[k] ?? 0) === done.bets[k] ? null : 'lose') : null);

  const cards = (list: number[], total: number, prefix: string, offset: number) =>
    Array.from({ length: total }).map((_, i) => (
      <PlayingCard key={`${view?.round_id ?? 'none'}-${prefix}${i}-${list[i] ?? 'x'}`} card={view && i < list.length ? list[i] : null} size="md" index={i + offset} />
    ));

  return (
    <SoloShell
      info={info}
      tier={live ? (info.round?.tier ?? s.tierKey) : s.tierKey}
      status={status}
      controls={
        live ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {live.actions.map((a) => (
              <Button
                key={a.key}
                variant={a.key === 'fold' || a.key === 'pull' ? 'outline' : 'gold'}
                disabled={busy}
                onClick={() => void act(a.key, a.cost)}
                hotkey={ACTION_KEYS[a.key]}
                hotkeyLabel={ACTION_LABEL[a.key] ?? a.key}
                className={a.cost > 0 ? 'min-w-24' : undefined}
              >
                {ACTION_LABEL[a.key] ?? a.key}
                {a.cost > 0 && <ChipAmount value={a.cost} className="ml-1.5" iconClassName="h-3.5 w-3.5" />}
              </Button>
            ))}
          </div>
        ) : (
          <SpotControls s={s} tiers={info.tiers} busy={busy} action="Deal" onAction={() => void deal()} />
        )
      }
      rules={
        <>
          {lay.rules}
          {cfg.paytables.map((t) => {
            const pays = cfg[t.key] as Record<string, number>;
            return (
              <table key={t.key} className="w-full text-sm">
                <caption className="pb-1 text-left text-xs font-semibold uppercase tracking-wider text-gold-400">{t.title}</caption>
                <tbody>
                  {Object.entries(pays)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <tr key={k} className="border-b border-white/[0.06]">
                        <th scope="row" className="py-1 text-left font-normal text-cream/85">
                          {HAND_NAMES[k] ?? k}
                        </th>
                        <td className="py-1 text-right tabular-nums text-gold-200">{v === 0 ? 'bets returned' : `${v} to 1`}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            );
          })}
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">{lay.tip} Every card is dealt by the server from one fresh deck. Play chips have no cash value.</p>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        {lay.dealer > 0 && (
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">Dealer</p>
            <div className="mt-2 flex min-h-[4.9rem] flex-wrap justify-center gap-1.5 sm:gap-2">{view && cards(shown ? view.dealer : view.dealer.slice(0, before.dealer), lay.dealer, 'd', 5)}</div>
            <p className="mt-1 min-h-5 text-sm text-cream/80">
              {done && shown && !betting && done.dealer_made
                ? `${HAND_NAMES[done.dealer_made] ?? done.dealer_made}${done.qualifies === false ? ' (does not qualify)' : ''}`
                : lay.qualify
                  ? `Plays with ${lay.qualify}`
                  : ' '}
            </p>
          </div>
        )}
        {lay.board > 0 && (
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">Shared cards</p>
            <div className="mt-2 flex min-h-[4.9rem] justify-center gap-1.5 sm:gap-2">{view && cards(shown ? view.board : view.board.slice(0, before.board), lay.board, 'b', 2)}</div>
          </div>
        )}
        <div className="text-center">
          <div className="flex min-h-[4.9rem] flex-wrap justify-center gap-1.5 sm:gap-2">{view?.hand.map((c, i) => <PlayingCard key={`${view.round_id}-p${i}`} card={c} size="md" index={i} />)}</div>
          <p className={cn('mt-1 min-h-5 text-sm font-semibold', view ? 'text-gold-200' : 'text-cream/60')}>{view ? (made ?? 'Your cards') : 'Your hand'}</p>
        </div>
      </div>

      <div className={cn('mx-auto mt-3 grid max-w-lg gap-2', spotKeys.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : spotKeys.length === 3 ? 'grid-cols-3' : spotKeys.length === 2 ? 'max-w-xs grid-cols-2' : 'max-w-[10rem] grid-cols-1')}>
        {spotKeys.map((k) => {
          const placeable = cfg.spots.includes(k);
          return (
            <BetSpot
              key={k}
              name={lay.spotLabels[k] ?? k}
              pays={placeable ? (k === mainKey ? (cfg.upfront ? 'by the table' : '1 to 1') : 'side bet') : 'during the hand'}
              amount={k === mainKey && !view && cfg.upfront ? (s.bets[k] ?? 0) * cfg.upfront : amount(k)}
              onClick={() => (placeable ? s.add(k) : undefined)}
              disabled={busy || Boolean(live) || !placeable}
              state={spotState(k)}
            />
          );
        })}
      </div>

      {done && shown && !betting && (
        <>
          <Outcome staked={done.staked ?? 0} win={done.win ?? 0} />
          {(done.returns?.ante_bonus ?? 0) > 0 && (
            <p className="mt-1 text-center text-xs text-gold-200">
              Includes an ante bonus of <ChipAmount value={done.returns?.ante_bonus ?? 0} iconClassName="h-3 w-3" />
            </p>
          )}
        </>
      )}
    </SoloShell>
  );
}
