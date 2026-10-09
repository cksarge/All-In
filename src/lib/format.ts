const fmt = new Intl.NumberFormat('en-US');

/** Chips are always shown as plain numbers next to a chip icon. Never a currency symbol. */
export function formatChips(n: number | bigint | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return fmt.format(n);
}

export function formatChipsCompact(n: number): string {
  if (Math.abs(n) < 10_000) return fmt.format(n);
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatSigned(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt.format(Math.abs(n))}`;
}

/** 3h 05m · 4m 12s · 9s */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const shown = user.length <= 2 ? user[0] ?? '' : user.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(1, Math.min(6, user.length - shown.length)))}@${domain}`;
}
