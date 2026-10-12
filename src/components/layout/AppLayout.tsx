import { Outlet, useLocation } from 'react-router-dom';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useAccount } from '@/stores/accountStore';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function AppLayout() {
  const { pathname } = useLocation();
  const notice = useAccount((s) => s.account?.notice);
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      {notice && (
        <p role="status" className="border-b border-gold-500/30 bg-gold-500/15 px-4 py-2 text-center text-sm font-medium text-gold-100">
          {notice}
        </p>
      )}
      <main id="main" className="flex-1" tabIndex={-1}>
        {/* Each page fades in (see .page-in; off with reduced motion). */}
        <div key={pathname} className="page-in">
          <Outlet />
        </div>
      </main>
      <SiteFooter />
      <SettingsModal />
    </div>
  );
}
