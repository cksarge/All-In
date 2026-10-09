import { cn } from './cn';

type IconKind = 'cards' | 'spade' | 'wheel' | 'dice' | 'seven' | 'grid' | 'diamond';

export function iconForGame(key: string): IconKind {
  if (key.startsWith('poker_') || key === 'three_card_poker' || key === 'pai_gow_poker') return 'spade';
  if (key === 'blackjack' || key === 'baccarat' || key.startsWith('video_poker')) return 'cards';
  if (key === 'roulette' || key === 'money_wheel') return 'wheel';
  if (key === 'craps' || key === 'sic_bo') return 'dice';
  if (key === 'keno') return 'grid';
  if (key === 'slots_cascade' || key === 'slots_holdwin') return 'diamond';
  return 'seven';
}

export function GameIcon({ gameKey, className }: { gameKey: string; className?: string }) {
  const kind = iconForGame(gameKey);
  return (
    <svg viewBox="0 0 48 48" className={cn('h-10 w-10', className)} aria-hidden="true" fill="none">
      {kind === 'cards' && (
        <>
          <rect x="9" y="9" width="20" height="28" rx="3" transform="rotate(-12 19 23)" fill="#f4ead2" stroke="#d4af37" strokeWidth="1.2" />
          <rect x="18" y="10" width="20" height="28" rx="3" transform="rotate(10 28 24)" fill="#fffaf0" stroke="#d4af37" strokeWidth="1.2" />
          <path d="M28.6 18.5c-2.4 2.8-5 4.2-5 6.7a2.6 2.6 0 0 0 5 1.2 2.6 2.6 0 0 0 5-1.2c0-2.5-2.6-3.9-5-6.7z" fill="#a81c2c" transform="rotate(10 28 24)" />
        </>
      )}
      {kind === 'spade' && (
        <path d="M24 7c-6 7.5-13 11.3-13 18a6.6 6.6 0 0 0 11.4 4.5L20 39h8l-2.4-9.5A6.6 6.6 0 0 0 37 25c0-6.7-7-10.5-13-18z" fill="#f4ead2" stroke="#d4af37" strokeWidth="1.4" strokeLinejoin="round" />
      )}
      {kind === 'wheel' && (
        <>
          <circle cx="24" cy="24" r="17" fill="#3d0910" stroke="#d4af37" strokeWidth="2" />
          {Array.from({ length: 12 }).map((_, i) => (
            <path
              key={i}
              d="M24 24 L24 8.5 A15.5 15.5 0 0 1 31.75 10.58 Z"
              fill={i % 2 ? '#a81c2c' : '#0b0d0c'}
              transform={`rotate(${i * 30} 24 24)`}
            />
          ))}
          <circle cx="24" cy="24" r="6" fill="#d4af37" />
          <circle cx="24" cy="24" r="2.2" fill="#5f4812" />
        </>
      )}
      {kind === 'dice' && (
        <>
          <rect x="7" y="13" width="20" height="20" rx="4" transform="rotate(-10 17 23)" fill="#f4ead2" stroke="#d4af37" strokeWidth="1.2" />
          <rect x="21" y="16" width="20" height="20" rx="4" transform="rotate(12 31 26)" fill="#a81c2c" stroke="#d4af37" strokeWidth="1.2" />
          <circle cx="13" cy="19" r="1.8" fill="#0b0d0c" />
          <circle cx="17" cy="23" r="1.8" fill="#0b0d0c" />
          <circle cx="21" cy="27" r="1.8" fill="#0b0d0c" />
          <circle cx="27" cy="22" r="1.8" fill="#f4ead2" />
          <circle cx="35" cy="24" r="1.8" fill="#f4ead2" />
          <circle cx="26" cy="30" r="1.8" fill="#f4ead2" />
          <circle cx="34" cy="32" r="1.8" fill="#f4ead2" />
        </>
      )}
      {kind === 'seven' && (
        <>
          <rect x="6" y="8" width="36" height="32" rx="6" fill="#0b0d0c" stroke="#d4af37" strokeWidth="1.6" />
          <path d="M15 16h18l-9 17" stroke="#c9303f" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === 'diamond' && (
        <>
          <path d="M12 18l6-8h12l6 8-12 20z" fill="#3566c4" stroke="#8fb0f0" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M12 18h24M18 10l6 8 6-8M24 18v20" stroke="#8fb0f0" strokeWidth="1" />
        </>
      )}
      {kind === 'grid' && (
        <>
          {Array.from({ length: 16 }).map((_, i) => (
            <circle
              key={i}
              cx={12 + (i % 4) * 8}
              cy={12 + Math.floor(i / 4) * 8}
              r="3.2"
              fill={[1, 6, 11, 13].includes(i) ? '#d4af37' : '#262c29'}
              stroke="#5b645f"
              strokeWidth="0.6"
            />
          ))}
        </>
      )}
    </svg>
  );
}
