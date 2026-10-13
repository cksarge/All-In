import creditsFile from '../assets/music/CREDITS.txt?raw';

/**
 * Background music: every audio file in src/assets/music/ (see the README there). Vite finds them at build
 * time, so adding or removing music is just adding or removing files.
 *
 * Most tracks form the playlist, played in a random order on every screen. A track named in GAME_THEMES
 * is kept out of the playlist: it loops on that one game's screen instead.
 */
const files = import.meta.glob('../assets/music/*.{mp3,ogg,oga,opus,m4a,aac,wav,flac,webm}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** A game's own music: the game's key and the track's file name without its ending. */
const GAME_THEMES: Record<string, string> = {
  slots_haunted: 'Fearless First',
};

const nameOf = (path: string) => (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
const all = Object.keys(files)
  .sort()
  .map((path) => ({ name: nameOf(path), url: files[path] }));
const themed = new Set(Object.values(GAME_THEMES));

/** The tracks played everywhere, shuffled. */
export const PLAYLIST: string[] = all.filter((t) => !themed.has(t.name)).map((t) => t.url);

/** The track that loops on one game's screen, if that game has one (and its file is in the folder). */
export function gameTheme(gameKey: string | undefined): string | null {
  const name = gameKey ? GAME_THEMES[gameKey] : undefined;
  return (name && all.find((t) => t.name === name)?.url) || null;
}

/** Is there any music at all? */
export const HAS_MUSIC = all.length > 0;

/**
 * A fresh random order of the playlist (positions in PLAYLIST). `after` is the track that has just played:
 * it is never first, so a track does not play twice in a row when one round of the playlist ends.
 */
export function shuffledOrder(after: number | null): number[] {
  const order = PLAYLIST.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.length > 1 && order[0] === after) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

/** The credits file, without its instruction lines (those starting with #). Empty when nothing has been written. */
export const MUSIC_CREDITS = creditsFile
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')
  .trim();
