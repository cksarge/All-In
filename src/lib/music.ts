import creditsFile from '../assets/music/CREDITS.txt?raw';

/**
 * Background music: every audio file in src/assets/music/ (see the README there).
 * Vite finds them at build time, so adding a track is just adding a file.
 */
const files = import.meta.glob('../assets/music/*.{mp3,ogg,oga,opus,m4a,aac,wav,flac,webm}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const TRACKS: string[] = Object.keys(files)
  .sort()
  .map((path) => files[path]);

/** The credits file, without its instruction lines (those starting with #). Empty when nothing has been written. */
export const MUSIC_CREDITS = creditsFile
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')
  .trim();

/**
 * A fresh random order of `n` tracks (Fisher-Yates), not starting with `last`
 * so the same track never plays twice in a row across two rounds.
 */
export function shuffledOrder(n: number, last: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (n > 1 && order[0] === last) {
    const swap = 1 + Math.floor(Math.random() * (n - 1));
    [order[0], order[swap]] = [order[swap], order[0]];
  }
  return order;
}
