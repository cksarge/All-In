import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/components/ui/cn';
import { OTP_LENGTH } from '@/lib/validation';

/**
 * Six-box one-time-code input.
 * - Typing a digit advances; Backspace on an empty box goes back.
 * - Pasting (or autofill of) the whole code fills every box.
 * - Arrow keys move between boxes. Calls onComplete when all 6 are filled.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus = true,
  length = OTP_LENGTH,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  length?: number;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  // Latest value, readable from handlers that fire before React re-renders
  // (fast typing, focus moves made inside a change handler).
  const valueRef = useRef(value);
  valueRef.current = value;
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, length - 1)]?.focus();
    // Only on mount.
  }, []);

  const focus = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  };

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    valueRef.current = clean;
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const setDigitAt = (i: number, raw: string) => {
    const current = valueRef.current;
    const currentDigits = Array.from({ length }, (_, k) => current[k] ?? '');
    let incoming = raw.replace(/\D/g, '');
    if (!incoming) return;
    // Typing into a box that already holds a digit: keep only the new one.
    if (currentDigits[i] && incoming.length === 2) {
      incoming = incoming.startsWith(currentDigits[i]) ? incoming.slice(1) : incoming.slice(0, 1);
    }
    if (incoming.length > 1) {
      // Autofill / fast typing / paste into one box: spread from this position.
      const merged = (current.slice(0, i) + incoming).slice(0, length);
      const clean = commit(merged);
      focus(clean.length);
      return;
    }
    const arr = currentDigits.slice();
    arr[i] = incoming;
    const clean = commit(arr.join(''));
    focus(Math.min(i + 1, clean.length));
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    const value = valueRef.current;
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[i]) {
        commit(value.slice(0, i) + value.slice(i + 1));
        focus(i);
      } else if (i > 0) {
        commit(value.slice(0, i - 1) + value.slice(i));
        focus(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(Math.min(i + 1, value.length));
    } else if (e.key === 'Delete') {
      e.preventDefault();
      commit(value.slice(0, i) + value.slice(i + 1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!text) return;
    e.preventDefault();
    const clean = commit(text);
    focus(clean.length);
  };

  return (
    <div role="group" aria-label={`${length}-digit verification code`} className="flex justify-center gap-2 sm:gap-3">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => setDigitAt(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => {
            // Don't allow skipping ahead past the first empty box.
            if (i > valueRef.current.length) focus(valueRef.current.length);
            else e.target.select();
          }}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-14 w-11 rounded-xl border bg-ink-950/70 text-center font-display text-2xl font-bold text-ivory sm:h-16 sm:w-13 sm:text-3xl',
            'caret-gold-400 transition focus:outline-none focus:ring-2 disabled:opacity-60',
            invalid
              ? 'border-ruby-400/70 focus:ring-ruby-400/30'
              : d
                ? 'border-gold-500/60 focus:ring-gold-500/30'
                : 'border-white/12 focus:border-gold-500/70 focus:ring-gold-500/25',
          )}
        />
      ))}
    </div>
  );
}
