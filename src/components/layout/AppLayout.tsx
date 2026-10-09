import { Outlet } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
