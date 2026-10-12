# Music

The game has one piece of background music. It loops in the **lounge** and nowhere else: opening a game,
the lobby or any other page stops it, and coming back to the lounge carries on from where it stopped.

The track is the audio file in this folder (`Hard Boiled.mp3`). It is found automatically when the site is built.

## Changing the track

1. Replace the file in this folder with the new one. Keep **one** audio file here: if there are several, only the
   first by name is played.
2. Update `CREDITS.txt` with the new track's licence and credit (players can read it in Settings).
3. Commit and push. The new track is in the game once the site has deployed.

Delete the file to have no music at all (Settings then says so).

## What works

- **Formats:** `.mp3` is the safest (every browser plays it). `.ogg`, `.oga`, `.opus`, `.m4a`, `.aac`, `.wav`, `.flac`
  and `.webm` are picked up too, but not every browser plays every one.
- **Size:** about 3 to 6 MB is plenty (an MP3 at 128 to 160 kbps). It is downloaded only when it first plays.
- **Only music you are allowed to use.** The repository is public, so the file can be downloaded by anyone. Use a
  track whose licence allows that, and keep its attribution in `CREDITS.txt`.

## How it plays

- It loops for as long as you are in the lounge, and pauses while the tab is in the background.
- Browsers do not let a page start sound by itself, so if the lounge is the first page someone opens, the music
  begins with their first click or key press.
- Players switch it on or off, and set its volume, in Settings. It is separate from the sound effects.

The player is `src/components/layout/MusicPlayer.tsx`; the track is picked up in `src/lib/music.ts`.
