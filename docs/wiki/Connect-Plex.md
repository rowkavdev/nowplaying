# Connect Plex

WebUI Settings signs in to Plex with a PIN approved on plex.tv. You never type your Plex password into nowplaying.

## Before you start

- Your Plex server is running and reachable from the PC running nowplaying.
- You can sign in at [plex.tv](https://www.plex.tv) with the account that watches the media you want to show.

## Steps

1. In **Settings > Media servers**, choose a discovered Plex server or open **Add a server by address** and choose **Plex**.
2. Enter your server address, for example `https://plex.example.com` or `http://192.168.1.20:32400`. Just the address, no extra paths.
3. Choose **Sign in**. nowplaying shows a short PIN and a plex.tv link. Open the link and approve the PIN while signed in to your Plex account.
4. Return to Settings after approving Plex sign-in. Your connected Plex account appears in the server list.

Success looks like: Settings lists your Plex account.

## Common problems

- **The PIN expires before you approve it:** start sign-in again to get a fresh PIN.
- **Sign-in fails with "unreachable":** check the address opens in a browser on the same PC.
- **Authentication failed:** approve the PIN with the Plex account that has access to the server.

> Your Plex token is stored in Windows Credential Manager, not in the settings file.
