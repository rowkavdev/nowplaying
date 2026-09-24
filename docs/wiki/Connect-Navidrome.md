# Connect Navidrome

The setup page signs in to Navidrome with your username and password. nowplaying turns the password into a salted Subsonic API token and keeps only that token; it never stores your password and the token cannot sign in to the Navidrome web interface.

## Before you start

- Your Navidrome server is running and reachable from the PC running nowplaying.
- You know the username and password of the Navidrome account whose listening you want to show.

## Steps

1. In setup, choose **Navidrome**.
2. Enter your server address, for example `https://music.example.com` or `http://192.168.1.20:4533`.
3. Enter your Navidrome username and password and choose **Sign in**.
4. Run the connection test.

Success looks like: the test passes and setup shows your Navidrome username.

## Common problems

- **Authentication failed:** check the username and password by signing in to the Navidrome web interface.
- **Connection test fails with "unreachable":** check the address opens in a browser on the same PC.

> The salted token is stored in Windows Credential Manager, not in the settings file.
