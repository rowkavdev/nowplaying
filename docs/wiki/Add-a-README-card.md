# Add a README card

The hosted card puts your now-playing on a GitHub README without opening your media server to the internet. The app on your PC pushes a small update to the card service; the service never connects back to you.

It's off until you turn it on.

## Steps

1. Open the nowplaying **Settings** page (tray icon, **Settings**) and find the **hosted card** section.
2. Turn it on. You get a per-PC card link with a random ID that can't be traced to you, plus a ready-made Markdown snippet. Want one card shared by all your PCs? Sign in with GitHub in **Settings > Spotify and hosted card** - see below.
3. Paste the snippet into your README, for example:

   ```markdown
   ![Now playing](https://nowplaying-hosted.vercel.app/u/your-github-username.svg)
   ```

4. Play something on your media server. Your card updates within a few seconds.

Success looks like: the card image on your README shows what's playing.

## One card for all your PCs (optional GitHub sign-in)

By default each PC gets its own card link with a random ID. If you have more than one PC, sign in to share one card:

1. Open **Settings > Spotify and hosted card** from the tray, check the card service address, and choose **Sign in with GitHub**.
2. Open the GitHub link shown and enter the code. GitHub only tells nowplaying your username - no other permissions.
3. Your card link becomes `https://nowplaying-hosted.vercel.app/u/<your-username>.svg`. Sign in on each PC; whichever is playing updates the card.

**Settings > Hosted card devices** lists the PCs signed in as you. You can rename one, sign one out, or **Sign out everywhere** (the card stops updating until you sign in again).

## What the card shows

- Music shows as "Listening", films and TV episodes as "Watching".
- Paused, idle and offline each have their own look.
- Themes, width and which fields to show are options on the card link; secrets never go in the URL.

## Privacy

You choose what the card can ever receive. With a media type hidden or privacy set to private, the card only ever gets "nothing playing". Your server address, username and artwork never leave your PC. Full detail: [Privacy and safe configuration](Privacy-and-safe-configuration) and [what leaves your PC](https://github.com/rowkavdev/nowplaying/blob/main/docs/hosted-upload.md).

## If the README looks stale

GitHub fetches README images through its own cache, so a fresh card can take a while to appear there even when the origin has updated. Open your card link directly: if it's fresh there, the card service is fine and you just need to wait.

Stop playing or close the app and the card goes back to "Not playing" within about ten minutes.

## Turning it off

**Disconnect** in the hosted card section deletes this PC's state and device key on the service and on your PC. With GitHub sign-in your other PCs keep updating the card; without it, the card link stops showing anything.
