# Connect Emby

The setup page signs in to Emby with your username and password, and keeps the resulting access token.

## Before you start

- Your Emby server is running and reachable from the PC running nowplaying.
- You know the username and password of the Emby account whose watching you want to show.

## Steps

1. In setup, choose **Emby**.
2. Enter your server address, for example `https://emby.example.com` or `http://192.168.1.20:8096`.
3. Enter your Emby username and password and choose **Sign in**.
4. Run the connection test.

Success looks like: the test passes and setup shows your Emby username.

## Common problems

- **Authentication failed:** check the username and password by signing in to the Emby web interface.
- **Connection test fails with "unreachable":** check the address opens in a browser on the same PC.

> Your Emby access token is stored in Windows Credential Manager, not in the settings file, and your password is not kept.
