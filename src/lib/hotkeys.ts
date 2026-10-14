import { useEffect, useRef } from 'react';
import { useSettings } from '@/stores/settingsStore';

/**
 * Keyboard shortcuts. A screen says which keys do what with `useHotkeys` (or `hotkey` on a
 * `Button`); one listener (mounted once, in `HotkeyHost`) runs them, and "?" lists whatever is
 * registered on the screen being shown. Keys are named in lower case: a letter or digit,
 * `space`, `enter`, `-`, `+`, and `shift+1` and the like.
 */
export interface Hotkey {
  key: string;
  /** What it does, for the list ("Deal"). A function is read when the list opens. */
  label: string | (() => string);
  run: () => void;
  /** False while the key should do nothing (a disabled button). Left out = always. */
  enabled?: () => boolean;
  /** Only listed: the screen has its own listener for this key (poker, blackjack). */
  docOnly?: boolean;
}

let nextId = 1;
const registry = new Map<number, Hotkey>();

/** Registers shortcuts for as long as the component is on screen. A null key is skipped. */
export function useHotkeys(list: (Omit<Hotkey, 'key'> & { key: string | null | undefined })[]) {
  const ref = useRef(list);
  ref.current = list;
  const shape = list.map((h) => h.key ?? '').join('|');
  useEffect(() => {
    const ids: number[] = [];
    ref.current.forEach((h, i) => {
      if (!h.key) return;
      const id = nextId++;
      ids.push(id);
      // Read through the ref, so the newest handler runs without registering again on every render.
      registry.set(id, {
        key: h.key,
        label: () => {
          const l = ref.current[i]?.label ?? '';
          return typeof l === 'function' ? l() : l;
        },
        run: () => ref.current[i]?.run(),
        enabled: () => ref.current[i]?.enabled?.() ?? true,
        docOnly: h.docOnly,
      });
    });
    return () => ids.forEach((id) => registry.delete(id));
  }, [shape]);
}

/** Shortcuts a screen handles by itself, so that "?" can still list them. */
export function useHotkeyDocs(list: [key: string, label: string][]) {
  useHotkeys(list.map(([key, label]) => ({ key, label, run: () => undefined, docOnly: true })));
}

/** The name of the key that was pressed, or null for one we never use. */
export function keyName(e: KeyboardEvent): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digit) return (e.shiftKey ? 'shift+' : '') + digit[1];
  if (e.key === ' ' || e.code === 'Space') return 'space';
  if (e.key === 'Enter') return 'enter';
  if (e.key === '+' || e.key === '=') return '+';
  if (e.key === '-' || e.key === '_') return '-';
  if (e.key === '?') return '?';
  if (e.key.length === 1 && /[a-z]/i.test(e.key)) return e.key.toLowerCase();
  return null;
}

/** Typing, or a popup is open: keys belong to that, not to the game. */
export function typingOrDialog(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return true;
  return document.querySelector('[role="dialog"]') !== null;
}

/** Are shortcuts switched on (Settings)? The screens with their own listeners ask this too. */
export const hotkeysOn = () => useSettings.getState().hotkeysOn;

/** Runs the shortcut for a key press, if the screen has one. True when it did. */
export function runHotkey(e: KeyboardEvent): boolean {
  if (!hotkeysOn() || e.repeat || typingOrDialog(e.target)) return false;
  const key = keyName(e);
  if (!key) return false;
  // Space and Enter already press whatever button the keyboard is on: leave that alone.
  if ((key === 'space' || key === 'enter') && (e.target as HTMLElement | null)?.closest?.('button, a, [role="button"], [role="switch"], [role="radio"], [role="tab"], summary')) return false;
  // The newest registration wins: it belongs to whatever was put on screen last.
  const match = [...registry.values()].reverse().find((h) => h.key === key && !h.docOnly && (h.enabled?.() ?? true));
  if (!match) return false;
  e.preventDefault();
  match.run();
  return true;
}

/** Is anything registered? (Whether the "Keys" button and "?" have something to show.) */
export const hasHotkeys = () => registry.size > 0;

const ORDER = ['space', 'enter'];
/** What "?" shows: every shortcut on this screen, once each, the main ones first. */
export function listHotkeys(): { key: string; label: string }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  for (const h of registry.values()) {
    const label = (typeof h.label === 'function' ? h.label() : h.label).trim();
    if (!label || seen.has(`${h.key}|${label}`)) continue;
    seen.add(`${h.key}|${label}`);
    out.push({ key: h.key, label });
  }
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : /^[a-z]$/.test(k) ? 10 : /^\d$/.test(k) ? 20 : /^shift/.test(k) ? 30 : 15);
  return out.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

/** How a key is written on screen. */
export function keyLabel(key: string): string {
  if (key === 'space') return 'Space';
  if (key === 'enter') return 'Enter';
  if (key.startsWith('shift+')) return `Shift + ${key.slice(6)}`;
  return key.toUpperCase();
}

/** The key for each decision the card games offer by name (the server lists a hand's choices). */
export const ACTION_KEYS: Record<string, string> = {
  hit: 'h',
  stand: 's',
  double: 'd',
  split: 'p',
  surrender: 'r',
  switch: 'w',
  fold: 'f',
  call: 'c',
  check: 'c',
  play: 'space',
  ride: 'space',
  pull: 'p',
  raise: 'r',
  bet1: '1',
  bet2: '2',
  bet3: '3',
  bet4: '4',
};
