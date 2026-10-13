import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * One icon per game: every game in the catalogue has a drawing of its own, and no two are alike
 * (the user's request). They are small SVGs on a 48 x 48 grid, built from a few shared pieces
 * (a playing card, a die, a chip, a video poker screen). A new game needs an entry in ICONS;
 * until it has one it gets the plain chip at the bottom.
 */
const GOLD = '#d4af37';
const GOLD_DARK = '#86661c';
const IVORY = '#f4ead2';
const WHITE = '#fffaf0';
const RED = '#c9303f';
const RUBY = '#a81c2c';
const INK = '#0b0d0c';
const FELT = '#135c3e';
const GREEN = '#5cc392';
const BLUE = '#3566c4';
const SKY = '#8fb0f0';
const PURPLE = '#b78cff';
const ORANGE = '#f0932b';

type SuitKey = 's' | 'h' | 'd' | 'c';
/** Each suit drawn in a 10 x 10 box. */
const SUIT: Record<SuitKey, string> = {
  s: 'M5 .5C3 3.2.6 4.6.6 6.9a2.2 2.2 0 0 0 3.8 1.5L3.6 10h2.8l-.8-1.6a2.2 2.2 0 0 0 3.8-1.5C9.4 4.6 7 3.2 5 .5z',
  h: 'M5 9.6C2.5 7.4.5 5.7.5 3.5A2.4 2.4 0 0 1 5 2.3a2.4 2.4 0 0 1 4.5 1.2c0 2.2-2 3.9-4.5 6.1z',
  d: 'M5 .3L9.2 5 5 9.7.8 5z',
  c: 'M5 .6a2.2 2.2 0 0 0-2 3.1 2.2 2.2 0 1 0 1.5 3.8L3.7 10h2.6l-.8-2.5A2.2 2.2 0 1 0 7 3.7 2.2 2.2 0 0 0 5 .6z',
};

function Suit({ s, x, y, size, fill }: { s: SuitKey; x: number; y: number; size: number; fill?: string }) {
  return <path d={SUIT[s]} transform={`translate(${x} ${y}) scale(${size / 10})`} fill={fill ?? (s === 'h' || s === 'd' ? RED : INK)} />;
}

function Label({ x, y, size, fill = INK, children }: { x: number; y: number; size: number; fill?: string; children: ReactNode }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight="800" fontFamily="Georgia, 'Times New Roman', serif" fill={fill}>
      {children}
    </text>
  );
}

/** A playing card: a rank, a suit, both, or its back. */
function Card({
  x,
  y,
  w = 16,
  h = 22,
  rot = 0,
  rank,
  suit,
  back,
  fill = WHITE,
  ink,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  rot?: number;
  rank?: string;
  suit?: SuitKey;
  back?: string;
  fill?: string;
  ink?: string;
}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const colour = ink ?? (suit === 'h' || suit === 'd' ? RED : INK);
  const fs = h * (suit ? 0.42 : rank && rank.length > 1 ? 0.48 : 0.6);
  const ss = w * (rank ? 0.46 : 0.62);
  return (
    <g transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={w * 0.14} fill={back ?? fill} stroke={GOLD} strokeWidth="1" />
      {back && <rect x={x + 2} y={y + 2} width={w - 4} height={h - 4} rx={w * 0.08} fill="none" stroke={GOLD} strokeWidth="0.7" opacity="0.7" />}
      {!back && rank && (
        <Label x={cx} y={suit ? y + h * 0.46 : cy + fs * 0.35} size={fs} fill={colour}>
          {rank}
        </Label>
      )}
      {!back && suit && <Suit s={suit} x={cx - ss / 2} y={rank ? y + h * 0.54 : cy - ss / 2} size={ss} fill={ink} />}
    </g>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};

function Die({ x, y, s = 18, rot = 0, n, fill = IVORY, pip = INK }: { x: number; y: number; s?: number; rot?: number; n: number; fill?: string; pip?: string }) {
  return (
    <g transform={rot ? `rotate(${rot} ${x + s / 2} ${y + s / 2})` : undefined}>
      <rect x={x} y={y} width={s} height={s} rx={s * 0.2} fill={fill} stroke={GOLD} strokeWidth="1.1" />
      {PIPS[n].map(([px, py], i) => (
        <circle key={i} cx={x + px * s} cy={y + py * s} r={s * 0.095} fill={pip} />
      ))}
    </g>
  );
}

function Chip({ cx, cy, r, fill = RUBY }: { cx: number; cy: number; r: number; fill?: string }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={GOLD} strokeWidth="1.1" />
      <circle cx={cx} cy={cy} r={r * 0.8} fill="none" stroke={IVORY} strokeWidth={r * 0.26} strokeDasharray={`${r * 0.52} ${r * 0.52}`} opacity="0.9" />
      <circle cx={cx} cy={cy} r={r * 0.5} fill={fill} stroke={GOLD} strokeWidth="0.8" />
    </>
  );
}

/** An arrow pointing up (or down), its tip at (x, y). */
function Arrow({ x, y, down, fill, s = 1 }: { x: number; y: number; down?: boolean; fill: string; s?: number }) {
  return (
    <path
      d="M0 0l5.5 6.5h-3.3V13h-4.4V6.5h-3.3z"
      transform={`translate(${x} ${y}) scale(${s} ${down ? -s : s})`}
      fill={fill}
      stroke={INK}
      strokeWidth="0.5"
      strokeLinejoin="round"
    />
  );
}

/** A video poker machine's screen with one card showing; `children` is what makes each machine different. */
function Screen({ tint, children }: { tint: string; children: ReactNode }) {
  return (
    <>
      <rect x="5" y="7" width="38" height="30" rx="5" fill={tint} stroke={GOLD} strokeWidth="1.6" />
      <rect x="8.5" y="10.5" width="31" height="23" rx="2.5" fill={INK} opacity="0.55" />
      <path d="M17 41.5h14M24 37v4.5" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" />
      {children}
    </>
  );
}

const STAR = 'M0-5l1.5 3.1 3.4.5-2.5 2.4.6 3.4L0 2.8l-3 1.6.6-3.4-2.5-2.4 3.4-.5z';
const SPADE_BIG = 'M24 7c-6 7.500-13 11.300-13 18a6.600 6.600 0 0 0 11.400 4.500L20 39h8l-2.400-9.500A6.600 6.600 0 0 0 37 25c0-6.700-7-10.500-13-18z';

const ICONS: Record<string, ReactNode> = {
  // ------------------------------------------------------------------ table games
  blackjack: (
    <>
      <Card x={9} y={12} w={18} h={25} rot={-12} rank="K" suit="h" fill={IVORY} />
      <Card x={21} y={11} w={18} h={25} rot={10} rank="A" suit="s" />
    </>
  ),
  spanish_21: (
    <>
      <rect x="6" y="9" width="36" height="30" rx="5" fill={RUBY} stroke={GOLD} strokeWidth="1.5" />
      <rect x="6" y="18" width="36" height="12" fill="#f2c230" />
      <rect x="6" y="9" width="36" height="30" rx="5" fill="none" stroke={GOLD} strokeWidth="1.5" />
      <Label x={24} y={30.500} size={17} fill={INK}>
        21
      </Label>
    </>
  ),
  blackjack_switch: (
    <>
      <Card x={5} y={15} w={14} h={20} rank="A" suit="s" />
      <Card x={29} y={15} w={14} h={20} rank="J" suit="d" />
      <path d="M17 10c5-4 10-4 14 0" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <path d="M31.500 5.500v5h-5" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M31 40c-5 4-10 4-14 0" stroke={SKY} strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <path d="M16.500 44.500v-5h5" stroke={SKY} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  free_bet_blackjack: (
    <>
      <Card x={7} y={9} w={18} h={25} rot={-8} rank="A" suit="c" />
      <Chip cx={31} cy={30} r={11} fill={FELT} />
      <path d={STAR} transform="translate(31 30) scale(1.05)" fill={GOLD} />
    </>
  ),
  pontoon: (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <Card key={i} x={2.500 + i * 8.800} y={13 + Math.abs(i - 2) * 2.500} w={8} h={19} rot={(i - 2) * 7} rank={['2', '3', '4', '5', '6'][i]} fill={i % 2 ? IVORY : WHITE} ink={i % 2 ? RED : INK} />
      ))}
      <path d="M8 40c10 3.500 22 3.500 32 0" stroke={GOLD} strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),
  baccarat: (
    <>
      <path d="M24 6a18 18 0 0 0 0 36z" fill={BLUE} />
      <path d="M24 6a18 18 0 0 1 0 36z" fill={RUBY} />
      <circle cx="24" cy="24" r="18" fill="none" stroke={GOLD} strokeWidth="1.8" />
      <path d="M24 6v36" stroke={GOLD} strokeWidth="1.2" />
      <Label x={15} y={29} size={14} fill={WHITE}>
        P
      </Label>
      <Label x={33} y={29} size={14} fill={WHITE}>
        B
      </Label>
    </>
  ),
  dragon_tiger: (
    <>
      <Card x={5} y={11} w={17} h={26} back={RUBY} />
      <path d="M13.500 16c3 3.500 4.500 6 4.500 9a4.500 4.500 0 0 1-9 0c0-1.700.8-3 1.800-4 .2 1.600 1 2.400 1.900 2.600-.6-2.400-.2-4.900.8-7.600z" fill={GOLD} />
      <Card x={26} y={11} w={17} h={26} back={ORANGE} />
      <path d="M29 17l5 2.500M40 17l-5 2.500M29 23.500l5 2M40 23.500l-5 2M29 30l5 1.500M40 30l-5 1.500" stroke={INK} strokeWidth="2.200" strokeLinecap="round" />
    </>
  ),
  casino_war: (
    <>
      <path d="M10 8l22 24" stroke={IVORY} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M38 8L16 32" stroke={IVORY} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M10 8l22 24M38 8L16 32" stroke={GOLD_DARK} strokeWidth="0.8" strokeLinecap="round" />
      <path d="M27 36l9-8M21 36l-9-8" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M33.500 34l5 6M14.500 34l-5 6" stroke={RUBY} strokeWidth="4" strokeLinecap="round" />
      <circle cx="39.500" cy="41" r="2.200" fill={GOLD} />
      <circle cx="8.500" cy="41" r="2.200" fill={GOLD} />
    </>
  ),
  red_dog: (
    <>
      <ellipse cx="24" cy="31" rx="9.500" ry="8" fill={RED} stroke={GOLD} strokeWidth="1.2" />
      <ellipse cx="9.500" cy="22" rx="3.700" ry="5" fill={RED} stroke={GOLD} strokeWidth="1.2" transform="rotate(-22 9.500 22)" />
      <ellipse cx="18.500" cy="12.500" rx="3.900" ry="5.300" fill={RED} stroke={GOLD} strokeWidth="1.2" transform="rotate(-8 18.500 12.500)" />
      <ellipse cx="29.500" cy="12.500" rx="3.900" ry="5.300" fill={RED} stroke={GOLD} strokeWidth="1.2" transform="rotate(8 29.500 12.500)" />
      <ellipse cx="38.500" cy="22" rx="3.700" ry="5" fill={RED} stroke={GOLD} strokeWidth="1.2" transform="rotate(22 38.500 22)" />
    </>
  ),
  andar_bahar: (
    <>
      <Card x={17} y={4} w={14} h={19} rank="7" suit="h" />
      <Card x={5} y={27} w={13} h={17} back={FELT} />
      <Card x={30} y={27} w={13} h={17} back={BLUE} />
      <path d="M19 26l-3 3M29 26l3 3" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      <path d="M21 34h6" stroke={IVORY} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="1 2.500" />
    </>
  ),
  roulette: (
    <>
      <circle cx="24" cy="24" r="17" fill="#3d0910" stroke={GOLD} strokeWidth="2" />
      {Array.from({ length: 12 }).map((_, i) => (
        <path key={i} d="M24 24 L24 8.5 A15.5 15.5 0 0 1 31.75 10.58 Z" fill={i % 2 ? RUBY : INK} transform={`rotate(${i * 30} 24 24)`} />
      ))}
      <circle cx="24" cy="24" r="6" fill={GOLD} />
      <circle cx="24" cy="24" r="2.2" fill="#5f4812" />
      <circle cx="33" cy="13.500" r="2" fill={WHITE} />
    </>
  ),
  money_wheel: (
    <>
      <path d="M17 44h14l-3-9h-8z" fill={GOLD_DARK} stroke={GOLD} strokeWidth="1" strokeLinejoin="round" />
      <circle cx="24" cy="21" r="15.500" fill={INK} stroke={GOLD} strokeWidth="1.8" />
      {[GREEN, GOLD, SKY, RED, PURPLE, ORANGE].map((c, i) => (
        <path key={c} d="M24 21L24 7A14 14 0 0 1 36.120 14z" fill={c} transform={`rotate(${i * 60} 24 21)`} />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <circle key={i} cx="24" cy="7" r="1.300" fill={WHITE} transform={`rotate(${i * 60} 24 21)`} />
      ))}
      <circle cx="24" cy="21" r="3.200" fill={IVORY} stroke={GOLD} strokeWidth="1" />
      <path d="M24 9.500l-3-6.500h6z" fill={RUBY} stroke={GOLD} strokeWidth="0.9" strokeLinejoin="round" />
    </>
  ),
  craps: (
    <>
      <Die x={6} y={12} s={20} rot={-10} n={3} />
      <Die x={22} y={17} s={20} rot={12} n={4} fill={RUBY} pip={IVORY} />
    </>
  ),
  sic_bo: (
    <>
      <path d="M6 38a18 18 0 0 1 36 0z" fill={SKY} opacity="0.22" stroke={SKY} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4 39h40" stroke={GOLD} strokeWidth="2.400" strokeLinecap="round" />
      <circle cx="24" cy="18.500" r="2" fill={GOLD} />
      <Die x={17.500} y={21} s={10.500} n={6} />
      <Die x={11} y={28} s={10.500} n={1} fill={RUBY} pip={IVORY} />
      <Die x={26.500} y={28} s={10.500} n={5} />
    </>
  ),
  chuck_a_luck: (
    <>
      <path d="M11 6h26L28.500 24 37 42H11l8.500-18z" fill={INK} stroke={GOLD} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16.500 6l5.500 18-5.500 18M31.500 6L26 24l5.500 18M24 6v36" stroke={GOLD} strokeWidth="0.8" opacity="0.75" />
      <path d="M9 6h30M9 42h30" stroke={GOLD} strokeWidth="2.600" strokeLinecap="round" />
      <Die x={19} y={30} s={10} rot={-8} n={2} />
      <Die x={20.500} y={9} s={7} rot={14} n={5} fill={RUBY} pip={IVORY} />
    </>
  ),

  // ------------------------------------------------------------------ poker
  poker_holdem: (
    <>
      <Card x={8} y={15} w={17} h={24} rot={-10} rank="A" suit="s" />
      <Card x={22} y={15} w={17} h={24} rot={10} rank="A" suit="h" fill={IVORY} />
      <path d={STAR} transform="translate(24 9) scale(1.25)" fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.4" />
    </>
  ),
  poker_omaha: (
    <>
      {([-27, -9, 9, 27] as const).map((rot, i) => (
        <g key={rot} transform={`rotate(${rot} 24 46)`}>
          <Card x={17} y={9} w={14} h={21} suit={(['s', 'h', 'c', 'd'] as const)[i]} rank={['A', 'K', 'Q', 'J'][i]} />
        </g>
      ))}
    </>
  ),
  poker_omaha_hilo: (
    <>
      <Card x={4} y={6} w={11} h={15} rank="A" ink={INK} />
      <Card x={13} y={6} w={11} h={15} rank="K" ink={RED} />
      <Card x={4} y={27} w={11} h={15} rank="2" ink={RED} />
      <Card x={13} y={27} w={11} h={15} rank="3" ink={INK} />
      <Arrow x={35} y={5} fill={GREEN} s={1.150} />
      <Arrow x={35} y={43} down fill={SKY} s={1.150} />
    </>
  ),
  poker_stud: (
    <>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const down = i < 2 || i === 6;
        return <Card key={i} x={3.500 + i * 5} y={down ? 17 : 11} w={11} h={17} back={down ? RUBY : undefined} rank={down ? undefined : ['9', 'J', 'J', 'A'][i - 2]} ink={i % 2 ? RED : INK} />;
      })}
      <path d="M6 38h36" stroke={GOLD} strokeWidth="1.600" strokeLinecap="round" strokeDasharray="0.100 5.900" />
    </>
  ),
  poker_draw: (
    <>
      {[-24, -12, 0, 12].map((rot, i) => (
        <g key={rot} transform={`rotate(${rot} 20 48)`}>
          <Card x={14} y={14} w={12} h={18} rank={['T', 'J', 'Q', 'K'][i]} ink={INK} />
        </g>
      ))}
      <Card x={31} y={5} w={12} h={18} rot={14} back={BLUE} />
      <path d="M41 28a8 8 0 0 1-8 9" stroke={GREEN} strokeWidth="2.200" strokeLinecap="round" fill="none" />
      <path d="M36.500 33.500L32.500 37l4.500 3" stroke={GREEN} strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  poker_shortdeck: (
    <>
      <rect x="11" y="33" width="26" height="4" rx="1.500" fill={RUBY} stroke={GOLD} strokeWidth="0.9" />
      <rect x="11" y="29.500" width="26" height="4" rx="1.500" fill={RUBY} stroke={GOLD} strokeWidth="0.9" />
      <rect x="11" y="26" width="26" height="4" rx="1.500" fill={RUBY} stroke={GOLD} strokeWidth="0.9" />
      <rect x="11" y="8" width="26" height="19" rx="3" fill={WHITE} stroke={GOLD} strokeWidth="1.2" />
      <Label x={24} y={23} size={15} fill={INK}>
        6+
      </Label>
    </>
  ),
  poker_razz: (
    <>
      <Card x={6} y={8} w={22} h={31} rank="A" suit="d" />
      <Arrow x={37} y={41} down fill={SKY} s={1.500} />
    </>
  ),
  poker_27: (
    <>
      <Card x={6} y={8} w={18} h={26} rot={-8} rank="2" ink={INK} />
      <Card x={24} y={14} w={18} h={26} rot={8} rank="7" ink={RED} fill={IVORY} />
    </>
  ),
  poker_badugi: (
    <>
      <Card x={6} y={5} w={16} h={18} suit="s" />
      <Card x={26} y={5} w={16} h={18} suit="h" />
      <Card x={6} y={25} w={16} h={18} suit="d" />
      <Card x={26} y={25} w={16} h={18} suit="c" />
    </>
  ),
  sng_poker: (
    <>
      <path d="M14 8h20v9a10 10 0 0 1-20 0z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="1" strokeLinejoin="round" />
      <path d="M14 10H8c0 6 2.500 9.500 7 10M34 10h6c0 6-2.500 9.500-7 10" stroke={GOLD} strokeWidth="2.200" fill="none" strokeLinecap="round" />
      <path d="M21 27h6v6h-6z" fill={GOLD_DARK} />
      <rect x="14" y="33" width="20" height="7" rx="2" fill={RUBY} stroke={GOLD} strokeWidth="1.1" />
      <Suit s="s" x={19.500} y={10.500} size={9} fill={INK} />
    </>
  ),
  three_card_poker: (
    <>
      {([-20, 0, 20] as const).map((rot, i) => (
        <g key={rot} transform={`rotate(${rot} 24 46)`}>
          <Card x={16} y={9} w={16} h={23} suit={(['c', 'd', 's'] as const)[i]} rank={['Q', 'K', 'A'][i]} />
        </g>
      ))}
    </>
  ),
  four_card_poker: (
    <>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} x={3.500 + i * 9.500} y={10 + (i % 2) * 4} w={12.500} h={20} rank="4" suit={(['s', 'h', 'c', 'd'] as const)[i]} />
      ))}
      <path d="M8 40h32" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  pai_gow_poker: (
    <>
      <Card x={13} y={5} w={10} h={15} rank="A" ink={RED} />
      <Card x={25} y={5} w={10} h={15} rank="A" ink={INK} />
      <path d="M7 23.500h34" stroke={GOLD} strokeWidth="1.400" strokeLinecap="round" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Card key={i} x={3 + i * 8.500} y={27} w={8} h={15} fill={i % 2 ? IVORY : WHITE} suit={(['s', 'h', 'c', 'd', 's'] as const)[i]} />
      ))}
    </>
  ),
  ultimate_holdem: (
    <>
      <path d={SPADE_BIG} transform="translate(0 5) scale(1 0.92)" fill={IVORY} stroke={GOLD} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M15 12l2.500-8 3.500 4.500 3-6 3 6L30.500 4l2.500 8z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.8" strokeLinejoin="round" />
    </>
  ),
  caribbean_stud: (
    <>
      <circle cx="35" cy="12" r="5.500" fill="#f2c230" />
      <path d="M22 40c1-9 2.500-16 5-22" stroke={GOLD_DARK} strokeWidth="3.400" strokeLinecap="round" fill="none" />
      <path d="M27 18c-5-4.500-11-4.500-15 0 5-1 9 0 12 2M27 18c-1-6-6-9.500-11.500-9 4 1.500 6.500 4.500 8 8M27 18c3-5.500 9-6.500 13-3-4.500-.5-8 .5-10 3.500M27 18c5-1.500 10 1 11.500 6-3-3-6.500-4-10-3.500" fill={GREEN} stroke={FELT} strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M6 41c5-3.500 9-3.500 12 0s7 3.500 12 0 8-3.500 12 0" stroke={SKY} strokeWidth="2.400" strokeLinecap="round" fill="none" />
    </>
  ),
  casino_holdem: (
    <>
      <circle cx="24" cy="24" r="18" fill={FELT} stroke={GOLD} strokeWidth="1.6" />
      <circle cx="24" cy="24" r="14.800" fill="none" stroke={IVORY} strokeWidth="4" strokeDasharray="5.800 5.830" />
      <circle cx="24" cy="24" r="11" fill={IVORY} stroke={GOLD} strokeWidth="1" />
      <Suit s="s" x={17} y={17} size={14} />
    </>
  ),
  let_it_ride: (
    <>
      <path d="M4 34c5-9 11-13 18-13 7 0 9 5 6 8-2 2-6 1-6-2" fill="none" stroke={SKY} strokeWidth="3" strokeLinecap="round" />
      <path d="M4 34c8 4 30 4 40-1-3 6-9 9-20 9S8 39 4 34z" fill={BLUE} stroke={SKY} strokeWidth="1.2" strokeLinejoin="round" />
      <Card x={27} y={5} w={13} h={18} rot={18} rank="A" suit="h" />
    </>
  ),
  mississippi_stud: (
    <>
      <circle cx="24" cy="24" r="12" fill="none" stroke={GOLD_DARK} strokeWidth="3.600" />
      <circle cx="24" cy="24" r="12" fill="none" stroke={GOLD} strokeWidth="1.200" />
      {Array.from({ length: 8 }).map((_, i) => (
        <g key={i} transform={`rotate(${i * 45} 24 24)`}>
          <path d="M24 24V5" stroke={GOLD} strokeWidth="2.200" strokeLinecap="round" />
          <circle cx="24" cy="4.500" r="2.200" fill={GOLD_DARK} stroke={GOLD} strokeWidth="0.8" />
        </g>
      ))}
      <circle cx="24" cy="24" r="4.500" fill={RUBY} stroke={GOLD} strokeWidth="1.200" />
    </>
  ),
  teen_patti: (
    <>
      <Card x={6} y={7} w={17} h={24} rank="A" suit="s" fill={IVORY} />
      <Card x={15.500} y={12} w={17} h={24} rank="A" suit="h" />
      <Card x={25} y={17} w={17} h={24} rank="A" suit="d" fill={IVORY} />
    </>
  ),
  teen_patti_live: (
    <>
      <path d="M8 13c9-9 23-9 32 0-9 9-23 9-32 0z" fill={IVORY} stroke={GOLD} strokeWidth="1.300" strokeLinejoin="round" />
      <circle cx="24" cy="13" r="4.600" fill={FELT} />
      <circle cx="24" cy="13" r="2" fill={INK} />
      <Card x={5} y={24} w={11.500} h={17} back={RUBY} />
      <Card x={18.250} y={24} w={11.500} h={17} back={RUBY} />
      <Card x={31.500} y={24} w={11.500} h={17} back={RUBY} />
    </>
  ),

  // ------------------------------------------------------------------ slots
  slots_classic: (
    <>
      <rect x="6" y="8" width="36" height="32" rx="6" fill={INK} stroke={GOLD} strokeWidth="1.6" />
      <path d="M15 16h18l-9 17" stroke={RED} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  slots_paylines: (
    <>
      <circle cx="34" cy="13" r="6" fill="#f7e8bd" />
      <path d="M22 9l18 31H4z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="1" strokeLinejoin="round" />
      <path d="M22 9l18 31H22z" fill={GOLD_DARK} />
      <path d="M13.500 24h17M9 32h26" stroke="#5f4812" strokeWidth="1.1" />
      <path d="M19 40v-6a3 3 0 0 1 6 0v6z" fill={INK} />
    </>
  ),
  slots_cascade: (
    <>
      <path d="M8 13l4-5h8l4 5-8 12z" fill={BLUE} stroke={SKY} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 13h16M12 8l4 5 4-5" stroke={SKY} strokeWidth="0.9" fill="none" />
      <path d="M27 20l3-4h7l3 4-6.500 10z" fill={RUBY} stroke="#f08b95" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M27 20h13" stroke="#f08b95" strokeWidth="0.9" />
      <path d="M13 34l3-3.500h6l3 3.500-6 9z" fill="#2fb36f" stroke="#9be3bd" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M13 34h12" stroke="#9be3bd" strokeWidth="0.9" />
      <path d="M33 6v5M38 34v6M7 29v5" stroke={IVORY} strokeWidth="1.400" strokeLinecap="round" opacity="0.6" />
    </>
  ),
  slots_ways: (
    <>
      <circle cx="36" cy="12" r="6" fill={ORANGE} />
      <path d="M21 42V12a4 4 0 0 1 8 0v30z" fill="#2fb36f" stroke={FELT} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M21 30h-5a4 4 0 0 1-4-4v-6a2.500 2.500 0 0 1 5 0v5h4zM29 34h5a4 4 0 0 0 4-4v-5a2.500 2.500 0 0 0-5 0v4h-4z" fill="#2fb36f" stroke={FELT} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M25 14v26" stroke={FELT} strokeWidth="1" strokeDasharray="1.500 3" />
      <path d="M5 42h38" stroke={GOLD} strokeWidth="2.200" strokeLinecap="round" />
    </>
  ),
  slots_holdwin: (
    <>
      <path d="M40 22a16 16 0 1 1-15-14c-6 2-8 8-4 12 3.500 3.500 9 2 9-2.500" fill="none" stroke={RED} strokeWidth="3.600" strokeLinecap="round" />
      <path d="M25 8l5-4-1 6z" fill={RED} />
      <circle cx="24" cy="26" r="9" fill="#ece6da" stroke={GOLD} strokeWidth="1.400" />
      <circle cx="21" cy="23" r="3" fill={WHITE} />
    </>
  ),
  slots_progressive: (
    <>
      <path d="M7 34l-2-20 9.500 8L24 8l9.500 14 9.500-8-2 20z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="1.200" strokeLinejoin="round" />
      <rect x="7" y="34" width="34" height="6" rx="2" fill={GOLD_DARK} stroke={GOLD} strokeWidth="1" />
      <circle cx="24" cy="26" r="3.400" fill={RUBY} stroke={IVORY} strokeWidth="0.800" />
      <circle cx="13.500" cy="28" r="2.200" fill={BLUE} />
      <circle cx="34.500" cy="28" r="2.200" fill={BLUE} />
      <circle cx="5" cy="13" r="2.200" fill={GOLD} />
      <circle cx="24" cy="7" r="2.200" fill={GOLD} />
      <circle cx="43" cy="13" r="2.200" fill={GOLD} />
    </>
  ),
  slots_haunted: (
    <>
      <path d="M10 41V22a14 14 0 0 1 28 0v19l-4.7-4-4.6 4-4.7-4-4.7 4-4.6-4z" fill={IVORY} stroke={PURPLE} strokeWidth="1.5" strokeLinejoin="round" />
      <ellipse cx="19" cy="22" rx="2.6" ry="3.6" fill={INK} />
      <ellipse cx="29" cy="22" rx="2.6" ry="3.6" fill={INK} />
      <ellipse cx="24" cy="30" rx="2.4" ry="3" fill={INK} />
    </>
  ),
  slot_showdown: (
    <>
      <rect x="6" y="10" width="30" height="30" rx="5" fill={RUBY} stroke={GOLD} strokeWidth="1.500" />
      <rect x="9.500" y="16" width="23" height="12" rx="2" fill={INK} stroke={GOLD} strokeWidth="0.900" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={11.300 + i * 7} y="17.800" width="5.400" height="8.400" rx="1" fill={IVORY} />
      ))}
      <path d="M12.500 20.500h3l-1.700 4M19.500 20.500h3l-1.700 4M26.500 20.500h3l-1.700 4" stroke={RED} strokeWidth="1.200" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="13" y="32" width="16" height="3.500" rx="1.500" fill={GOLD} />
      <path d="M36 28h4V14" stroke={GOLD} strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="40" cy="11.500" r="3.400" fill={RED} stroke={GOLD} strokeWidth="0.900" />
    </>
  ),

  // ------------------------------------------------------------------ specialty
  video_poker_jacks: (
    <Screen tint={FELT}>
      <Card x={17} y={12.500} w={14} h={19} rank="J" suit="s" />
    </Screen>
  ),
  video_poker_deuces: (
    <Screen tint="#5b2a86">
      <Card x={12} y={12.500} w={14} h={19} rank="2" suit="h" />
      <path d={STAR} transform="translate(33.500 17) scale(0.9)" fill={GOLD} />
      <path d={STAR} transform="translate(32 28) scale(0.55)" fill={IVORY} />
    </Screen>
  ),
  video_poker_bonus: (
    <Screen tint={RUBY}>
      <Card x={11} y={12.500} w={14} h={19} rank="A" suit="c" />
      <path d="M33.500 16.500v11M28 22h11" stroke={GOLD} strokeWidth="3.200" strokeLinecap="round" />
    </Screen>
  ),
  video_poker_double: (
    <Screen tint={BLUE}>
      <Card x={10.500} y={13.500} w={12} h={17} rank="A" ink={INK} />
      <Card x={17} y={12.500} w={12} h={17} rank="A" ink={RED} fill={IVORY} />
      <Label x={35} y={26} size={10} fill={GOLD}>
        ×2
      </Label>
    </Screen>
  ),
  video_poker_joker: (
    <Screen tint="#1d2247">
      <path d="M13 28c0-7 3-12 6-13 1 3 3 5 5 5s4-2 5-5c3 1 6 6 6 13z" fill={RUBY} stroke={GOLD} strokeWidth="0.900" strokeLinejoin="round" />
      <path d="M24 20v8" stroke={GOLD} strokeWidth="0.900" />
      <path d="M13 28h22v3.500H13z" fill={GOLD} />
      <circle cx="19" cy="14" r="2" fill={GOLD} />
      <circle cx="29" cy="14" r="2" fill={GOLD} />
      <circle cx="12.500" cy="27" r="1.800" fill={GOLD} />
      <circle cx="35.500" cy="27" r="1.800" fill={GOLD} />
    </Screen>
  ),
  keno: (
    <>
      {Array.from({ length: 16 }).map((_, i) => (
        <circle key={i} cx={12 + (i % 4) * 8} cy={12 + Math.floor(i / 4) * 8} r="3.2" fill={[1, 6, 11, 13].includes(i) ? GOLD : '#262c29'} stroke="#5b645f" strokeWidth="0.6" />
      ))}
    </>
  ),
  bingo: (
    <>
      <rect x="6" y="6" width="28" height="36" rx="3.500" fill={WHITE} stroke={GOLD} strokeWidth="1.400" />
      <rect x="6" y="6" width="28" height="8" rx="3.500" fill={RUBY} />
      {Array.from({ length: 9 }).map((_, i) => (
        <rect key={i} x={9.500 + (i % 3) * 7.500} y={17 + Math.floor(i / 3) * 7.500} width="6" height="6" rx="1.200" fill={[0, 4, 8].includes(i) ? RED : '#d9cfb6'} />
      ))}
      <circle cx="36" cy="33" r="8.500" fill={BLUE} stroke={GOLD} strokeWidth="1.300" />
      <circle cx="36" cy="33" r="5" fill={WHITE} />
      <Label x={36} y={36.200} size={8.500} fill={INK}>
        B
      </Label>
    </>
  ),
  power_draw: (
    <>
      <circle cx="13" cy="15" r="8" fill={WHITE} stroke={GOLD} strokeWidth="1.200" />
      <circle cx="31" cy="12" r="7" fill={WHITE} stroke={GOLD} strokeWidth="1.200" />
      <circle cx="14" cy="34" r="7" fill={WHITE} stroke={GOLD} strokeWidth="1.200" />
      <Label x={13} y={18.800} size={10} fill={INK}>
        7
      </Label>
      <Label x={31} y={15.400} size={9} fill={INK}>
        3
      </Label>
      <Label x={14} y={37.400} size={9} fill={INK}>
        9
      </Label>
      <circle cx="32" cy="32" r="11" fill={RED} stroke={GOLD} strokeWidth="1.500" />
      <path d="M34 23.500l-7.500 10h5l-2 7.500 8-10.500h-5z" fill="#ffe066" stroke={INK} strokeWidth="0.500" strokeLinejoin="round" />
    </>
  ),
  crash: (
    <>
      <rect x="6" y="8" width="36" height="32" rx="6" fill={INK} stroke={GOLD} strokeWidth="1.6" />
      <path d="M11 34c8-1 14-5 19-13l5-8" stroke={GREEN} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M30 13h6v6" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  plinko: (
    <>
      {[0, 1, 2, 3].flatMap((r) =>
        Array.from({ length: r + 2 }).map((_, i) => <circle key={`${r}-${i}`} cx={24 - r * 4 + i * 8 - 4} cy={12 + r * 8} r="2.2" fill={IVORY} />),
      )}
      <circle cx="24" cy="6" r="3.4" fill={GOLD} />
      <path d="M6 43h7M16 43h7M26 43h7M36 43h6" stroke={GREEN} strokeWidth="2.400" strokeLinecap="round" />
    </>
  ),
  mines: (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <path key={i} d="M24 26V9.500" stroke="#5b645f" strokeWidth="3.400" strokeLinecap="round" transform={`rotate(${i * 45} 24 26)`} />
      ))}
      <circle cx="24" cy="26" r="11.500" fill="#262c29" stroke="#5b645f" strokeWidth="1.400" />
      <circle cx="20" cy="22" r="3" fill={IVORY} opacity="0.55" />
      <circle cx="24" cy="26" r="3.200" fill={RED} />
      <path d={STAR} transform="translate(39 9) scale(0.95)" fill={GOLD} />
    </>
  ),
  scratch_cards: (
    <>
      <rect x="5" y="11" width="32" height="24" rx="4" fill={FELT} stroke={GOLD} strokeWidth="1.500" />
      <rect x="9" y="16" width="24" height="14" rx="2" fill="#9aa39e" />
      <path d="M10 28l8-11 3 7 5-6 6 9" fill="none" stroke={WHITE} strokeWidth="4.500" strokeLinecap="round" strokeLinejoin="round" />
      <path d={STAR} transform="translate(21 23) scale(0.75)" fill={GOLD} />
      <circle cx="36" cy="33" r="8" fill={GOLD} stroke={GOLD_DARK} strokeWidth="1.300" />
      <circle cx="36" cy="33" r="5" fill="none" stroke={GOLD_DARK} strokeWidth="1" />
    </>
  ),
  hi_lo: (
    <>
      <Card x={6} y={9} w={21} h={30} rank="8" suit="c" />
      <Arrow x={37} y={6} fill={GREEN} s={1.300} />
      <Arrow x={37} y={42} down fill={RED} s={1.300} />
    </>
  ),
  horse_racing: (
    <>
      {/* A horse's head in profile, facing left, on a plinth like a trophy. */}
      <path d="M17 37c0-6 4-8 5-12l-6 5c-3 1.5-6-.5-5-4l9-13 1-7 5 4c7 3 9.5 13 8 27z" fill={IVORY} stroke={GOLD} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M26 10c4 3 5.5 9 5 16" stroke="#ad872b" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <circle cx="20.5" cy="17" r="1.5" fill={INK} />
      <rect x="12" y="37" width="24" height="4.5" rx="1.5" fill={RUBY} stroke={GOLD} strokeWidth="1.2" />
    </>
  ),
};

/** The games that have an icon of their own (the tests check the catalogue against this). */
export const GAME_ICON_KEYS = Object.keys(ICONS);

export function GameIcon({ gameKey, className }: { gameKey: string; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('h-10 w-10', className)} aria-hidden="true" fill="none">
      {ICONS[gameKey] ?? <Chip cx={24} cy={24} r={17} />}
    </svg>
  );
}
