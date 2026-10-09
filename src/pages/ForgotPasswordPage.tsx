import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard } from '@/components/auth/AuthCard';
import { OtpInput } from '@/components/auth/OtpInput';
import { PasswordChecklist } from '@/components/auth/PasswordChecklist';
import { ResendCodeButton } from '@/components/auth/ResendCodeButton';
import { captchaErrorMessage, Turnstile, type TurnstileHandle } from '@/components/auth/Turnstile';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { PasswordField, TextField } from '@/components/ui/TextField';
import { friendlyError, retryAfterSeconds } from '@/lib/errors';
import { maskEmail } from '@/lib/format';
import { clearPending, getPending, OTP_TTL_MS, setPending } from '@/lib/pendingAuth';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { emailIsValid, OTP_LENGTH, passwordIsValid } from '@/lib/validation';
import { toast } from '@/stores/toastStore';

type Step = 'email' | 'code' | 'password';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const pending = getPending('recovery');
  const [step, setStep] = useState<Step>(pending ? 'code' : 'email');
  const [email, setEmail] = useState(pending?.email ?? '');
  const [sentAt, setSentAt] = useState(pending?.sentAt ?? 0);
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const captcha = useRef<TurnstileHandle>(null);

  const sendCode = async (address: string): Promise<{ ok: boolean; wait?: number }> => {
    let captchaToken: string | undefined;
    try {
      captchaToken = await captcha.current?.getToken();
    } catch (e) {
      playSound('error');
      setError(captchaErrorMessage(e));
      return { ok: false };
    }
    const { error: err } = await supabase.auth.resetPasswordForEmail(address, { captchaToken });
    captcha.current?.reset();
    if (err) {
      playSound('error');
      setError(friendlyError(err, 'reset'));
      return { ok: false, wait: retryAfterSeconds(err) ?? undefined };
    }
    const now = Date.now();
    setSentAt(now);
    setPending({ email: address, kind: 'recovery', sentAt: now });
    return { ok: true };
  };

  const onEmail = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!emailIsValid(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    const clean = email.trim().toLowerCase();
    setEmail(clean);
    setBusy(true);
    const res = await sendCode(clean);
    setBusy(false);
    if (res.ok) setStep('code');
  };

  const verify = async (token: string) => {
    if (busy || token.length !== OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    setBusy(false);
    if (err) {
      playSound('error');
      const expired = sentAt > 0 && Date.now() - sentAt > OTP_TTL_MS;
      setError(err.code === 'otp_expired' && expired ? 'That code has expired. Request a new one below.' : friendlyError(err, 'verify'));
      setCode('');
      setAttempt((a) => a + 1);
      return;
    }
    playSound('chip');
    setStep('password');
  };

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!passwordIsValid(password) || password !== confirm) return;
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      playSound('error');
      setError(friendlyError(err, 'update_password'));
      return;
    }
    clearPending();
    playSound('success');
    toast.success('Password updated', "You're signed in and ready to play.");
    navigate('/lounge', { replace: true });
  };

  const footer = (
    <Link to="/login" className="font-semibold text-gold-300 hover:underline">
      Back to log in
    </Link>
  );

  if (step === 'email') {
    return (
      <AuthCard
        eyebrow="Reset password"
        title="Forgot your password?"
        subtitle="Enter your account email and we'll send you a 6-digit code."
        footer={footer}
      >
        <form onSubmit={onEmail} noValidate className="flex flex-col gap-5">
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <Turnstile ref={captcha} action="reset" />
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" size="lg" block loading={busy}>
            Send code
          </Button>
        </form>
      </AuthCard>
    );
  }

  if (step === 'code') {
    return (
      <AuthCard
        eyebrow="Reset password · Step 2 of 3"
        title="Enter your code"
        subtitle={
          <>
            If an account exists for <strong className="text-cream">{maskEmail(email)}</strong>, a 6-digit code is on
            its way.
          </>
        }
        footer={
          <button
            type="button"
            onClick={() => {
              clearPending();
              setStep('email');
              setError(null);
              setInfo(null);
              setCode('');
            }}
            className="text-muted underline-offset-4 hover:text-ivory hover:underline"
          >
            Use a different email
          </button>
        }
      >
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
            Continue
          </Button>
          <ResendCodeButton
            lastSentAt={sentAt}
            onResend={async () => {
              setError(null);
              setInfo(null);
              const res = await sendCode(email);
              if (res.ok) {
                setInfo(`We sent a new code to ${maskEmail(email)}.`);
                setCode('');
                setAttempt((a) => a + 1);
              }
              return res.wait;
            }}
          />
          <Turnstile ref={captcha} action="reset" appearance="interaction-only" />
        </form>
      </AuthCard>
    );
  }

  const pwErr = submitted && !passwordIsValid(password) ? 'Your password needs to meet every requirement below.' : null;
  const confirmErr = submitted && password !== confirm ? "Passwords don't match." : null;

  return (
    <AuthCard eyebrow="Reset password · Step 3 of 3" title="Choose a new password" subtitle="Make it something you haven't used here before.">
      <form onSubmit={onPassword} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={pwErr}
            autoFocus
            aria-describedby="new-pw-rules"
          />
          <PasswordChecklist password={password} id="new-pw-rules" />
        </div>
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirmErr}
        />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" size="lg" block loading={busy}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
