import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { AuthCard } from '@/components/auth/AuthCard';
import { OtpInput } from '@/components/auth/OtpInput';
import { ResendCodeButton } from '@/components/auth/ResendCodeButton';
import { captchaErrorMessage, Turnstile, type TurnstileHandle } from '@/components/auth/Turnstile';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { FullPageLoader } from '@/components/ui/States';
import { friendlyError, retryAfterSeconds } from '@/lib/errors';
import { maskEmail } from '@/lib/format';
import { OTP_TTL_MS } from '@/lib/pendingAuth';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { OTP_LENGTH } from '@/lib/validation';
import { useAccount } from '@/stores/accountStore';
import { useAuth } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

/**
 * Two-step verification: a 6-digit code by email after the password, at every login.
 * The server is the gate (15_moderation.sql: with it on, a session made with a password alone is
 * refused by every game call); these screens are how a player gets a session that passes.
 */

// ---- "Secure your account?", asked once, straight after the sign-up code ----
const OFFER_KEY = 'allin-2sv-offer';
const readOffer = () => {
  try {
    return sessionStorage.getItem(OFFER_KEY) === '1';
  } catch {
    return false;
  }
};
export const useTwoStepOffer = create<{ offer: boolean; setOffer: (on: boolean) => void }>()((set) => ({
  offer: readOffer(),
  setOffer: (on) => {
    try {
      if (on) sessionStorage.setItem(OFFER_KEY, '1');
      else sessionStorage.removeItem(OFFER_KEY);
    } catch {
      /* storage unavailable: the question is simply not asked after a reload */
    }
    set({ offer: on });
  },
}));

// ---- When the last code went out, so a reload does not send another and cancel the first ----
const SENT_KEY = 'allin-2sv-sent';
const AUTO_SEND_GAP_MS = 10 * 60 * 1000;
function lastSent(userId: string): number {
  try {
    const p = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? 'null') as { id: string; at: number } | null;
    return p && p.id === userId ? p.at : 0;
  } catch {
    return 0;
  }
}
function noteSent(userId: string | null, at = 0) {
  try {
    if (userId) sessionStorage.setItem(SENT_KEY, JSON.stringify({ id: userId, at }));
    else sessionStorage.removeItem(SENT_KEY);
  } catch {
    /* ignore */
  }
}
/** One send at a time, however often the form mounts. */
let sending = false;

/**
 * Emails a code to the signed-in player and checks the one they type. Entering it replaces the
 * session with one the server counts as verified.
 */
export function IdentityCodeForm({ onVerified, submitLabel = 'Verify' }: { onVerified: () => void | Promise<void>; submitLabel?: string }) {
  const user = useAuth((s) => s.user);
  const email = user?.email ?? '';
  const userId = user?.id ?? '';
  const [sentAt, setSentAt] = useState(() => lastSent(userId));
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const captcha = useRef<TurnstileHandle>(null);

  const send = useCallback(
    async (again: boolean): Promise<number | void> => {
      if (sending || !email) return;
      sending = true;
      setError(null);
      setInfo(null);
      try {
        let captchaToken: string | undefined;
        try {
          captchaToken = await captcha.current?.getToken();
        } catch (e) {
          setError(captchaErrorMessage(e));
          return;
        }
        const { error: err } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken } });
        captcha.current?.reset();
        if (err) {
          setError(friendlyError(err, 'resend'));
          return retryAfterSeconds(err) ?? undefined;
        }
        const now = Date.now();
        noteSent(userId, now);
        setSentAt(now);
        if (again) {
          setInfo(`We sent a new code to ${maskEmail(email)}.`);
          setCode('');
          setAttempt((a) => a + 1);
        }
      } finally {
        sending = false;
      }
    },
    [email, userId],
  );

  // The first code goes out by itself, unless one was sent a moment ago (a reload).
  useEffect(() => {
    if (email && Date.now() - lastSent(userId) > AUTO_SEND_GAP_MS) void send(false);
  }, [email, userId, send]);

  const verify = async (token: string) => {
    if (busy || token.length !== OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (err) {
      setBusy(false);
      playSound('error');
      const expired = sentAt > 0 && Date.now() - sentAt > OTP_TTL_MS;
      setError(err.code === 'otp_expired' && expired ? 'That code has expired. Request a new one below.' : friendlyError(err, 'verify'));
      setCode('');
      setAttempt((a) => a + 1);
      return;
    }
    noteSent(null);
    await useAccount.getState().fetch();
    await onVerified();
    setBusy(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
      className="flex flex-col gap-6"
    >
      <OtpInput
        key={attempt}
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={(v) => void verify(v)}
        disabled={busy}
        invalid={Boolean(error)}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}
      <Button type="submit" size="lg" block loading={busy} disabled={code.length !== OTP_LENGTH}>
        {submitLabel}
      </Button>
      <ResendCodeButton lastSentAt={sentAt} onResend={() => send(true)} />
      <Turnstile ref={captcha} action="two_step" appearance="interaction-only" />
    </form>
  );
}

/** The second step of logging in. Its own page, so it is never mistaken for the sign-up code. */
function VerifyIdentity() {
  const email = useAuth((s) => s.user?.email ?? '');
  const signOut = useAuth((s) => s.signOut);
  return (
    <AuthCard
      eyebrow="Two-step verification"
      title="Verify your identity"
      subtitle={
        <>
          Your password was right. To finish logging in, enter the 6-digit code we sent to <strong className="text-cream">{maskEmail(email)}</strong>.
        </>
      }
      footer={
        <button
          type="button"
          className="text-muted underline-offset-4 hover:text-ivory hover:underline"
          onClick={() => {
            noteSent(null);
            void signOut();
          }}
        >
          Log out and use a different account
        </button>
      }
    >
      <IdentityCodeForm
        submitLabel="Verify and continue"
        onVerified={() => {
          playSound('success');
          // Everything that tried to load with the password-only session loads again.
          useAccount.getState().bump();
        }}
      />
    </AuthCard>
  );
}

/** Switches two-step verification on or off. Returns a message when it could not. */
export async function setTwoStep(on: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('set_two_step', { p_on: on });
  if (error) return friendlyError(error);
  await useAccount.getState().fetch();
  return null;
}

/** Asked once, between the sign-up code and the lounge. */
function SecureAccountOffer() {
  const email = useAuth((s) => s.user?.email ?? '');
  const setOffer = useTwoStepOffer((s) => s.setOffer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enable = async () => {
    setBusy(true);
    setError(null);
    const err = await setTwoStep(true);
    setBusy(false);
    if (err !== null) {
      playSound('error');
      setError(err);
      return;
    }
    playSound('success');
    toast.success('Two-step verification is on', 'From your next login we will email you a code after your password.');
    setOffer(false);
  };
  return (
    <AuthCard
      eyebrow="One more thing"
      title="Secure your account?"
      subtitle="Two-step verification keeps your account yours even if someone learns your password."
    >
      <div className="flex flex-col gap-5">
        <ul className="space-y-2 text-sm leading-relaxed text-cream/85">
          <li>
            Each time you log in, after your password, we email a 6-digit code to <strong className="text-cream">{maskEmail(email)}</strong>.
          </li>
          <li>You enter it once per login. Staying logged in on this device needs no new code.</li>
          <li>You can switch it on or off at any time in Settings, under Account.</li>
        </ul>
        {error && <Alert tone="error">{error}</Alert>}
        <Button size="lg" block loading={busy} onClick={() => void enable()}>
          Turn on two-step verification
        </Button>
        <Button variant="ghost" block disabled={busy} onClick={() => setOffer(false)}>
          Not now
        </Button>
      </div>
    </AuthCard>
  );
}

/**
 * Stands in for the page while a code is owed (two-step verification is on and this session has
 * only the password), and once, after sign-up, to offer switching it on.
 */
export function TwoStepGate({ children }: { children: ReactNode }) {
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const account = useAccount((s) => s.account);
  const loaded = useAccount((s) => s.loaded);
  const { offer, setOffer } = useTwoStepOffer();
  // Nothing to offer once it is on, or while the server does not know the setting yet.
  const stale = offer && account !== null && (account.two_step === undefined || account.two_step);
  useEffect(() => {
    if (stale) setOffer(false);
  }, [stale, setOffer]);

  // Until the server has said whether a code is owed, show nothing of the site.
  if (signedIn && !loaded) return <FullPageLoader />;
  if (signedIn && account?.verify_required) return <VerifyIdentity />;
  if (signedIn && offer && account?.two_step === false) return <SecureAccountOffer />;
  return <>{children}</>;
}
