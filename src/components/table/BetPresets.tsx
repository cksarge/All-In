import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { recall, remember } from '@/hooks/useRemembered';
import { useHotkeys } from '@/lib/hotkeys';

/** One saved layout of bets, as the menu shows it. */
export interface PresetSlot {
  /** e.g. "350 on 3 spots" */
  summary: string;
}

/**
 * "Presets": up to three favourite layouts of bets per game, kept on this device. The menu saves
 * the bets on the table into a slot, puts a slot's bets back on the table, or empties a slot.
 * Shift + 1, 2 and 3 play the slots from the keyboard.
 */
export function BetPresets({
  slots,
  canSave,
  disabled,
  onSave,
  onLoad,
  onClear,
}: {
  slots: (PresetSlot | null)[];
  /** There are bets on the table to save. */
  canSave: boolean;
  /** Bets cannot be changed right now. */
  disabled?: boolean;
  onSave: (i: number) => void;
  onLoad: (i: number) => void;
  onClear: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  useHotkeys(
    slots.map((slot, i) => ({
      key: `shift+${i + 1}`,
      label: () => (slot ? `Preset ${i + 1}: ${slot.summary}` : ''),
      run: () => onLoad(i),
      enabled: () => Boolean(slot) && !disabled,
    })),
  );
  const saved = slots.filter(Boolean).length;
  return (
    <div ref={box} className="relative">
      <Button size="sm" variant="ghost" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        Presets{saved > 0 ? ` (${saved})` : ''}
      </Button>
      {/* On phones the controls bar is pinned to the bottom of the screen: the menu opens as a sheet across it. */}
      {open && (
        <div
          role="group"
          aria-label="Bet presets"
          className="z-30 rounded-xl border border-white/15 bg-ink-900 p-3 shadow-card max-md:fixed max-md:inset-x-3 max-md:bottom-3 md:absolute md:bottom-full md:right-0 md:mb-2 md:w-72"
        >
          <p className="text-xs text-muted">Save the bets on the table, and put them back with one press.</p>
          <ul className="mt-2 space-y-2">
            {slots.map((slot, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-ivory">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-cream/90">{slot ? slot.summary : <span className="text-muted">Empty</span>}</span>
                {slot ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      aria-label={`Use preset ${i + 1}`}
                      onClick={() => {
                        onLoad(i);
                        setOpen(false);
                      }}
                    >
                      Use
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Empty preset ${i + 1}`} onClick={() => onClear(i)}>
                      ✕
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" disabled={!canSave} aria-label={`Save these bets as preset ${i + 1}`} onClick={() => onSave(i)}>
                    Save
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!canSave && saved < slots.length && <p className="mt-2 text-xs text-muted">Put some bets on the table to save them.</p>}
        </div>
      )}
    </div>
  );
}

/** "350 on 3 spots" */
export function presetSummary(amounts: number[]): string {
  const total = amounts.reduce((n, v) => n + v, 0);
  return `${total.toLocaleString('en-US')} on ${amounts.length} ${amounts.length === 1 ? 'spot' : 'spots'}`;
}

/**
 * Three preset slots kept on this device under `key` (null until the game has loaded). Used by
 * the tables, whose bets are rows on the server; the solo games keep theirs in `useSpotBets`.
 */
export function useStoredPresets<T>(key: string | null): [(T[] | null)[], (i: number, value: T[] | null) => void] {
  const read = (k: string | null) => {
    const v = k ? recall<unknown>(`presets:${k}`, null) : null;
    return [0, 1, 2].map((i) => (Array.isArray(v) && Array.isArray(v[i]) && v[i].length > 0 ? (v[i] as T[]) : null));
  };
  const [slots, setSlots] = useState<(T[] | null)[]>(() => read(key));
  useEffect(() => setSlots(read(key)), [key]);
  const set = (i: number, value: T[] | null) => {
    if (!key) return;
    const next = slots.map((s, k) => (k === i ? value : s));
    setSlots(next);
    remember(`presets:${key}`, next);
  };
  return [slots, set];
}
