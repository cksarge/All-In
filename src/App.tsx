import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Toaster } from '@/components/ui/Toaster';
import { supabaseConfigured } from '@/lib/supabase';
import ConfigMissingPage from '@/pages/ConfigMissingPage';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import HowChipsWorkPage from '@/pages/HowChipsWorkPage';
import JoinPage from '@/pages/JoinPage';
import LandingPage from '@/pages/LandingPage';
import LogInPage from '@/pages/LogInPage';
import LobbyPage from '@/pages/LobbyPage';
import LoungePage from '@/pages/LoungePage';
import NotFoundPage from '@/pages/NotFoundPage';
import SettingsPage from '@/pages/SettingsPage';
import SignUpPage from '@/pages/SignUpPage';
import TablePage from '@/pages/TablePage';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import { GuestOnly, RequireAuth } from '@/routes/guards';
import { useOnlinePresence } from '@/hooks/useLobby';
import { useAuth } from '@/stores/authStore';
import { prefersReducedMotion, useSettings } from '@/stores/settingsStore';
import { useWallet } from '@/stores/walletStore';

const TITLES: Record<string, string> = {
  '/': 'All In · Free-play casino lounge',
  '/signup': 'Create account · All In',
  '/login': 'Log in · All In',
  '/verify': 'Verify email · All In',
  '/forgot-password': 'Reset password · All In',
  '/lounge': 'Lounge · All In',
  '/lobby': 'Lobby · All In',
  '/how-chips-work': 'How chips work · All In',
  '/settings': 'Settings · All In',
};

function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = TITLES[pathname] ?? (pathname.startsWith('/table/') ? 'At the table · All In' : 'All In');
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

/** Joins the global "who's online" presence channel while signed in. */
function PresenceConnector() {
  useOnlinePresence();
  return null;
}

/** Keeps the wallet connected to Realtime while signed in. */
function WalletConnector() {
  const userId = useAuth((s) => s.user?.id);
  const connect = useWallet((s) => s.connect);
  const reset = useWallet((s) => s.reset);
  useEffect(() => {
    if (!userId) {
      reset();
      return;
    }
    return connect(userId);
  }, [userId, connect, reset]);
  return null;
}

export default function App() {
  const init = useAuth((s) => s.init);
  const motionPref = useSettings((s) => s.motion);
  const reduced = prefersReducedMotion(motionPref);

  useEffect(() => init(), [init]);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced);
  }, [reduced]);

  if (!supabaseConfigured) return <ConfigMissingPage />;

  return (
    <MotionConfig reducedMotion={motionPref === 'system' ? 'user' : reduced ? 'always' : 'never'}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <RouteEffects />
        <WalletConnector />
        <PresenceConnector />
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<LandingPage />} />
            <Route path="signup" element={<GuestOnly><SignUpPage /></GuestOnly>} />
            <Route path="login" element={<GuestOnly><LogInPage /></GuestOnly>} />
            <Route path="verify" element={<GuestOnly><VerifyEmailPage /></GuestOnly>} />
            {/* Not GuestOnly: verifying the reset code signs you in mid-flow. */}
            <Route path="forgot-password" element={<ForgotPasswordPage />} />
            <Route path="how-chips-work" element={<HowChipsWorkPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="lounge" element={<RequireAuth><LoungePage /></RequireAuth>} />
            <Route path="lobby" element={<RequireAuth><LobbyPage /></RequireAuth>} />
            <Route path="table/:id" element={<RequireAuth><TablePage /></RequireAuth>} />
            <Route path="join/:code" element={<RequireAuth><JoinPage /></RequireAuth>} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        <Toaster />
      </BrowserRouter>
    </MotionConfig>
  );
}
