import { Logo } from '@/components/ui/Logo';

/** Shown when VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing at build time. */
export default function ConfigMissingPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16">
      <Logo />
      <div className="surface mt-8 p-6">
        <h1 className="font-display text-2xl font-bold text-ivory">Almost ready</h1>
        <p className="mt-3 text-sm leading-relaxed text-cream/85">
          All In can’t find its server settings. Copy <code className="text-gold-300">.env.example</code> to{' '}
          <code className="text-gold-300">.env</code> (or set the same variables on your host), then rebuild:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-ink-950 p-4 text-xs text-cream/90">
          VITE_SUPABASE_URL=…{'\n'}VITE_SUPABASE_PUBLISHABLE_KEY=…
        </pre>
      </div>
      <p className="mt-6 text-center text-sm text-gold-200">Free to play. No real money. No purchases. Chips have no cash value.</p>
    </div>
  );
}
