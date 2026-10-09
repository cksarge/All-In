import { useEffect, useState } from 'react';

/** Re-renders every `ms` and returns Date.now() (+ an optional server clock offset). */
export function useNow(ms = 1000, offsetMs = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now + offsetMs;
}
