import { useSettings } from '@/stores/settingsStore';
import { playSound } from '@/lib/sound';

export function SoundToggle() {
  const { soundOn, toggleSound } = useSettings();
  return (
    <button
      type="button"
      onClick={() => {
        toggleSound();
        if (!soundOn) window.setTimeout(() => playSound('chip'), 0);
      }}
      aria-pressed={!soundOn}
      aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
      title={soundOn ? 'Mute sounds' : 'Unmute sounds'}
      className="flex h-10 w-10 items-center justify-center rounded-xl text-cream/80 transition hover:bg-white/[0.06] hover:text-ivory"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fillOpacity="0.15" />
        {soundOn ? (
          <>
            <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
            <path d="M18 6.7a7.5 7.5 0 0 1 0 10.6" />
          </>
        ) : (
          <path d="M16 9.5l5 5m0-5l-5 5" />
        )}
      </svg>
    </button>
  );
}
