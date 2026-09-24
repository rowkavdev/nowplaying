# Connect YouTube

nowplaying can show what you're watching on YouTube or YouTube Music - on your card and in Discord. It works through a small browser extension that pairs with the app on your PC.

## What it shares

- Only the video that is playing in a tab. It never sends your history, searches or recommendations, and it talks only to the nowplaying app on your own PC.
- Shorts and ads are skipped.
- When YouTube and another source are both playing, the card shows whichever started most recently.

## 1. Install the extension

The extension isn't on the Chrome Web Store yet, so you load it once by hand:

1. Download or clone [rowkavdev/nowplaying-youtube](https://github.com/rowkavdev/nowplaying-youtube).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and pick the `extension` folder.

## 2. Pair it with the app

1. Open nowplaying's **Settings** page and find the **YouTube** section.
2. Choose **Show code** (or **Copy code**) and note the **port** shown next to it.
3. Open the extension's options page, paste the pairing code and the port, and **Save**.
4. Play a video - it shows on your card and in Discord.

To unlink, choose **Make a new code** in settings. The old code stops working straight away and the extension stays quiet until you paste the new one.

## Common problems

- **No YouTube section in settings:** the bridge is off in safe mode; start nowplaying normally.
- **Paired but nothing shows:** check the code and port in the extension's options match the settings page, and that you're not watching a Short.
- **It stopped after you made a new code:** paste the new code into the extension's options.
