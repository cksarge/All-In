import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { AppealBox } from './AppealBox';
import { TextField } from '@/components/ui/TextField';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAccount } from '@/stores/accountStore';
import { useAuth } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

function Frame({ title, children }: { title: string; children: ReactNode }) {
  const signOut = useAuth((s) => s.signOut);
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="surface p-6 sm:p-8" role="alert">
        <h1 className="font-display text-3xl font-bold text-ivory">{title}</h1>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-cream/85">{children}</div>
        <Button variant="outline" size="sm" className="mt-6" onClick={() => void signOut()}>
          Log out
        </Button>
      </div>
    </div>
  );
}

function Rename() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('change_username', { p_username: name.trim() });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    toast.success('Username changed', 'Welcome back to the tables.');
    await Promise.all([useAccount.getState().fetch(), useAuth.getState().loadProfile()]);
  };
  return (
    <Frame title="Choose a new username">
      <p>A moderator has asked you to change your username. Pick a new one to keep playing. Your chips and progress are untouched.</p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 pt-1">
        <TextField
          label="New username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          hint="3 to 16 letters, numbers or underscores."
          maxLength={16}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <Button type="submit" loading={busy} disabled={name.trim().length < 3}>
          Save username
        </Button>
      </form>
    </Frame>
  );
}

/** Stands in for the whole app while your account is banned, in a timeout, or needs a new name. */
export function AccountGate({ children }: { children: ReactNode }) {
  const account = useAccount((s) => s.account);
  const until = account?.timeout_until ? new Date(account.timeout_until).getTime() : 0;
  // Let the player back in the moment a timeout ends.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const id = window.setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() > until) void useAccount.getState().fetch();
    }, 5000);
    return () => window.clearInterval(id);
  }, [until]);

  if (account?.banned) {
    return (
      <Frame title="Account suspended">
        <p>This account has been suspended by a moderator and can&apos;t play.</p>
        {account.ban_reason && (
          <p>
            Reason: <strong className="text-ivory">{account.ban_reason}</strong>
          </p>
        )}
        <AppealBox what="the suspension" />
      </Frame>
    );
  }
  if (until > Date.now()) {
    return (
      <Frame title="You're in a timeout">
        <p>
          A moderator has paused this account until{' '}
          <strong className="text-ivory">{new Date(until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>. You can
          play again after that. Your chips and progress are untouched.
        </p>
        {account?.timeout_reason && (
          <p>
            Reason: <strong className="text-ivory">{account.timeout_reason}</strong>
          </p>
        )}
        <AppealBox what="the timeout" />
      </Frame>
    );
  }
  if (account?.must_rename) return <Rename />;
  return <>{children}</>;
}
