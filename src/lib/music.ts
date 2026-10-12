import creditsFile from '../assets/music/CREDITS.txt?raw';

/**
 * Background music: the one audio file in src/assets/music/ (see the README there), looped on every screen.
 * Vite finds it at build time, so changing the track is just swapping the file.
 */
const files = import.meta.glob('../assets/music/*.{mp3,ogg,oga,opus,m4a,aac,wav,flac,webm}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** The track's URL, or null when the folder has no audio file. With several files, the first by name is used. */
export const MUSIC_TRACK: string | null = Object.keys(files).sort().map((path) => files[path])[0] ?? null;

/** The credits file, without its instruction lines (those starting with #). Empty when nothing has been written. */
export const MUSIC_CREDITS = creditsFile
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')
  .trim();
