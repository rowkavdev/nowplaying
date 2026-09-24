# Privacy and safe configuration

Now-playing data can reveal what you watch and listen to, and when. Treat it as personal data.

## Privacy controls

In **Settings > Privacy** you can:

- **Hide titles** - Discord and the card show "Private media" instead of the show or track name.
- **Hide album art** - Discord shows the NowPlaying icon instead of the cover.
- **Hide progress and timer** - no progress bar on the card, no timer on Discord.
- **Hide a whole media type** - for example never show TV episodes. Playing a hidden type looks exactly like nothing playing.

Privacy is applied before anything is formatted or sent, so hidden data can't leak through a theme or template.

## Where your sign-ins live

Provider sign-ins and the hosted-card device key live in **Windows Credential Manager**. The settings file (`%LOCALAPPDATA%\nowplaying\config.json`) holds no passwords or tokens, so it's safe to copy when asking for help.

## The card never exposes your server

- Your media server's address, username and artwork never leave your PC. The hosted card receives only the fields your card shows, and with privacy on it only ever receives "nothing playing".
- Your card link uses a random ID that can't be traced to your account.
- Never put tokens in a card URL or post a card URL with extra query strings in public.

## If a token ever leaks

Rotate it in the media server's settings, then sign in again in nowplaying. Tokens seen in logs, screenshots or issues should be treated as leaked.
