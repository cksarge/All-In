import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { loadTurnstile, TURNSTILE_SITE_KEY, turnstileEnabled, type TurnstileApi } from '@/lib/turnstile';

export interface TurnstileHandle {
  /**
   * Resolves with a fresh, unused token (waits for the challenge if needed).
   * Resolves with undefined when Turnstile is disabled (no site key configured).
   * Rejects with Error('captcha_unavailable' | 'captcha_timeout').
   */
  getToken: () => Promise<string | undefined>;
  /** Discard the current token and run a new challenge. Call after each auth request. */
  reset: () => void;
}

type Waiter = { resolve: (t: string) => void; reject: (e: Error) => void; timer: number };

const WAIT_MS = 60_000;

/**
 * Cloudflare Turnstile. Visible by default; secondary spots (e.g. "resend code")
 * use 'interaction-only' so the widget only appears if Cloudflare needs a click.
 */
export const Turnstile = forwardRef<
  TurnstileHandle,
  {
    action?: string;
    className?: string;
    /** 'always' shows the widget; 'interaction-only' hides it unless Cloudflare needs a click. */
    appearance?: 'always' | 'interaction-only';
  }
>(function Turnstile({ action, className, appearance = 'always' }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<TurnstileApi | null>(null);
  const widgetRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const waiters = useRef<Waiter[]>([]);
  const [failed, setFailed] = useState(false);
  const [interactive, setInteractive] = useState(false);

  const flush = (fn: (w: Waiter) => void) => {
    const list = waiters.current;
    waiters.current = [];
    list.forEach((w) => {
      window.clearTimeout(w.timer);
      fn(w);
    });
  };

  useEffect(() => {
    if (!turnstileEnabled) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        apiRef.current = api;
        widgetRef.current = api.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme: 'dark',
          size: 'flexible',
          appearance,
          'response-field': false,
          'refresh-expired': 'auto',
          callback: (token) => {
            tokenRef.current = token;
            setFailed(false);
            const [first, ...rest] = waiters.current;
            if (first) {
              // One token, one request: hand it to the oldest waiter.
              window.clearTimeout(first.timer);
              tokenRef.current = null;
              waiters.current = rest;
              first.resolve(token);
            }
          },
          'expired-callback': () => {
            tokenRef.current = null;
          },
          'error-callback': () => {
            tokenRef.current = null;
            setFailed(true);
            flush((w) => w.reject(new Error('captcha_unavailable')));
            return true;
          },
          'before-interactive-callback': () => setInteractive(true),
          'after-interactive-callback': () => setInteractive(false),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          flush((w) => w.reject(new Error('captcha_unavailable')));
        }
      });

    return () => {
      cancelled = true;
      if (widgetRef.current && apiRef.current) apiRef.current.remove(widgetRef.current);
      widgetRef.current = null;
      flush((w) => w.reject(new Error('captcha_unavailable')));
    };
  }, [action, appearance]);

  useImperativeHandle(ref, () => ({
    getToken: () => {
      if (!turnstileEnabled) return Promise.resolve(undefined);
      const ready = tokenRef.current;
      if (ready) {
        tokenRef.current = null;
        return Promise.resolve(ready);
      }
      if (failed && !widgetRef.current) return Promise.reject(new Error('captcha_unavailable'));
      return new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          waiters.current = waiters.current.filter((w) => w.timer !== timer);
          reject(new Error('captcha_timeout'));
        }, WAIT_MS);
        waiters.current.push({ resolve, reject, timer });
      });
    },
    reset: () => {
      tokenRef.current = null;
      setFailed(false);
      if (widgetRef.current && apiRef.current) apiRef.current.reset(widgetRef.current);
    },
  }));

  if (!turnstileEnabled) return null;

  const visible = appearance === 'always' || interactive;
  return (
    <div className={cn(visible || failed ? 'flex flex-col gap-2' : 'contents', className)}>
      {interactive && <p className="text-sm text-cream/85">Quick security check: please confirm you’re human.</p>}
      {/* Reserve the widget's height so the form doesn't jump when it appears. */}
      <div ref={containerRef} className={visible ? 'min-h-[65px]' : undefined} />
      {failed && (
        <p role="alert" className="text-xs font-medium text-ruby-300">
          The security check couldn’t load. Check your connection or disable content blockers for this site, then
          refresh the page.
        </p>
      )}
    </div>
  );
});

/** Friendly text for errors thrown by getToken(). */
export function captchaErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg === 'captcha_timeout') return 'The security check took too long. Please try again.';
  return 'The security check couldn’t load. Refresh the page and try again.';
}
