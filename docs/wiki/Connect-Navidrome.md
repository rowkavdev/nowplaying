# Connect Navidrome

WebUI Settings signs in to Navidrome with your username and password. nowplaying turns the password into a salted Subsonic API token and keeps only that token; it never stores your password and the token cannot sign in to the Navidrome web interface.

## Before you start

- Your Navidrome server is running and reachable from the PC running nowplaying.
- You know the username and password of the Navidrome account whose listening you want to show.

## Steps

1. In **Settings > Media servers**, choose a discovered Navidrome server or enter its address and choose **Navidrome**.
2. Enter your server address, for example `https://music.example.com` or `http://192.168.1.20:4533`.
3. Enter your Navidrome username and password and choose **Sign in**.
Success looks like: Settings lists your Navidrome account.

## Common problems

- **Authentication failed:** check the username and password by signing in to the Navidrome web interface.
- **Sign-in fails with "unreachable":** check the address opens in a browser on the same PC.

> The salted token is stored in Windows Credential Manager, not in the settings file.
