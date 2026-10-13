import { memo } from 'react';
import { formatChipsCompact } from '@/lib/format';
import { symbolArt } from '@/lib/slots';

function Bars({ n }: { n: number }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-[5cqmin]">
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="rounded-[4cqmin] border border-gold-300/70 bg-ink-950 px-[9cqmin] font-display font-black leading-none tracking-wider text-gold-300"
          style={{ fontSize: n === 1 ? '30cqmin' : n === 2 ? '24cqmin' : '19cqmin', paddingBlock: '3cqmin' }}
        >
          BAR
        </span>
      ))}
    </div>
  );
}

function Gem({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 40 40" className="h-[78%] w-[78%] drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
      <path d="M12 5h16l8 10-16 21L4 15z" fill={color} />
      <path d="M12 5h16l-3 10H15z" fill="#fff" opacity="0.38" />
      <path d="M4 15h11l5 21zM36 15H25l-5 21z" fill="#000" opacity="0.2" />
      <path d="M12 5l3 10H4zM28 5l-3 10h11z" fill="#fff" opacity="0.16" />
      <path d="M12 5h16l8 10-16 21L4 15z" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="0.8" strokeLinejoin="round" />
    </svg>
  );
}

function Pyramid() {
  return (
    <svg viewBox="0 0 40 40" className="h-[82%] w-[82%]">
      <circle cx="29" cy="11" r="5" fill="#f7e8bd" />
      <path d="M20 8l15 25H5z" fill="#d4af37" />
      <path d="M20 8l15 25H20z" fill="#86661c" />
      <path d="M11.5 22h17M8.3 27.5h23.4" stroke="#5f4812" strokeWidth="0.9" />
    </svg>
  );
}

/** Haunted Manor's wild: a ghost carrying the word. */
function Ghost() {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <span className="haunt-bob leading-none drop-shadow-[0_0_6px_rgba(190,160,255,0.9)]" style={{ fontSize: '56cqmin' }}>
        👻
      </span>
      <span
        className="absolute bottom-[6%] rounded-[4cqmin] bg-[#b78cff] px-[6cqmin] font-display font-black leading-none text-ink-950"
        style={{ fontSize: '17cqmin', paddingBlock: '2.5cqmin', letterSpacing: '0.06em' }}
      >
        WILD
      </span>
    </div>
  );
}

/** Haunted Manor's scatter: a jack-o'-lantern lit from inside. */
function Pumpkin() {
  return (
    <span className="haunt-flicker leading-none" style={{ fontSize: '62cqmin', filter: 'drop-shadow(0 0 5cqmin rgba(255,150,40,0.85))' }}>
      🎃
    </span>
  );
}

function Pearl({ chips, big }: { chips: number | null; big: boolean }) {
  return (
    <div
      className="flex h-[86%] w-[86%] items-center justify-center rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
      style={{
        background: big
          ? 'radial-gradient(circle at 32% 28%, #fff8dc, #f0d688 45%, #ad872b 100%)'
          : 'radial-gradient(circle at 32% 28%, #ffffff, #e8e2d6 45%, #9d978a 100%)',
      }}
    >
      {chips !== null && (
        <span className="font-bold tabular-nums leading-none text-ink-950" style={{ fontSize: chips >= 100000 ? '21cqmin' : '26cqmin' }}>
          {formatChipsCompact(chips)}
        </span>
      )}
    </div>
  );
}

/**
 * One symbol tile. Sizes itself from its cell (container query units), so the same
 * component works for square cells and for the stretched reels of Wild Frontier.
 */
export const SlotSymbol = memo(function SlotSymbol({
  game,
  sym,
  pearlChips = null,
  bigPearl = false,
}: {
  game: string;
  sym: string;
  /** Dragon Pearls: the prize on this pearl, in chips at the current bet. */
  pearlChips?: number | null;
  bigPearl?: boolean;
}) {
  const art = symbolArt(game, sym);
  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden rounded-[14%] border border-white/[0.07]"
      style={{ background: art.bg, containerType: 'size' }}
      aria-hidden="true"
    >
      {art.art === 'bar1' && <Bars n={1} />}
      {art.art === 'bar2' && <Bars n={2} />}
      {art.art === 'bar3' && <Bars n={3} />}
      {art.art === 'gem' && <Gem color={art.fg ?? '#fff'} />}
      {art.art === 'pyramid' && <Pyramid />}
      {art.art === 'ghost' && <Ghost />}
      {art.art === 'pumpkin' && <Pumpkin />}
      {art.art === 'pearl' && <Pearl chips={pearlChips} big={bigPearl} />}
      {art.art === 'blank' && <span className="h-[3cqmin] w-[34%] rounded-full bg-white/10" />}
      {art.glyph && (
        <span className="leading-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]" style={{ fontSize: '58cqmin' }}>
          {art.glyph}
        </span>
      )}
      {art.text && (
        <span
          className="font-display font-black leading-none"
          style={{
            color: art.fg,
            fontSize: art.text.length > 2 ? '27cqmin' : art.text === '7' ? '82cqmin' : '64cqmin',
            letterSpacing: art.text.length > 2 ? '0.04em' : undefined,
            textShadow: art.text === '7' ? '0 0 2px #f0d688, 0 2px 0 #5e0e18' : undefined,
          }}
        >
          {art.text}
        </span>
      )}
    </div>
  );
});
