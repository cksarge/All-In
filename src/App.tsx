import { Fragment, useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { MaintenanceGate } from '@/components/account/MaintenanceGate';
import { MusicPlayer } from '@/components/layout/MusicPlayer';
import { AppLayout } from '@/components/layout/AppLayout';
import { Toaster } from '@/components/ui/Toaster';
import { playSound } from '@/lib/sound';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import AdminPage from '@/pages/AdminPage';
import ClubsPage from '@/pages/ClubsPage';
import ConfigMissingPage from '@/pages/ConfigMissingPage';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import FriendsPage from '@/pages/FriendsPage';
import HowChipsWorkPage from '@/pages/HowChipsWorkPage';
import TermsPage from '@/pages/TermsPage';
import PrivacyPage from '@/pages/PrivacyPage';
import JoinPage from '@/pages/JoinPage';
import LandingPage from '@/pages/LandingPage';
import LeaderboardPage from '@/pages/LeaderboardPage';
import LockerPage from '@/pages/LockerPage';
import LogInPage from '@/pages/LogInPage';
import InboxPage from '@/pages/InboxPage';
import LobbyPage from '@/pages/LobbyPage';
import MissionsPage from '@/pages/MissionsPage';
import PracticePage from '@/pages/PracticePage';
import LoungePage from '@/pages/LoungePage';
import NotFoundPage from '@/pages/NotFoundPage';
import PlayPage from '@/pages/PlayPage';
import ProfilePage from '@/pages/ProfilePage';
import SettingsPage from '@/pages/SettingsPage';
import SignUpPage from '@/pages/SignUpPage';
import ShowdownPage from '@/pages/ShowdownPage';
import TablePage from '@/pages/TablePage';
import TournamentsPage from '@/pages/TournamentsPage';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import { GuestOnly, RequireAuth } from '@/routes/guards';
import { useOnlinePresence } from '@/hooks/useLobby';
import { TwoStepGate } from '@/components/account/TwoStep';
import { useAccount } from '@/stores/accountStore';
import { useDm } from '@/stores/dmStore';
import { useReputation } from '@/stores/reputationStore';
import { useAuth } from '@/stores/authStore';
import { useLive } from '@/stores/liveStore';
import { useProgress } from '@/stores/progressStore';
import { prefersReducedMotion, useSettings, TEXT_SCALE } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
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
  '/profile': 'Profile · All In',
  '/locker': 'Locker · All In',
  '/friends': 'Friends · All In',
  '/leaderboards': 'Leaderboards · All In',
  '/tournaments': 'Tournaments · All In',
  '/admin': 'All In',
  '/missions': 'Missions · All In',
  '/practice': 'Practice · All In',
  '/clubs': 'Clubs · All In',
  '/inbox': 'Inbox · All In',
};

function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title =
      TITLES[pathname] ??
      (pathname.startsWith('/table/') ? 'At the table · All In' : pathname.startsWith('/play/') ? 'Playing · All In' : pathname.startsWith('/profile/') ? 'Profile · All In' : pathname.startsWith('/tournaments/') ? 'Tournament · All In' : pathname.startsWith('/clubs/') ? 'Club · All In' : pathname.startsWith('/practice/') ? 'Practice · All In' : 'All In');
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

/** Keeps XP, achievements and the equipped look loaded while signed in, and refreshes them as you move around. */
function ProgressConnector() {
  const userId = useAuth((s) => s.user?.id);
  const connect = useProgress((s) => s.connect);
  const reset = useProgress((s) => s.reset);
  const fetch = useProgress((s) => s.fetch);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!userId) {
      reset();
      return;
    }
    return connect(userId);
  }, [userId, connect, reset]);
  // Leaving a game is when new XP and achievements are most likely to be waiting.
  useEffect(() => {
    if (userId && useProgress.getState().me) void fetch();
  }, [pathname, userId, fetch]);
  return null;
}

/** Keeps your account's standing (ban, timeout, rename, blocks, the site notice) loaded while signed in. */
function AccountConnector() {
  const userId = useAuth((s) => s.user?.id);
  const connect = useAccount((s) => s.connect);
  const reset = useAccount((s) => s.reset);
  useEffect(() => {
    if (!userId) {
      reset();
      return;
    }
    return connect(userId);
  }, [userId, connect, reset]);
  return null;
}

/** Keeps your reputation (and so whether you may chat) loaded while signed in. */
function ReputationConnector() {
  const userId = useAuth((s) => s.user?.id);
  const connect = useReputation((s) => s.connect);
  const reset = useReputation((s) => s.reset);
  useEffect(() => {
    if (!userId) {
      reset();
      return;
    }
    return connect(userId);
  }, [userId, connect, reset]);
  return null;
}

/** Keeps your direct messages (the unread count) loaded while signed in. */
function DmConnector() {
  const userId = useAuth((s) => s.user?.id);
  const connect = useDm((s) => s.connect);
  const reset = useDm((s) => s.reset);
  useEffect(() => {
    if (!userId) {
      reset();
      return;
    }
    return connect(userId);
  }, [userId, connect, reset]);
  return null;
}

/** Keeps missions, the season and the inbox loaded while signed in; missions are re-read as you leave a game. */
function LiveConnector() {
  const userId = useAuth((s) => s.user?.id);
  const connect = useLive((s) => s.connect);
  const reset = useLive((s) => s.reset);
  const fetchMissions = useLive((s) => s.fetchMissions);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!userId) {
      reset();
      return;
    }
    return connect(userId);
  }, [userId, connect, reset]);
  useEffect(() => {
    if (userId && useLive.getState().missions) void fetchMissions();
  }, [pathname, userId, fetchMissions]);
  return null;
}

/** Takes you to your Sit & Go table the moment it fills, wherever you are on the site. */
function TournamentConnector() {
  const userId = useAuth((s) => s.user?.id);
  const navigate = useNavigate();
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`my-tournaments:${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournament_entries', filter: `user_id=eq.${userId}` }, ({ new: row }) => {
        const e = row as { status?: string; tournament_id?: string };
        if (e.status !== 'playing' || !e.tournament_id) return;
        // The seat is made in the same step as the entry changes, so it is there to find.
        void supabase.rpc('my_table').then(({ data }) => {
          const seat = data as { table_id: string; play_money?: boolean } | null;
          if (!seat?.play_money || window.location.pathname.endsWith(`/table/${seat.table_id}`)) return;
          playSound('turn');
          toast.success('Your tournament is starting', 'Taking you to the table.');
          navigate(`/table/${seat.table_id}`);
        });
      })
      .subscribe();
    // A Main Event you registered for starts on the clock. Events only begin when somebody asks
    // the server, so ask at its start time wherever you are, then go to your seat.
    const clock = window.setInterval(() => {
      let at: string | null = null;
      try {
        at = window.localStorage.getItem('allin-mtt-at');
      } catch {
        return;
      }
      if (!at || Date.now() < new Date(at).getTime() + 1500) return;
      window.localStorage.removeItem('allin-mtt-at');
      void supabase.rpc('mtt_state').then(({ data }) => {
        const table = (data as { my_table?: string | null } | null)?.my_table;
        if (!table || window.location.pathname.endsWith(`/table/${table}`)) return;
        playSound('turn');
        toast.success('The Main Event is starting', 'Taking you to your table.');
        navigate(`/table/${table}`);
      });
    }, 5000);
    return () => {
      window.clearInterval(clock);
      void supabase.removeChannel(ch);
    };
  }, [userId, navigate]);
  return null;
}

export default function App() {
  const init = useAuth((s) => s.init);
  const motionPref = useSettings((s) => s.motion);
  const textSize = useSettings((s) => s.textSize);
  const reduced = prefersReducedMotion(motionPref);
  const epoch = useAccount((s) => s.epoch);

  useEffect(() => init(), [init]);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced);
  }, [reduced]);

  // Compact / normal / large: the whole site is sized from the page's base text size.
  // On a narrow phone "large" takes a smaller step: the layouts are built to fit down to 360px wide,
  // and a bigger base size makes the screen act narrower than that.
  useEffect(() => {
    const apply = () => {
      const narrow = window.innerWidth < 430;
      document.documentElement.style.fontSize = textSize === 'large' && narrow ? '106.25%' : (TEXT_SCALE[textSize] ?? '100%');
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [textSize]);

  if (!supabaseConfigured) return <ConfigMissingPage />;

  return (
    <MotionConfig reducedMotion={motionPref === 'system' ? 'user' : reduced ? 'always' : 'never'}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <MusicPlayer />
        {/* Nothing below is shown until the server says the site is open (or that this is the admin). */}
        <MaintenanceGate>
          <RouteEffects />
          <AccountConnector />
          {/* Started again once a two-step code is entered: with only the password, their first calls were refused. */}
          <Fragment key={epoch}>
            <WalletConnector />
            <PresenceConnector />
            <ProgressConnector />
            <TournamentConnector />
            <ReputationConnector />
            <DmConnector />
            <LiveConnector />
          </Fragment>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<LandingPage />} />
              <Route path="signup" element={<GuestOnly><SignUpPage /></GuestOnly>} />
              <Route path="login" element={<GuestOnly><LogInPage /></GuestOnly>} />
              <Route path="verify" element={<GuestOnly><VerifyEmailPage /></GuestOnly>} />
              {/* Not GuestOnly: verifying the reset code signs you in mid-flow. */}
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="how-chips-work" element={<HowChipsWorkPage />} />
              <Route path="terms" element={<TermsPage />} />
              <Route path="privacy" element={<PrivacyPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="lounge" element={<RequireAuth><LoungePage /></RequireAuth>} />
              <Route path="lobby" element={<RequireAuth><LobbyPage /></RequireAuth>} />
              <Route path="practice" element={<RequireAuth><PracticePage /></RequireAuth>} />
              <Route path="practice/:drill" element={<RequireAuth><PracticePage /></RequireAuth>} />
              <Route path="practice/learn/:lesson" element={<RequireAuth><PracticePage /></RequireAuth>} />
              <Route path="table/:id" element={<RequireAuth><TablePage /></RequireAuth>} />
              <Route path="play/:gameKey" element={<RequireAuth><PlayPage /></RequireAuth>} />
              <Route path="profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
              <Route path="profile/:username" element={<RequireAuth><ProfilePage /></RequireAuth>} />
              <Route path="locker" element={<RequireAuth><LockerPage /></RequireAuth>} />
              <Route path="friends" element={<RequireAuth><FriendsPage /></RequireAuth>} />
              <Route path="leaderboards" element={<RequireAuth><LeaderboardPage /></RequireAuth>} />
              <Route path="clubs" element={<RequireAuth><ClubsPage /></RequireAuth>} />
              <Route path="clubs/:id" element={<RequireAuth><ClubsPage /></RequireAuth>} />
              <Route path="missions" element={<RequireAuth><MissionsPage /></RequireAuth>} />
              <Route path="inbox" element={<RequireAuth><InboxPage /></RequireAuth>} />
              <Route path="tournaments" element={<RequireAuth><TournamentsPage /></RequireAuth>} />
              <Route path="tournaments/:id" element={<RequireAuth><ShowdownPage /></RequireAuth>} />
              {/* No link leads here. The page itself answers "Access not allowed" to everyone but the admin. */}
              <Route path="admin" element={<TwoStepGate><AdminPage /></TwoStepGate>} />
              <Route path="join/:code" element={<RequireAuth><JoinPage /></RequireAuth>} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </MaintenanceGate>
        <Toaster />
      </BrowserRouter>
    </MotionConfig>
  );
}
