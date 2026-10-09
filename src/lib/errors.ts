import { isAuthError, isAuthWeakPasswordError } from '@supabase/supabase-js';

export type ErrorContext = 'signup' | 'login' | 'verify' | 'resend' | 'reset' | 'update_password' | 'rpc';

interface ErrorLike {
  message?: string;
  code?: string;
  status?: number;
  hint?: string;
  name?: string;
}

/** Seconds to wait, parsed from "For security purposes, you can only request this after 42 seconds." */
export function retryAfterSeconds(error: unknown): number | null {
  const msg = (error as ErrorLike | null)?.message ?? '';
  const m = msg.match(/after (\d+) seconds?/i);
  return m ? Number(m[1]) : null;
}

function isNetworkError(e: ErrorLike): boolean {
  return (
    e.name === 'AuthRetryableFetchError' ||
    e.status === 0 ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(e.message ?? '')
  );
}

const RPC_MESSAGES: Record<string, string> = {
  not_authenticated: 'Your session has ended. Please log in again.',
  wallet_not_found: "We couldn't find your chip wallet. Try refreshing the page.",
  insufficient_chips: "You don't have enough play chips for that.",
  daily_already_claimed: "You've already collected today's bonus. It resets at 00:00 UTC.",
  refill_not_needed: 'Refills unlock when your chips run low.',
  refill_on_cooldown: 'Your next free refill is still on cooldown.',
  tier_locked: "You need more play chips to sit at that stake level.",
  bet_out_of_range: "That bet is outside this table's limits.",
  unknown_stake_tier: "That stake level doesn't exist.",
  invalid_amount: "That amount isn't valid.",
};

/**
 * Turns any Supabase/auth/RPC/network error into a short, friendly sentence.
 * Never shows raw server text to players.
 */
export function friendlyError(error: unknown, context: ErrorContext = 'rpc'): string {
  if (!error) return 'Something went wrong. Please try again.';
  const e = error as ErrorLike;
  const code = e.code ?? '';
  const msg = e.message ?? '';

  if (isNetworkError(e)) {
    return "Can't reach the All In servers. Check your connection and try again.";
  }

  if (isAuthWeakPasswordError(error)) {
    if (error.reasons?.includes('pwned')) {
      return 'That password has appeared in a known data breach. Please choose a different one.';
    }
    return "That password doesn't meet the requirements: 8+ characters with a lowercase letter, an uppercase letter and a number.";
  }

  if (isAuthError(error) || e.status !== undefined) {
    switch (code) {
      case 'invalid_credentials':
        return "That email and password don't match. Check for typos, or reset your password.";
      case 'email_not_confirmed':
        return 'Please verify your email first. We just sent you a new 6-digit code.';
      case 'user_already_exists':
      case 'email_exists':
        return 'An account with this email already exists. Try logging in instead.';
      case 'otp_expired':
        return 'That code is incorrect or has expired. Check the digits, or request a new code.';
      case 'captcha_failed':
        return 'The security check failed or expired. Please try again.';
      case 'otp_disabled':
        return 'Email codes are turned off for this project. (Admin: check SETUP.md.)';
      case 'over_email_send_rate_limit': {
        const s = retryAfterSeconds(error);
        return s
          ? `Please wait ${s} seconds before requesting another email.`
          : 'Too many emails have been sent. Please wait a little while before trying again.';
      }
      case 'over_request_rate_limit':
        return 'Too many attempts. Please wait a minute, then try again.';
      case 'same_password':
        return 'Your new password must be different from your current one.';
      case 'email_address_invalid':
        return 'Please enter a valid email address.';
      case 'email_address_not_authorized':
        return "We can't send email to that address yet. (Admin: set up custom SMTP, see SETUP.md.)";
      case 'signup_disabled':
        return 'New sign-ups are paused right now. Please try again later.';
      case 'user_not_found':
        return context === 'verify' || context === 'reset'
          ? "We couldn't find a pending request for that email. Start again or request a new code."
          : "We couldn't find an account with that email.";
      case 'session_not_found':
      case 'refresh_token_not_found':
      case 'bad_jwt':
        return 'Your session has ended. Please log in again.';
      case 'validation_failed':
        return 'Please check the details you entered and try again.';
      case 'unexpected_failure':
        if (context === 'signup') return 'That username was just taken. Please choose another.';
        break;
    }
    if (/captcha/i.test(msg)) return 'The security check failed or expired. Please try again.';
    if (e.status === 429) return 'Too many attempts. Please wait a minute, then try again.';
    if (/database error saving new user/i.test(msg)) {
      return 'That username was just taken. Please choose another.';
    }
    if (/token has expired or is invalid/i.test(msg)) {
      return 'That code is incorrect or has expired. Check the digits, or request a new code.';
    }
  }

  // Postgres RPC errors: our functions raise snake_case codes as the message.
  if (RPC_MESSAGES[msg]) return RPC_MESSAGES[msg];
  if (code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01') {
    return 'The game server is missing its database setup. (Admin: run the SQL files in supabase/sql.)';
  }

  switch (context) {
    case 'signup':
      return "We couldn't create your account. Please try again.";
    case 'login':
      return "We couldn't log you in. Please try again.";
    case 'verify':
      return "We couldn't verify that code. Please try again.";
    case 'resend':
      return "We couldn't send a new code. Please try again shortly.";
    case 'reset':
      return "We couldn't start the password reset. Please try again.";
    case 'update_password':
      return "We couldn't update your password. Please try again.";
    default:
      return 'Something went wrong. Please try again.';
  }
}
