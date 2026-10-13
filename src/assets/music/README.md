# Music

Every audio file in this folder is part of the game's music. It is all found automatically when the site is built.

- **The playlist:** the tracks play in a random order on every screen, each one once before any repeats, and the
  music carries on without a break as you move between screens.
- **A game's own theme:** a track can belong to one game instead. It is then left out of the playlist and loops for
  as long as that game is open. Today `Fearless First` is the theme of the Haunted Manor slot machine.

## Adding or removing music

1. Put the audio file in this folder (or delete one).
2. Add its licence and credit to `CREDITS.txt` (players can read it in Settings).
3. Commit and push. The change is in the game once the site has deployed.

To give a game its own theme, add a line to `GAME_THEMES` in `src/lib/music.ts`: the game's key and the file's name
without its ending, for example `slots_haunted: 'Fearless First'`.

With no audio files here there is no music at all (Settings then says so).

## What works

- **Formats:** `.mp3` is the safest (every browser plays it). `.ogg`, `.oga`, `.opus`, `.m4a`, `.aac`, `.wav`, `.flac`
  and `.webm` are picked up too, but not every browser plays every one.
- **Size:** about 3 to 6 MB a track is plenty (an MP3 at 128 to 160 kbps). A track is downloaded only when it is
  about to play.
- **Only music you are allowed to use.** The repository is public, so the files can be downloaded by anyone. Use
  tracks whose licence allows that, and keep their attribution in `CREDITS.txt`.

## How it plays

- It pauses while the tab is in the background.
- Browsers do not let a page start sound by itself, so the music begins with the visitor's first click or key press.
- Players switch it on or off, and set its volume, in Settings or from the music button in the top bar. It is
  separate from the sound effects.

The player is `src/components/layout/MusicPlayer.tsx`; the files are picked up in `src/lib/music.ts`.
