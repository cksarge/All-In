import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usernameProblem } from '@/lib/validation';

export type UsernameStatus = 'idle' | 'checking' | 'ok' | 'taken' | 'reserved' | 'invalid' | 'unknown';

/** Live username availability via the check_username RPC, debounced. */
export function useUsernameCheck(username: string): UsernameStatus {
  const [status, setStatus] = useState<UsernameStatus>('idle');

  useEffect(() => {
    if (!username) {
      setStatus('idle');
      return;
    }
    if (usernameProblem(username)) {
      setStatus('invalid');
      return;
    }
    setStatus('checking');
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc('check_username', { p_username: username });
      if (cancelled) return;
      if (error) setStatus('unknown');
      else setStatus((data as UsernameStatus) ?? 'unknown');
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [username]);

  return status;
}
