import { useState, type ReactNode } from 'react';
import { InfoModal, TabButtons } from '@/components/table/InfoModal';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { formatChips } from '@/lib/format';
import { chipsFor, CLASSIC_WINS, SYMBOLS, symbolArt, timesBet, type SlotInfo } from '@/lib/slots';
import { SlotSymbol } from './SlotSymbol';

type Tab = 'how' | 'pays';

function Tile({ game, sym }: { game: string; sym: string }) {
  return (
    <span className="inline-block h-9 w-9 shrink-0 align-middle">
      <SlotSymbol game={game} sym={sym} />
    </span>
  );
}

function Pay({ bet, units }: { bet: number; units: number | undefined }) {
  if (!units) return <span className="text-subtle">·</span>;
  return (
    <span className="whitespace-nowrap">
      <ChipAmount value={chipsFor(bet, units)} className="text-gold-200" iconClassName="h-3 w-3" />
      <span className="ml-1 text-[0.7rem] text-subtle">{timesBet(units)}</span>
    </span>
  );
}

const B = ({ children }: { children: ReactNode }) => <strong className="text-ivory">{children}</strong>;

function HowTo({ info }: { info: SlotInfo }) {
  const c = info.config;
  const g = info.game;
  const items: ReactNode[] = [];
  if (g === 'slots_classic') {
    items.push(
      <>Only the <B>middle row</B> counts. Three matching symbols pay, and so do any three bars.</>,
      <>Cherries pay on their own: one, two or three anywhere on the line.</>,
    );
  } else if (g === 'slots_cascade') {
    items.push(
      <>A group of <B>{c.min} or more touching gems</B> of one colour pays. Gems touch up, down, left or right, not diagonally.</>,
      <>Winning gems vanish, the ones above fall and new gems drop in. If that makes another group, it pays too.</>,
      <>Each cascade in a row raises the multiplier: <B>{(c.mults ?? []).map((m) => `×${m}`).join(', ')}</B>.</>,
    );
  } else if (g === 'slots_ways') {
    items.push(
      <>There are no paylines. A symbol pays when it shows on <B>three or more reels in a row from the left</B>, in any position.</>,
      <>Each reel shows 3 to {c.free?.height ?? 5} symbols, so a spin has 243 to 3,125 ways. More copies of a symbol on a reel means more ways, and each way pays.</>,
      <>The <B>Wild</B> (reels 2 to 4) stands in for any animal or card.</>,
      <><B>{c.free?.trigger} or more campfires</B> give {c.free?.spins} free spins on full-height reels. More campfires add {c.free?.spins} more, up to {c.free?.max}.</>,
    );
  } else {
    items.push(
      <><B>{c.lines} paylines</B>, always all in play. A line pays for matching symbols from the first reel going right.</>,
      <>The <B>Wild</B> (reels 2 to 4) stands in for any paying symbol.</>,
    );
    if (g === 'slots_paylines') {
      items.push(
        <><B>{c.free?.trigger} or more pyramids</B> anywhere pay a prize and give {c.free?.spins} free spins where <B>every win is ×{c.free?.mult}</B>.</>,
        <>More pyramids during free spins add {c.free?.spins} more, up to {c.free?.max}.</>,
      );
    }
    if (c.hold) {
      items.push(
        <>Every <B>pearl</B> shows a prize. Land <B>{c.hold.trigger} or more</B> in one spin to start Hold &amp; Win.</>,
        <>The pearls lock and everything else respins. You get {c.hold.respins} respins, and each new pearl resets the count.</>,
        <>When the respins run out you win every pearl. Fill all 15 cells for the <B>grand prize of {timesBet(c.hold.grand)} your bet</B> on top.</>,
      );
    }
    if (c.jackpot) {
      items.push(
        <><B>{c.jackpot.feed_bp / 100}% of every bet</B> on this machine goes into one jackpot shared by all players.</>,
        <>Any spin can win it. Your chance is in proportion to your bet, so a bet ten times bigger is ten times as likely.</>,
        <>A win pays the <B>whole pot</B> and five crowns land on the middle row. The pot then restarts at {formatChips(c.jackpot.seed)}.</>,
      );
    }
  }
  return (
    <div className="mt-5 space-y-3 text-sm leading-relaxed text-cream/85">
      <p>
        Pick your bet and press <B>Spin</B>. The whole round, including any free spins or respins, is decided by the server
        the moment you spin. The reels just show you what happened.
      </p>
      <ul className="list-disc space-y-1.5 pl-5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
        Over a very long run this machine pays back about {c.rtp}% of what is bet. Any one session can land far above or
        below that. Play chips have no cash value.
      </p>
    </div>
  );
}

function Paytable({ info, bet }: { info: SlotInfo; bet: number }) {
  const c = info.config;
  const g = info.game;
  const order = Object.keys(SYMBOLS[g] ?? {});
  const head = 'py-2 text-xs font-semibold uppercase tracking-wider text-muted';

  let table: ReactNode;
  if (c.kind === 'classic') {
    const pays = c.pays as Record<string, number>;
    const rows = Object.keys(CLASSIC_WINS).sort((a, b) => pays[b] - pays[a]);
    table = (
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Paytable</caption>
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((k) => (
            <tr key={k}>
              <th scope="row" className="py-2 font-normal text-cream/90">{CLASSIC_WINS[k]}</th>
              <td className="py-2 text-right"><Pay bet={bet} units={pays[k]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (c.kind === 'cluster') {
    const pays = c.pays as Record<string, number[]>;
    const sizes = c.sizes ?? [];
    table = (
      <div className="scrollbar-thin -mx-1 overflow-x-auto px-1">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Paytable by group size</caption>
          <thead>
            <tr>
              <th scope="col" className={head}>Gems</th>
              {sizes.map((s, i) => (
                <th key={s} scope="col" className={`${head} px-2 text-right`}>
                  {sizes[i + 1] && sizes[i + 1] > s + 1 ? `${s}–${sizes[i + 1] - 1}` : i === sizes.length - 1 ? `${s}+` : s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {order.map((s) => (
              <tr key={s}>
                <th scope="row" className="py-1.5 pr-2 font-normal">
                  <Tile game={g} sym={s} />
                  <span className="sr-only">{symbolArt(g, s).label}</span>
                </th>
                {sizes.map((sz, i) => (
                  <td key={sz} className="px-2 py-1.5 text-right tabular-nums text-gold-200">
                    {formatChips(chipsFor(bet, pays[s][i]))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    const pays = c.pays as Record<string, Record<string, number>>;
    const counts = ['5', '4', '3', '2'].filter((n) => Object.values(pays).some((p) => p[n]));
    table = (
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Paytable</caption>
        <thead>
          <tr>
            <th scope="col" className={head}>Symbol</th>
            {counts.map((n) => (
              <th key={n} scope="col" className={`${head} text-right`}>{n} in a row</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {order.filter((s) => pays[s]).map((s) => (
            <tr key={s}>
              <th scope="row" className="py-1.5 font-normal">
                <Tile game={g} sym={s} />
                <span className="ml-2 hidden text-cream/85 xs:inline">{symbolArt(g, s).label}</span>
              </th>
              {counts.map((n) => (
                <td key={n} className="py-1.5 text-right"><Pay bet={bet} units={pays[s][n]} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <p className="text-xs text-muted">
        Prizes at your current bet of <ChipAmount value={bet} className="text-cream" iconClassName="h-3 w-3" />
        {c.kind === 'ways' ? ', for each way.' : c.kind === 'lines' ? ', for each winning line.' : '.'}
      </p>
      {table}
      {c.scatter_pays && c.scatter && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-cream/85">
          <Tile game={g} sym={c.scatter} />
          {Object.entries(c.scatter_pays).map(([n, u]) => (
            <span key={n}>{n} anywhere: <Pay bet={bet} units={u} /></span>
          ))}
        </p>
      )}
      {c.hold && (
        <div className="text-sm text-cream/85">
          <p className="flex items-center gap-2">
            <Tile game={g} sym={c.hold.symbol} /> A pearl can carry:
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {c.hold.values.map((v) => (
              <ChipAmount key={v} value={chipsFor(bet, v)} className="text-gold-200" iconClassName="h-3 w-3" />
            ))}
          </p>
        </div>
      )}
      {c.jackpot && info.jackpot && (
        <p className="flex items-center gap-2 text-sm text-cream/85">
          <Tile game={g} sym={c.jackpot.symbol} /> The jackpot pays whatever is in the pot, at any bet.
        </p>
      )}
    </div>
  );
}

export function SlotRulesModal({ open, onClose, info, bet }: { open: boolean; onClose: () => void; info: SlotInfo; bet: number }) {
  const [tab, setTab] = useState<Tab>('how');
  return (
    <InfoModal open={open} onClose={onClose} title={info.name}>
      <TabButtons
        tabs={[
          ['how', 'How to play'],
          ['pays', 'Paytable'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'how' ? <HowTo info={info} /> : <Paytable info={info} bet={bet} />}
    </InfoModal>
  );
}
