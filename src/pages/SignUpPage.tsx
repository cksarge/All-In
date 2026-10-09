import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard } from '@/components/auth/AuthCard';
import { PasswordChecklist } from '@/components/auth/PasswordChecklist';
import { captchaErrorMessage, Turnstile, type TurnstileHandle } from '@/components/auth/Turnstile';
import { NoRealMoneyNotice } from '@/components/layout/NoRealMoneyNotice';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Spinner } from '@/components/ui/Spinner';
import { PasswordField, TextField } from '@/components/ui/TextField';
import { useUsernameCheck, type UsernameStatus } from '@/hooks/useUsernameCheck';
import { friendlyError } from '@/lib/errors';
import { setPending } from '@/lib/pendingAuth';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { emailIsValid, passwordIsValid, usernameProblem } from '@/lib/validation';

const usernameMessages: Partial<Record<UsernameStatus, string>> = {
  taken: 'That username is taken. Try another.',
  reserved: "That username is reserved. Try another.",
};

export default function SignUpPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ack, setAck] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<{ text: string; loginLink?: boolean } | null>(null);
  const nameStatus = useUsernameCheck(username);
  const captcha = useRef<TurnstileHandle>(null);

  const show = (field: string) => submitted || touched[field];
  const touch = (field: string) => () => setTouched((t) => ({ ...t, [field]: true }));

  const emailErr = !emailIsValid(email) ? (email ? 'Please enter a valid email address.' : 'Enter your email.') : null;
  const nameErr = usernameProblem(username) ?? usernameMessages[nameStatus] ?? null;
  const pwErr = !passwordIsValid(password) ? 'Your password needs to meet every requirement below.' : null;
  const confirmErr = confirm !== password ? "Passwords don't match." : !confirm ? 'Re-enter your password.' : null;
  const ackErr = !ack ? 'Please confirm you understand All In uses play chips only.' : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (emailErr || nameErr || pwErr || confirmErr || ackErr) {
      playSound('error');
      return;
    }
    if (nameStatus === 'checking') return;

    setBusy(true);
    let captchaToken: string | undefined;
    try {
      captchaToken = await captcha.current?.getToken();
    } catch (err) {
      setBusy(false);
      playSound('error');
      setFormError({ text: captchaErrorMessage(err) });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { username }, captchaToken },
    });
    captcha.current?.reset();
    setBusy(false);

    if (error) {
      playSound('error');
      const exists = error.code === 'user_already_exists' || error.code === 'email_exists';
      setFormError({ text: friendlyError(error, 'signup'), loginLink: exists });
      return;
    }
    // With email-enumeration protection, an existing confirmed address returns a
    // user with no identities instead of an error.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      playSound('error');
      setFormError({ text: 'An account with this email already exists. Try logging in instead.', loginLink: true });
      return;
    }
    if (data.session) {
      // Email confirmation is disabled in the dashboard: already signed in.
      navigate('/lounge', { replace: true });
      return;
    }
    setPending({ email: cleanEmail, kind: 'signup', sentAt: Date.now() });
    navigate('/verify', { replace: true });
  };

  return (
    <AuthCard
      eyebrow="Join the lounge"
      title="Create your account"
      subtitle="Pick a username, verify your email, and start with 10,000 free play chips."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-gold-300 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <NoRealMoneyNotice compact className="mb-6" />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={touch('email')}
          error={show('email') ? emailErr : null}
          placeholder="you@example.com"
        />
        <TextField
          label="Username"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          value={username}
          maxLength={16}
          onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
          onBlur={touch('username')}
          error={(show('username') || nameStatus === 'taken' || nameStatus === 'reserved') ? nameErr : null}
          hint={<UsernameHint status={nameStatus} />}
          trailing={<UsernameIndicator status={nameStatus} />}
        />
        <div className="flex flex-col gap-3">
          <PasswordField
            label="Password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={touch('password')}
            error={show('password') ? pwErr : null}
            aria-describedby="pw-rules"
          />
          <PasswordChecklist password={password} id="pw-rules" />
        </div>
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={touch('confirm')}
          error={show('confirm') ? confirmErr : null}
        />
        <Checkbox checked={ack} onChange={setAck} error={submitted ? ackErr : null}>
          I understand that All In is a free game that uses <strong className="text-ivory">play chips only</strong>.
          There is no gambling, no purchases and no real money, and chips have no cash value.
        </Checkbox>

        <Turnstile ref={captcha} action="signup" />

        {formError && (
          <Alert tone="error">
            {formError.text}{' '}
            {formError.loginLink && (
              <Link to="/login" className="font-semibold text-gold-300 underline">
                Go to log in
              </Link>
            )}
          </Alert>
        )}

        <Button type="submit" size="lg" block loading={busy}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

function UsernameHint({ status }: { status: UsernameStatus }) {
  if (status === 'ok') return <span className="text-felt-300">Nice, that username is available.</span>;
  if (status === 'unknown') return <span>We&apos;ll confirm availability when you sign up.</span>;
  return <span>3–16 characters: letters, numbers and underscores.</span>;
}

function UsernameIndicator({ status }: { status: UsernameStatus }) {
  if (status === 'checking') return <Spinner className="mr-2 h-4 w-4 text-muted" label="Checking username" />;
  if (status === 'ok')
    return (
      <svg viewBox="0 0 20 20" className="mr-2.5 h-5 w-5 text-felt-300" role="img" aria-label="Available">
        <path d="M5 10.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  return null;
}
