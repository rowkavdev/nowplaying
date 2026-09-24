# Connect Plex

The setup page signs in to Plex with a PIN approved on plex.tv. You never type your Plex password into nowplaying.

## Before you start

- Your Plex server is running and reachable from the PC running nowplaying.
- You can sign in at [plex.tv](https://www.plex.tv) with the account that watches the media you want to show.

## Steps

1. In setup, choose **Plex**.
2. Enter your server address, for example `https://plex.example.com` or `http://192.168.1.20:32400`. Just the address, no extra paths.
3. Choose **Sign in**. nowplaying shows a short PIN and a plex.tv link. Open the link and approve the PIN while signed in to your Plex account.
4. Back in setup, pick the Plex user whose watching you want to show, then run the connection test.

Success looks like: the test passes and setup shows your Plex username.

## Common problems

- **The PIN expires before you approve it:** start sign-in again to get a fresh PIN.
- **Connection test fails with "unreachable":** check the address opens in a browser on the same PC.
- **Authentication failed:** approve the PIN with the Plex account that has access to the server.

> Your Plex token is stored in Windows Credential Manager, not in the settings file.
