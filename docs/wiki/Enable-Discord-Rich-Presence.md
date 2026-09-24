# Enable Discord Rich Presence

Discord Rich Presence puts "Listening to" or "Watching" with your current media on your Discord profile. It runs entirely on your PC: nowplaying talks to the Discord desktop app directly, and nothing about your media goes to any server.

## Before you start

- The **Discord desktop app** is installed and open. Rich Presence doesn't work with Discord in a browser tab.
- nowplaying is set up with a media server (see the [Quick start](Quick-Start)).

## Steps

1. In setup (or later in **Settings > Discord**), turn on Discord.
2. Pick what happens when nothing is playing: clear the status, clear it after a short wait, show "Nothing playing", or keep the last item.
3. Use the preview to check how your status will look before saving.

Success looks like: play something, and your Discord profile shows it within a few seconds.

## What it shows

- Music shows as **Listening**, films and TV episodes as **Watching**.
- TV episodes show the series name and episode code by default, for example "Lost" and "S04E05 · The Constant".
- Timestamps, idle behaviour and album art lookup can be changed in Settings > Discord. Buttons, wording and update speed can't be changed yet.

## Common problems

- **Nothing shows in Discord:** make sure the desktop app is open, then check Discord settings, **Activity Privacy**, that activity status sharing is on.
- **It stopped after you restarted Discord:** it should come back on its own within a few seconds; nowplaying reconnects automatically.
- **A stuck track won't clear:** nowplaying clears sessions that sit at the same position too long; quitting and reopening Discord also forces a refresh.

More fixes: [Troubleshooting](Troubleshooting).
