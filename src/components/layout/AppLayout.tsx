import { Outlet, useLocation } from 'react-router-dom';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function AppLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
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
