import { useState, type ReactNode } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

/** Spanish 21, Blackjack Switch, Free Bet Blackjack and Pontoon: one solo table (20_blackjack_variants.sql). */
interface Config {
  bj: [number, number];
  h17: boolean;
  pontoon?: boolean;
  two_hands?: boolean;
  free?: boolean;
  min_stand?: number;
}
interface Hand {
  cards: number[];
  stake: number;
  free: number;
  done: boolean;
  doubled: boolean;
  natural: boolean;
  surrendered?: boolean;
  outcome?: string;
  returned?: number;
  total?: number;
}
interface Round {
  game: string;
  bet: number;
  hands: Hand[];
  active: number | null;
  dealer: number[];
  actions: { key: string; cost: number }[];
  round_id: string;
  balance?: number;
  final?: boolean;
  dealer_total?: number;
  dealer_blackjack?: boolean;
  staked?: number;
  win?: number;
}

const value = (c: number) => (c % 13 === 0 ? 1 : c % 13 >= 9 ? 10 : (c % 13) + 1);
function total(cards: number[]): { total: number; soft: boolean } {
  const sum = cards.reduce((n, c) => n + value(c), 0);
  const soft = cards.some((c) => c % 13 === 0) && sum + 10 <= 21;
  return { total: soft ? sum + 10 : sum, soft };
}
const B = ({ children }: { children: ReactNode }) => <strong className="text-ivory">{children}</strong>;

// Pontoon's own words for hit and stand. (Its word for doubling is avoided: the site never uses it.)
const PONTOON = { hit: 'Twist', stand: 'Stick', double: 'Double' } as Record<string, string>;
const LABEL: Record<string, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender', switch: 'Switch' };
const OUTCOME: Record<string, string> = { win: 'Win', lose: 'Lose', push: 'Push', bust: 'Bust', blackjack: 'Blackjack', surrender: 'Surrendered', bonus: 'Bonus 21', five_card: 'Five-card trick' };

const RULES: Record<string, { rules: ReactNode; tip: string }> = {
  spanish_21: {
    rules: (
      <>
        <p>
          Blackjack played with the four <B>10-spot cards taken out</B> of every deck (jacks, queens and kings stay). In return the rules lean
          your way.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            A player <B>21 always wins</B>, even against a dealer 21, and a player blackjack beats a dealer blackjack.
          </li>
          <li>Double on any number of cards, split up to four hands, and surrender half your bet on your first two cards.</li>
          <li>
            <B>Bonus 21s</B> (not after doubling): five cards pays 3 to 2, six cards 2 to 1, seven or more 3 to 1. A 6-7-8 or 7-7-7 pays 3 to 2,
            2 to 1 in one suit, 3 to 1 in spades.
          </li>
          <li>Blackjack pays 3 to 2. The dealer hits a soft 17.</li>
        </ul>
      </>
    ),
    tip: 'With fewer tens in the deck, hit a little more often than in ordinary blackjack and don’t rush to stand on 12 to 16.',
  },
  blackjack_switch: {
    rules: (
      <>
        <p>
          You play <B>two hands</B> with equal bets. Before doing anything else you may <B>Switch</B>: the second card of each hand changes places.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>That is a big advantage, so two rules pay for it.</li>
          <li>
            <B>Blackjack pays even money</B>, and a blackjack you make by switching is an ordinary 21.
          </li>
          <li>
            A <B>dealer 22 is a push</B> against every hand still standing, not a bust (a blackjack you were dealt still wins).
          </li>
          <li>Double on any two cards and after a split. The dealer hits a soft 17.</li>
        </ul>
      </>
    ),
    tip: 'Switch when it turns two weak hands into one strong one, especially to make 20, 21 or a pair of aces.',
  },
  free_bet_blackjack: {
    rules: (
      <>
        <p>
          Ordinary blackjack, except <B>the house pays for some of your bets</B>.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <B>Free double</B> on a hard 9, 10 or 11 with two cards.
          </li>
          <li>
            <B>Free split</B> on every pair except ten-value cards.
          </li>
          <li>A free bet that wins is paid like a real one. If it loses, you lose nothing extra.</li>
          <li>
            The price: a <B>dealer 22 is a push</B> against every hand still standing, not a bust.
          </li>
          <li>Blackjack pays 3 to 2. The dealer hits a soft 17.</li>
        </ul>
      </>
    ),
    tip: 'Take every free double and free split you are offered: they cost you nothing.',
  },
  pontoon: {
    rules: (
      <>
        <p>
          The British cousin of blackjack. <B>Twist</B> takes a card, <B>Stick</B> stands, and <B>Double</B> doubles your bet for a card (you can still
          twist afterwards).
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Both of the dealer&apos;s cards are <B>face down</B> until you finish.
          </li>
          <li>
            You can&apos;t stick below <B>15</B>.
          </li>
          <li>
            A <B>pontoon</B> (an ace with a ten-value card) and a <B>five-card trick</B> (five cards without going over 21) both pay 2 to 1. A
            pontoon beats a five-card trick, which beats everything else.
          </li>
          <li>
            The <B>dealer wins all ties</B>.
          </li>
        </ul>
      </>
    ),
    tip: 'With four cards and a low total, twist: a five-card trick beats even a dealer 21.',
  },
};

export function BlackjackVariantGame({ gameKey }: { gameKey: string }) {
  const { info, error, load, call } = useSoloGame<Config, Round>(gameKey, 'quick_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Opening the table…" />;
  return <Table info={info} call={call} />;
}

function Table({ info, call }: { info: SoloInfo<Config, Round>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const game = info.game;
  const cfg = info.config;
  const s = useSpotBets(info.tiers, info.game);
  const [round, setRound] = useState<Round | null>(info.round as Round | null);
  const [shown, setShown] = useState(true);
  const [dealerBefore, setDealerBefore] = useState(0);
  const [busy, setBusy] = useState(false);
  const live = round && !round.final ? round : null;
  const done = round?.final ? round : null;
  const hands = cfg.two_hands ? 2 : 1;

  const finish = async (res: Round, start: number, upCards: number) => {
    setDealerBefore(upCards);
    setShown(false);
    setRound(res);
    await sleep(900);
    setShown(true);
    settleBalance(res.balance ?? start);
    playSound((res.win ?? 0) > (res.staked ?? 0) ? 'win' : res.win === res.staked ? 'chip' : 'lose');
  };

  const deal = async () => {
    if (busy) return;
    const bet = s.bets.bet ?? 0;
    if (!bet) return toast.info('Put chips on the bet spot first');
    if (s.balance < bet * hands) return toast.info('Not enough chips', hands === 2 ? 'This game plays two hands, so it takes two bets.' : undefined);
    setBusy(true);
    s.remember();
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - bet * hands);
    const [res, err] = await call<Round>('bjv_deal', { p_game: game, p_tier: s.tierKey, p_bet: bet });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    s.clear();
    if (res.final) await finish(res, start, cfg.pontoon ? 0 : 1);
    else {
      setShown(true);
      setRound(res);
      settleBalance(res.balance ?? start);
    }
    setBusy(false);
  };

  const act = async (key: string, cost: number) => {
    if (busy || !live) return;
    setBusy(true);
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - cost);
    const [res, err] = await call<Round>('bjv_act', { p_game: game, p_action: key });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound(key === 'hit' || key === 'double' || key === 'split' || key === 'switch' ? 'card' : 'click');
    if (res.final) await finish(res, start, live.dealer.length);
    else {
      setRound(res);
      settleBalance(res.balance ?? start);
    }
    setBusy(false);
  };

  const betting = !live && s.total > 0;
  const view = betting ? null : round;
  const label = (k: string) => (cfg.pontoon ? (PONTOON[k] ?? LABEL[k]) : LABEL[k]) ?? k;
  const dealerCards = view ? (done && !shown ? view.dealer.slice(0, dealerBefore) : view.dealer) : [];
  const dealerSlots = Math.max(2, dealerCards.length);
  const status = live
    ? `${live.hands.length > 1 ? `Hand ${(live.active ?? 0) + 1}: ` : ''}you have ${total(live.hands[live.active ?? 0].cards).total}.`
    : done && !betting
      ? shown
        ? done.dealer_blackjack
          ? cfg.pontoon
            ? 'The dealer has a pontoon.'
            : 'The dealer has blackjack.'
          : `The dealer has ${done.dealer_total}${(done.dealer_total ?? 0) > 21 ? ': bust' : ''}.`
        : 'The dealer plays…'
      : 'Place your bet';

  return (
    <SoloShell
      info={info}
      tier={live ? (info.round?.tier ?? s.tierKey) : s.tierKey}
      status={status}
      controls={
        live ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {live.actions.map((a) => (
              <Button key={a.key} variant={a.key === 'hit' || a.key === 'stand' ? 'gold' : 'outline'} disabled={busy} onClick={() => void act(a.key, a.cost)}>
                {label(a.key)}{' '}
                {a.cost > 0 ? (
                  <ChipAmount value={a.cost} className="ml-1" iconClassName="h-3.5 w-3.5" />
                ) : (
                  (a.key === 'double' || a.key === 'split') && cfg.free && <span className="ml-1 rounded bg-felt-600 px-1 text-[0.65rem] font-bold uppercase text-felt-100">free</span>
                )}
              </Button>
            ))}
          </div>
        ) : (
          <SpotControls s={s} tiers={info.tiers} busy={busy} action="Deal" onAction={() => void deal()} />
        )
      }
      rules={
        <>
          {RULES[game]?.rules}
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">{RULES[game]?.tip} Cards are dealt by the server from six decks, shuffled for every hand. Play chips have no cash value.</p>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">Dealer</p>
          <div className="mt-2 flex min-h-[4.9rem] flex-wrap justify-center gap-1.5">
            {view &&
              Array.from({ length: dealerSlots }).map((_, i) => (
                <PlayingCard key={`${view.round_id}-d${i}-${dealerCards[i] ?? 'x'}`} card={i < dealerCards.length ? dealerCards[i] : null} size="md" index={i} />
              ))}
          </div>
          <p className="mt-1 min-h-5 text-sm text-cream/80">{done && shown && !betting ? `${done.dealer_total}${(done.dealer_total ?? 0) > 21 ? ' (bust)' : ''}` : ' '}</p>
        </div>

        <div className="flex w-full flex-wrap items-start justify-center gap-x-5 gap-y-3">
          {view?.hands.map((h, i) => {
            const t = total(h.cards);
            const active = live?.active === i;
            const out = done && shown ? h.outcome : undefined;
            return (
              <div key={i} className={cn('rounded-2xl border px-2 py-2 text-center transition', active ? 'border-gold-400 bg-gold-500/10' : 'border-transparent')}>
                <div className="flex min-h-[4.9rem] justify-center">
                  {h.cards.map((c, k) => (
                    <div key={`${view.round_id}-h${i}-${k}-${c}`} className={k > 0 ? '-ml-6' : undefined}>
                      <PlayingCard card={c} size="md" index={k} />
                    </div>
                  ))}
                </div>
                <p className={cn('mt-1 text-sm font-semibold', t.total > 21 ? 'text-ruby-300' : 'text-gold-200')}>
                  {t.total > 21 ? 'Bust' : `${t.soft && t.total < 21 ? 'Soft ' : ''}${t.total}`}
                  {out && <span className={cn('ml-1.5', out === 'lose' || out === 'bust' ? 'text-ruby-300' : out === 'push' || out === 'surrender' ? 'text-cream/80' : 'text-felt-300')}>· {OUTCOME[out] ?? out}</span>}
                </p>
                <p className="text-xs text-cream/70">
                  <ChipAmount value={h.stake} iconClassName="h-3 w-3" />
                  {h.free > 0 && <span className="ml-1 text-felt-300">+ {h.free} free</span>}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {!view && (
        <div className="mx-auto mt-3 max-w-[11rem]">
          <BetSpot name="Bet" pays={hands === 2 ? 'on each of two hands' : cfg.bj[0] === cfg.bj[1] ? 'blackjack 1 to 1' : `blackjack ${cfg.bj[0]} to ${cfg.bj[1]}`} amount={s.bets.bet ?? 0} onClick={() => s.add('bet')} disabled={busy} />
        </div>
      )}
      {done && shown && !betting && <Outcome staked={done.staked ?? 0} win={done.win ?? 0} />}
    </SoloShell>
  );
}
