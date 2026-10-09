import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard } from '@/components/auth/AuthCard';
import { OtpInput } from '@/components/auth/OtpInput';
import { ResendCodeButton } from '@/components/auth/ResendCodeButton';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { friendlyError, retryAfterSeconds } from '@/lib/errors';
import { maskEmail } from '@/lib/format';
import { clearPending, getPending, OTP_TTL_MS, setPending } from '@/lib/pendingAuth';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { emailIsValid, OTP_LENGTH } from '@/lib/validation';
import { toast } from '@/stores/toastStore';

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const initial = getPending('signup');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [emailLocked, setEmailLocked] = useState(Boolean(initial));
  const [sentAt, setSentAt] = useState(initial?.sentAt ?? 0);
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const verify = async (token: string) => {
    if (busy || token.length !== OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    setBusy(false);
    if (err) {
      playSound('error');
      const expired = sentAt > 0 && Date.now() - sentAt > OTP_TTL_MS;
      setError(
        err.code === 'otp_expired' && expired
          ? 'That code has expired. Request a new one below.'
          : friendlyError(err, 'verify'),
      );
      setCode('');
      setAttempt((a) => a + 1);
      return;
    }
    clearPending();
    playSound('success');
    toast.success('Email verified', 'Welcome to All In! Your 10,000 starting chips are ready.');
    navigate('/lounge', { replace: true });
  };

  const resend = async (): Promise<number | void> => {
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.auth.resend({ type: 'signup', email });
    if (err) {
      playSound('error');
      setError(friendlyError(err, 'resend'));
      return retryAfterSeconds(err) ?? undefined;
    }
    const now = Date.now();
    setSentAt(now);
    setPending({ email, kind: 'signup', sentAt: now });
    setInfo(`We sent a new code to ${maskEmail(email)}.`);
    setCode('');
    setAttempt((a) => a + 1);
  };

  const onEmailSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!emailIsValid(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(null);
    setEmail(email.trim().toLowerCase());
    setEmailLocked(true);
  };

  if (!emailLocked) {
    return (
      <AuthCard
        eyebrow="Almost there"
        title="Verify your email"
        subtitle="Enter the email you signed up with, then the 6-digit code we sent you."
      >
        <form onSubmit={onEmailSubmit} className="flex flex-col gap-5" noValidate>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            autoFocus
          />
          <Button type="submit" size="lg" block>
            Continue
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Almost there"
      title="Check your email"
      subtitle={
        <>
          We sent a 6-digit code to <strong className="text-cream">{maskEmail(email)}</strong>. Enter it below to
          activate your account.
        </>
      }
      footer={
        <button
          type="button"
          className="text-muted underline-offset-4 hover:text-ivory hover:underline"
          onClick={() => {
            clearPending();
            setEmailLocked(false);
            setCode('');
            setError(null);
            setInfo(null);
          }}
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
          Verify email
        </Button>
        <ResendCodeButton lastSentAt={sentAt} onResend={resend} />
        <p className="text-center text-xs text-subtle">
          Already verified? <Link to="/login" className="text-gold-300 hover:underline">Log in</Link>
        </p>
      </form>
    </AuthCard>
  );
}
