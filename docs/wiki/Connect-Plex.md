# Connect Plex

WebUI Settings signs in to Plex through an approval page (using a PIN behind the scenes). You never type your Plex password into nowplaying.

## Before you start

- Your Plex server is running and reachable from the PC running nowplaying.
- You can sign in at [plex.tv](https://www.plex.tv) with the account that watches the media you want to show.

## Steps

1. In **Settings > Media servers**, choose a discovered Plex server or open **Add a server by address** and choose **Plex**.
2. Enter your server address, for example `https://plex.example.com` or `http://192.168.1.20:32400`. Just the address, no extra paths.
3. Choose **Start sign-in**. A Plex sign-in page opens in a new tab. Sign in to Plex there and approve access using the account whose playback you want to show. NowPlaying waits for the approval in the Settings tab; it does not display a PIN to copy.
4. Return to Settings after approving Plex sign-in. Your connected Plex account appears in the server list.

Success looks like: Settings lists your Plex account.

## Common problems

- **The Plex page was closed or approval expired:** choose **Start sign-in** again to open a fresh sign-in page.
- **Sign-in fails with "unreachable":** check the address opens in a browser on the same PC.
- **Authentication failed:** use the Plex account that has access to the server when approving on the Plex page.

> Your Plex token is stored in Windows Credential Manager, not in the settings file.
