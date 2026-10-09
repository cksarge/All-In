import { useEffect, useState } from 'react';
import { useNow } from '@/hooks/useNow';
import { RESEND_COOLDOWN_S } from '@/lib/pendingAuth';

/** "Resend code" link with a visible cooldown. `lastSentAt` is ms since epoch. */
export function ResendCodeButton({
  lastSentAt,
  onResend,
  cooldownSeconds = RESEND_COOLDOWN_S,
}: {
  lastSentAt: number;
  onResend: () => Promise<number | void>;
  cooldownSeconds?: number;
}) {
  const now = useNow(500);
  const [busy, setBusy] = useState(false);
  const [extraWaitUntil, setExtraWaitUntil] = useState(0);
  const readyAt = Math.max(lastSentAt + cooldownSeconds * 1000, extraWaitUntil);
  const remaining = Math.ceil((readyAt - now) / 1000);

  useEffect(() => setExtraWaitUntil(0), [lastSentAt]);

  const handle = async () => {
    setBusy(true);
    try {
      const waitSeconds = await onResend();
      if (typeof waitSeconds === 'number' && waitSeconds > 0) setExtraWaitUntil(Date.now() + waitSeconds * 1000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <p className="text-center text-sm text-muted">
      Didn&apos;t get it? Check spam, or{' '}
      {remaining > 0 ? (
        <span aria-live="polite">
          resend in <span className="tabular-nums text-cream">{remaining}s</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={handle}
          disabled={busy}
          className="font-semibold text-gold-300 underline-offset-4 hover:underline disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'resend the code'}
        </button>
      )}
    </p>
  );
}
