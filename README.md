# Italian Web

A small mobile-friendly practice page for Italian listening.

Choose a passage from the playlist, then tap any timed line to jump to that stretch of audio. Use **Loop segment** to repeat it, or **Stop at end** to practice one phrase at a time.

## Add a passage

1. Put cleaned audio in `assets/` and an `.srt` transcript in `data/`.
2. Optionally add French line translations (`["…", …]` JSON) and/or useful expressions.
3. Register the passage in `data/playlist.json` (optional `tags` help filtering).

## Local

```bash
npx serve .
```

## GitHub Pages

Published from the `master` branch root.
