import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { FullPageLoader } from '@/components/ui/States';
import { useAuth } from '@/stores/authStore';

/** Only allow in-app paths as a post-login destination, never another origin. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/lounge';
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'signedOut') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/** Sign-up / log-in / verify pages: signed-in players go straight to the lounge. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const [params] = useSearchParams();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'signedIn') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <>{children}</>;
}
