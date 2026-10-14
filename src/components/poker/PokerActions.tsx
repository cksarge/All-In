import { useEffect, useState } from 'react';
import { hotkeysOn, useHotkeyDocs } from '@/lib/hotkeys';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { formatChips } from '@/lib/format';
import { cardName } from '@/lib/cards';
import { potFractionTo, type PkAction, type PkConfig, type PkHand, type PkOptions } from '@/lib/poker';

/** Fold / check / call / bet-raise controls for your turn. */
export function BettingControls({
  hand,
  options,
  config,
  busy,
  onAct,
  compact,
}: {
  hand: PkHand;
  options: PkOptions;
  config: PkConfig;
  busy: string | null;
  onAct: (a: PkAction, amount?: number) => void;
  /** Phones: the sizing controls only open after tapping Raise, so the bar stays small. */
  compact?: boolean;
}) {
  const [amount, setAmount] = useState(options.min_to);
  const [open, setOpen] = useState(false);
  const turnKey = `${hand.id}-${hand.street}-${hand.current_bet}-${options.min_to}`;
  useEffect(() => {
    setAmount(options.min_to);
    setOpen(false);
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fixed = config.limit === 'fl' || options.min_to === options.max_to;
  const clamped = Math.max(options.min_to, Math.min(options.max_to, Number.isFinite(amount) ? amount : options.min_to));
  const allIn = clamped >= options.all_in_to;
  const raiseVerb = options.is_bet ? (hand.current_bet > 0 && config.family === 'stud' ? 'Complete to' : 'Bet') : 'Raise to';

  const presets: [string, number][] = [];
  if (!fixed && options.can_raise) {
    const seen = new Set<number>();
    const add = (label: string, v: number) => {
      if (!seen.has(v)) {
        seen.add(v);
        presets.push([label, v]);
      }
    };
    add('Min', options.min_to);
    add('½ pot', potFractionTo(hand, options, 0.5));
    add('¾ pot', potFractionTo(hand, options, 0.75));
    add('Pot', potFractionTo(hand, options, 1));
    if (config.limit === 'nl') add('All in', options.max_to);
  }

  // Keyboard: F fold, C check/call, R bet/raise, A all in (no limit). Listed under "?" too.
  useHotkeyDocs([
    ['f', 'Fold'],
    ['c', options.can_check ? 'Check' : 'Call'],
    ...(options.can_raise ? ([['r', 'Bet or raise the amount shown']] as [string, string][]) : []),
    ...(options.can_raise && config.limit === 'nl' ? ([['a', 'All in']] as [string, string][]) : []),
  ]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (!hotkeysOn() || el.closest('input, textarea, select, [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') onAct('fold');
      else if (k === 'c') onAct(options.can_check ? 'check' : 'call');
      else if (k === 'r' && options.can_raise) onAct('raise', clamped);
      else if (k === 'a' && options.can_raise && config.limit === 'nl') onAct('allin');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const showSizing = options.can_raise && !fixed && (!compact || open);
  return (
    <div className="flex basis-full flex-col gap-2 sm:basis-auto sm:flex-1" role="group" aria-label="Your move">
      {showSizing && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {presets.map(([label, v]) => (
              <button
                key={label}
                type="button"
                onClick={() => setAmount(v)}
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs font-semibold transition',
                  clamped === v ? 'border-gold-400 bg-gold-500/20 text-gold-200' : 'border-white/15 text-cream/85 hover:border-white/30',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={options.min_to}
            max={options.max_to}
            step={1}
            value={clamped}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="h-2 min-w-[8rem] flex-1 cursor-pointer accent-gold-400"
            aria-label={`${raiseVerb} amount`}
          />
          <input
            type="number"
            inputMode="numeric"
            min={options.min_to}
            max={options.max_to}
            value={Number.isFinite(amount) ? amount : ''}
            onChange={(e) => setAmount(Math.floor(Number(e.target.value)))}
            onBlur={() => setAmount(clamped)}
            className="h-9 w-28 rounded-lg border border-white/10 bg-ink-950/60 px-2 text-right text-sm tabular-nums text-ivory focus:border-gold-500/70 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
            aria-label="Exact amount"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ruby" onClick={() => onAct('fold')} loading={busy === 'fold'} aria-keyshortcuts="F">
          Fold <Kbd>F</Kbd>
        </Button>
        {options.can_check ? (
          <Button size="sm" variant="felt" onClick={() => onAct('check')} loading={busy === 'check'} aria-keyshortcuts="C">
            Check <Kbd>C</Kbd>
          </Button>
        ) : (
          <Button size="sm" variant="felt" onClick={() => onAct('call')} loading={busy === 'call'} aria-keyshortcuts="C">
            {options.call_is_all_in ? 'All in' : 'Call'} <ChipAmount value={options.to_call} iconClassName="h-3.5 w-3.5" /> <Kbd>C</Kbd>
          </Button>
        )}
        {options.can_raise && !fixed && compact && !open ? (
          <Button size="sm" variant="gold" onClick={() => setOpen(true)} aria-expanded={false}>
            {options.is_bet ? 'Bet…' : 'Raise…'}
          </Button>
        ) : options.can_raise && (
          <Button
            size="sm"
            variant="gold"
            onClick={() => (allIn && config.limit === 'nl' ? onAct('allin') : onAct(options.is_bet ? 'bet' : 'raise', clamped))}
            loading={busy === 'raise' || busy === 'bet' || busy === 'allin'}
            aria-keyshortcuts="R"
          >
            {allIn ? 'All in' : raiseVerb} <ChipAmount value={clamped} iconClassName="h-3.5 w-3.5" /> <Kbd>R</Kbd>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Five-Card Draw: pick the cards to swap. */
export function DrawControls({
  hole,
  maxDraw,
  busy,
  onDraw,
}: {
  hole: number[];
  maxDraw: number;
  busy: boolean;
  onDraw: (cards: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (c: number) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length >= maxDraw ? p : [...p, c]));
  return (
    <div className="flex basis-full flex-wrap items-center gap-3 sm:basis-auto sm:flex-1" role="group" aria-label="Choose cards to swap">
      <div className="flex gap-1.5">
        {hole.map((c) => {
          const on = picked.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              aria-pressed={on}
              aria-label={`${on ? 'Keep' : 'Swap'} ${cardName(c)}`}
              className={cn('relative rounded-md transition', on ? '-translate-y-2 opacity-60' : 'hover:-translate-y-1')}
            >
              <PlayingCard card={c} size="sm" />
              {on && (
                <span className="absolute inset-x-0 bottom-1 mx-auto w-fit rounded bg-ruby-600 px-1 text-[0.55rem] font-bold uppercase text-ivory">
                  Swap
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onDraw(picked)} loading={busy} disabled={picked.length === 0}>
          Draw {picked.length || ''}
        </Button>
        <Button size="sm" variant="felt" onClick={() => onDraw([])} disabled={busy}>
          Stand pat
        </Button>
      </div>
      <p className="w-full text-xs text-cream/65">Tap the cards you want to swap (up to {formatChips(maxDraw)}).</p>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="ml-0.5 hidden rounded border border-current/30 px-1 text-[0.6rem] opacity-70 sm:inline">{children}</kbd>;
}
