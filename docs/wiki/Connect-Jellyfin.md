# Connect Jellyfin

The setup page signs in to Jellyfin with Quick Connect: nowplaying shows a code, and you approve it in your Jellyfin apps.

## Before you start

- Your Jellyfin server is running and reachable from the PC running nowplaying.
- Quick Connect is enabled on the server: Jellyfin dashboard, **Playback > Quick Connect**, tick **Enable Quick Connect on this server**.

## Steps

1. In setup, choose **Jellyfin**.
2. Enter your server address, for example `https://jellyfin.example.com` or `http://192.168.1.20:8096`.
3. Choose **Sign in**. nowplaying shows a Quick Connect code.
4. In any Jellyfin app where you're signed in (web, TV, phone), open **Quick Connect** in the user menu and enter the code.
5. Back in setup, pick the Jellyfin user to follow, then run the connection test.

Success looks like: the test passes and setup shows your Jellyfin username.

## Common problems

- **"Quick Connect is disabled":** enable it on the server (see above) and sign in again.
- **The code expires:** start sign-in again for a fresh code.
- **Connection test fails with "unreachable":** check the address opens in a browser on the same PC.

> Your Jellyfin access token is stored in Windows Credential Manager, not in the settings file.
