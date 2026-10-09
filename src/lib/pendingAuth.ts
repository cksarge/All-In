/**
 * Remembers which email is mid-verification / mid-reset so a page refresh
 * doesn't lose the flow. Stored in sessionStorage (this tab only).
 */
const KEY = 'allin-pending-auth';

export interface PendingAuth {
  email: string;
  kind: 'signup' | 'recovery';
  /** When the most recent code was sent (ms since epoch). */
  sentAt: number;
}

export function getPending(kind: PendingAuth['kind']): PendingAuth | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingAuth;
    return p.kind === kind ? p : null;
  } catch {
    return null;
  }
}

export function setPending(p: PendingAuth) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the flow still works for this page view */
  }
}

export function clearPending() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Supabase default "Email OTP Expiration" is 3600s. Keep in sync with SETUP.md. */
export const OTP_TTL_MS = 60 * 60 * 1000;
/** Supabase only allows one email per address every 60 seconds by default. */
export const RESEND_COOLDOWN_S = 60;
