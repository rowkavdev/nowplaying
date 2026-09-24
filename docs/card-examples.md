# Card examples

Every image below is generated from the shipped renderer by `node scripts/render-card-examples.js`, so what you see is exactly what the current build draws. A test fails if the renderer changes and these are not regenerated. Live cards also embed sanitized artwork from your media server on the left.

## Music

![Card showing NOW PLAYING with the track Holocene by Bon Iver and a progress bar, on a dark background](assets/cards/music-playing.svg)

## Music, paper theme

![The same music card in the light paper theme](assets/cards/music-light.svg)

## TV episode

![Card showing the series Lost as the title with the episode code S04E05 and episode title The Constant below](assets/cards/episode-playing.svg)

## Movie

![Card showing the film Spirited Away (2001) with a progress bar](assets/cards/movie-playing.svg)

## Paused

![Card in the paused state with a partially filled progress bar](assets/cards/paused.svg)

## Nothing playing

![Card in the idle state showing Nothing playing](assets/cards/idle.svg)

## Compact theme

![The music card in the compact theme, text only with no progress bar](assets/cards/compact.svg)

## Privacy: titles hidden

![Card showing Private media instead of a title, with progress only](assets/cards/privacy-redacted.svg)

The exact set shown depends on your privacy settings - with a media type hidden, anyone looking at the card sees the idle state instead.

## Discord Rich Presence

The same presence feeds Discord: music shows as **Listening**, films and episodes as **Watching**, and TV episodes use the series name with the episode code (for example "Lost" and "S04E05 · The Constant"). Word for word Discord examples live in the [wiki](https://github.com/rowkavdev/nowplaying/wiki/Enable-Discord-Rich-Presence).
