import { useEffect, useState, type ReactNode } from 'react';
import { Logo } from '@/components/ui/Logo';
import { FullPageLoader } from '@/components/ui/States';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';

interface SiteStatus {
  maintenance: boolean;
  message: string | null;
  admin: boolean;
}

/**
 * Asks the server whether the site is open before anything else is shown.
 * While maintenance is on, only the admin (already signed in) gets past this;
 * everyone else, signed in or not, sees the maintenance page. The server refuses
 * their game calls too (15_moderation.sql), so this page is not the lock.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const authStatus = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id);
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    // Wait until we know who is asking: the answer says whether they are the admin.
    if (authStatus === 'loading') return;
    let alive = true;
    const ask = () =>
      void supabase.rpc('site_status').then(({ data, error }) => {
        if (!alive) return;
        // No such function yet (the SQL hasn't been run), or the network failed: the site is open.
        setStatus(error ? null : (data as SiteStatus));
        setAsked(true);
      });
    ask();
    const poll = window.setInterval(ask, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && ask();
    document.addEventListener('visibilitychange', onVisible);
    const ch = supabase.channel('site-status').on('postgres_changes', { event: '*', schema: 'public', table: 'site_status' }, ask).subscribe();
    return () => {
      alive = false;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
    };
  }, [authStatus, userId]);

  if (!asked) return <FullPageLoader label="Shuffling up…" />;
  if (status?.maintenance && !status.admin) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16 text-center" role="alert">
        <Logo to="/" />
        <div className="surface max-w-md p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">Back soon</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ivory">Site maintenance</h1>
          <p className="mt-3 text-sm leading-relaxed text-cream/85">
            The site is currently undergoing maintenance, so the lounge and all the tables are closed for a little while. Your chips, progress and
            anything you had on a table are safe.
          </p>
          {status.message && <p className="mt-3 rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 text-sm text-gold-100">{status.message}</p>}
          <p className="mt-4 text-xs text-muted">This page checks by itself and will let you back in as soon as the site reopens.</p>
        </div>
        <p className="text-xs text-muted">Free to play. No real money. No purchases. Chips have no cash value.</p>
      </main>
    );
  }
  return (
    <>
      {status?.maintenance && status.admin && (
        <p role="status" className="bg-ruby-600 px-4 py-1.5 text-center text-sm font-semibold text-ivory">
          Maintenance mode is ON. Only you can use the site. Switch it off on the admin page.
        </p>
      )}
      {children}
    </>
  );
}
