import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

/** False when .env is missing. The app shows a setup screen instead of crashing. */
export const supabaseConfigured = Boolean(url && publishableKey);

// Only the PUBLISHABLE key ever ships to the browser. The service role key
// must never appear in front-end code or env files.
if (publishableKey && /service_role|^sb_secret_/i.test(publishableKey)) {
  throw new Error('Refusing to start: a secret/service key was provided. Use the publishable key.');
}

export const supabase = createClient(url || 'http://localhost:54321', publishableKey || 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // We use 6-digit codes, never magic links, so there is nothing to parse from the URL.
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
