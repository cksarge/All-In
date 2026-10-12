# Music

Put the game's background music in this folder. That is all you have to do: every audio file here is found
automatically when the site is built, and the game plays them in a random order, one after another, on every screen.

## Adding a track

1. Copy the file into this folder (`src/assets/music/`).
2. Add its licence and credit to `CREDITS.txt` (players can read it in Settings).
3. Commit and push. The track is in the game once the site has deployed.

To remove a track, delete the file and its lines in `CREDITS.txt`.

## What works

- **Formats:** `.mp3` is the safest (every browser plays it). `.ogg`, `.oga`, `.opus`, `.m4a`, `.aac`, `.wav`, `.flac`
  and `.webm` are picked up too, but not every browser plays every one; a track a browser can't play is skipped.
- **File names** become nothing the player sees, so name them however you like. Avoid `#` and `?` in names.
- **Size:** keep each track small, about 3 to 6 MB (an MP3 at 128 to 160 kbps is plenty for background music).
  Players download a track when it starts playing, not before, so the number of tracks does not slow the site down,
  but GitHub refuses single files over 100 MB and the whole site should stay well under 1 GB.
- **Only music you are allowed to use.** The repository is public, so anything here can be downloaded by anyone.
  Use tracks whose licence allows that (your own, public domain, or Creative Commons and similar), and keep each
  licence's attribution in `CREDITS.txt`.

## How it plays

- All tracks are shuffled into a random order and played through; then they are shuffled again (never starting
  with the track that just finished), and so on. With three tracks you might hear 1-3-2 and then 2-1-3.
- Music carries on as you move between screens. It pauses while the tab is in the background.
- Browsers do not let a page start sound by itself, so the music begins with the visitor's first click or key press.
- Players switch it on or off, and set its volume, in Settings. It is separate from the sound effects.
- With no files in this folder there is simply no music, and Settings says so.

The player is `src/components/layout/MusicPlayer.tsx`; the list of tracks is built in `src/lib/music.ts`.
