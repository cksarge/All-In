import { useEffect, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { MUSIC_TRACK } from '@/lib/music';
import { useSettings } from '@/stores/settingsStore';

/** The music button in the top bar: a click opens a small panel with the switch and the volume. */
export function MusicControl() {
  const { musicOn, setMusicOn, musicVolume, setMusicVolume } = useSettings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!MUSIC_TRACK) return null;
  return (
    // The top bar has no room for it on a narrow phone: there the switch is in Settings.
    <div ref={box} className="relative hidden min-[430px]:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={musicOn ? 'Music: on' : 'Music: off'}
        title="Music"
        className="flex h-10 w-9 items-center justify-center rounded-xl text-cream/80 transition hover:bg-white/[0.06] hover:text-ivory sm:w-10"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" fill="currentColor" fillOpacity="0.15" />
          <circle cx="16.5" cy="16" r="2.5" fill="currentColor" fillOpacity="0.15" />
          {!musicOn && <path d="M4 4l16 16" />}
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Music" className="surface absolute right-0 top-11 z-40 w-60 border-white/10 bg-ink-800 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-cream" id="music-mini-label">
              Music
            </p>
            <button
              role="switch"
              aria-checked={musicOn}
              aria-labelledby="music-mini-label"
              onClick={() => setMusicOn(!musicOn)}
              className={cn('relative h-7 w-12 shrink-0 rounded-full border transition', musicOn ? 'border-gold-500 bg-gold-500' : 'border-white/20 bg-ink-950')}
            >
              <span className={cn('absolute top-0.5 h-5.5 w-5.5 rounded-full bg-ivory shadow transition-all', musicOn ? 'left-[calc(100%-1.5rem)]' : 'left-0.5')} />
            </button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-muted">
            <span className="shrink-0">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={musicVolume}
              disabled={!musicOn}
              onChange={(e) => setMusicVolume(Number(e.target.value))}
              className="h-2 min-w-0 flex-1 accent-gold-500 disabled:opacity-40"
            />
            <span className="w-8 shrink-0 text-right tabular-nums">{musicVolume}%</span>
          </label>
        </div>
      )}
    </div>
  );
}
