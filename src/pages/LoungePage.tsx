import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BalanceCard } from '@/components/economy/BalanceCard';
import { DailyBonusCard } from '@/components/economy/DailyBonusCard';
import { RecentActivity } from '@/components/economy/RecentActivity';
import { RefillCard } from '@/components/economy/RefillCard';
import { GameGrid } from '@/components/lounge/GameGrid';
import { ReturnToTable } from '@/components/lounge/ReturnToTable';
import { ButtonLink } from '@/components/ui/Button';
import { WelcomeTour } from '@/components/onboarding/WelcomeTour';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { useAuth } from '@/stores/authStore';
import { useSettings } from '@/stores/settingsStore';
import { useWallet } from '@/stores/walletStore';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function LoungePage() {
  const { profile, profileLoading, profileError, loadProfile, markOnboarded } = useAuth();
  const walletError = useWallet((s) => s.error);
  const fetchStatus = useWallet((s) => s.fetchStatus);
  const { tourSeen, setTourSeen } = useSettings();
  const [params, setParams] = useSearchParams();
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    if (!profile) return;
    if (params.get('tour') === '1' || (!profile.onboarded_at && !tourSeen)) setTourOpen(true);
  }, [profile, tourSeen, params]);

  const finishTour = useCallback(() => {
    setTourOpen(false);
    setTourSeen(true);
    if (params.has('tour')) setParams({}, { replace: true });
    if (profile && !profile.onboarded_at) void markOnboarded();
  }, [markOnboarded, params, profile, setParams, setTourSeen]);

  if (!profile && profileLoading) return <FullPageLoader label="Opening the lounge…" />;
  if (!profile && profileError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="We couldn't load your profile" message={profileError} onRetry={() => void loadProfile()} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gold-400">{greeting()},</p>
          <h1 className="font-display text-3xl font-bold text-ivory sm:text-4xl">{profile?.username ?? '…'}</h1>
        </div>
        <ButtonLink to="/lobby" size="lg">
          Find a table
        </ButtonLink>
      </header>
      <ReturnToTable />

      {walletError && (
        <div className="surface mb-6">
          <ErrorState title="We couldn't load your chips" message={walletError} onRetry={() => void fetchStatus()} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <BalanceCard />
          <DailyBonusCard />
        </div>
        <div className="flex flex-col gap-5">
          <RefillCard />
          <RecentActivity />
        </div>
      </div>

      <GameGrid />
      <WelcomeTour open={tourOpen} onDone={finishTour} />
    </div>
  );
}
