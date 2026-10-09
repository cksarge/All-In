import { Link } from 'react-router-dom';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { useUi } from '@/stores/uiStore';
import { NO_REAL_MONEY_FOOTER } from './NoRealMoneyNotice';

export function SiteFooter() {
  const openSettings = useUi((s) => s.openSettings);
  return (
    <footer className="mt-auto border-t border-white/[0.06] bg-ink-950/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <p className="flex items-center gap-2 text-sm font-medium text-gold-200">
          <ChipIcon className="h-4 w-4" color="gold" />
          {NO_REAL_MONEY_FOOTER}
        </p>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-muted">
          <Link to="/how-chips-work" className="hover:text-ivory">
            How chips work
          </Link>
          <button type="button" onClick={openSettings} className="hover:text-ivory">
            Settings
          </button>
          <span className="text-subtle">© {new Date().getFullYear()} All In</span>
        </nav>
      </div>
    </footer>
  );
}
