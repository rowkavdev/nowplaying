# Connect Spotify

nowplaying can show what you're playing on Spotify (music and podcasts) alongside or instead of a self-hosted server. Sign-in uses Spotify's own page; nowplaying never sees your Spotify password.

> Spotify is a **planned** provider rolling out in the next development builds. This page is ready ahead of the setup option landing.

## Before you start

Spotify asks each nowplaying user to register their own "app" (free, takes two minutes). You need:

- A Spotify account. **The account that creates the app needs Premium.**
- Up to 5 people can use one app while it's in development mode - fine for personal use.

## 1. Create your Spotify app

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and sign in.
2. Choose **Create app**. Any name and description works, for example "nowplaying".
3. Set the **Redirect URI** to exactly:

   ```
   http://127.0.0.1/spotify/callback
   ```

   Spotify refuses `localhost` here; it must be `127.0.0.1`.
4. Save, then copy the app's **Client ID** (a 32-character string of letters and numbers).

## 2. Sign in from setup

1. In setup, choose **Spotify**.
2. Paste your **Client ID** and choose **Sign in with Spotify**.
3. Spotify opens in your browser. Approve the access request.
4. You're returned to setup automatically. Run the connection test.

Success looks like: the test passes and setup shows your Spotify account. Play music or a podcast in any Spotify app and it shows up.

## What nowplaying can see

- The permission is read-only: what's playing right now, nothing else. nowplaying can't control playback, see your library or change anything.
- Podcast episodes show as Listening with the show name.
- Spotify doesn't report TV or movies, and a private session counts as nothing playing.

## Common problems

- **Sign-in loops or fails after approving:** check the redirect URI in your Spotify app is exactly `http://127.0.0.1/spotify/callback`.
- **"Client ID should be the 32-character ID":** copy the Client ID again from the app's settings page; it's the ID, not the secret.
- **Nothing shows:** make sure the Spotify account playing the music is the same one that approved the app, and the session isn't private.

> Your Spotify sign-in is stored in Windows Credential Manager, not in the settings file. Revoking access in your Spotify account settings stops nowplaying immediately.
