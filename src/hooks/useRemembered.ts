import { useCallback, useState } from 'react';

const PREFIX = 'allin-mem:';

function read<T>(key: string, fallback: T, valid?: (v: T) => boolean): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw) as T;
    return valid && !valid(v) ? fallback : v;
  } catch {
    return fallback;
  }
}

/**
 * useState that remembers its value on this device (localStorage), e.g. the last bet at a game.
 * `valid` rejects a remembered value that no longer makes sense (a bet step that was removed);
 * the fallback is used instead. A null key behaves like plain useState.
 */
export function useRemembered<T>(key: string | null, initial: T, valid?: (v: T) => boolean) {
  const [value, setValue] = useState<T>(() => (key ? read(key, initial, valid) : initial));
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (key) remember(key, v);
        return v;
      });
    },
    [key],
  );
  return [value, set] as const;
}

/** Read or write a remembered value outside a hook (same store as useRemembered). */
export const recall = read;
export function remember<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: it just won't be remembered.
  }
}
