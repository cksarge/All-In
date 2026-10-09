import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthCard } from '@/components/auth/AuthCard';
import { captchaErrorMessage, Turnstile, type TurnstileHandle } from '@/components/auth/Turnstile';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { PasswordField, TextField } from '@/components/ui/TextField';
import { friendlyError } from '@/lib/errors';
import { setPending } from '@/lib/pendingAuth';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { emailIsValid } from '@/lib/validation';
import { safeNext } from '@/routes/guards';

export default function LogInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const captcha = useRef<TurnstileHandle>(null);

  const emailErr = !emailIsValid(email) ? 'Please enter a valid email address.' : null;
  const pwErr = !password ? 'Enter your password.' : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (emailErr || pwErr) return;
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();
    let captchaToken: string | undefined;
    try {
      captchaToken = await captcha.current?.getToken();
    } catch (e) {
      setBusy(false);
      playSound('error');
      setError(captchaErrorMessage(e));
      return;
    }
    const { error: err } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
      options: { captchaToken },
    });
    captcha.current?.reset();
    if (err) {
      if (err.code === 'email_not_confirmed') {
        // Send a fresh code (needs its own security token) and go to the verify screen.
        let resendErr: unknown = null;
        try {
          const resendToken = await captcha.current?.getToken();
          ({ error: resendErr } = await supabase.auth.resend({
            type: 'signup',
            email: cleanEmail,
            options: { captchaToken: resendToken },
          }));
        } catch (e) {
          resendErr = e;
        }
        captcha.current?.reset();
        setBusy(false);
        setPending({ email: cleanEmail, kind: 'signup', sentAt: resendErr ? 0 : Date.now() });
        navigate('/verify', { replace: true });
        return;
      }
      setBusy(false);
      playSound('error');
      setError(friendlyError(err, 'login'));
      return;
    }
    setBusy(false);
    playSound('chip');
    navigate(safeNext(params.get('next')), { replace: true });
  };

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Log in"
      subtitle="Your seat in the lounge is waiting."
      footer={
        <>
          New to All In?{' '}
          <Link to="/signup" className="font-semibold text-gold-300 hover:underline">
            Create a free account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={submitted ? emailErr : null}
          autoFocus
        />
        <div className="flex flex-col gap-2">
          <PasswordField
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={submitted ? pwErr : null}
          />
          <Link to="/forgot-password" className="self-end text-sm font-medium text-gold-300 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Turnstile ref={captcha} action="login" />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" size="lg" block loading={busy}>
          Log in
        </Button>
      </form>
    </AuthCard>
  );
}
