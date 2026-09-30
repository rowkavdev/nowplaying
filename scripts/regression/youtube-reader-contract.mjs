// node scripts/regression/youtube-reader-contract.mjs /path/to/nowplaying-youtube/extension/reader.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createYouTubeBridge } from '../../src/youtube-bridge.js';
const context = { URL };
vm.runInNewContext(readFileSync(process.argv[2], 'utf8'), context);
const token = 't'.repeat(40);
const bridge = createYouTubeBridge({ token });
for (const host of ['i9.ytimg.com', 'yt4.ggpht.com', 'i.ytimg.com']) {
  const event = context.NowPlayingReader.readPlayback({ querySelector(selector) {
    return selector.includes('video') ? { currentTime: 5, duration: 200, paused: false, ended: false } : null;
  } }, new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { metadata: {
    title: 'A video', artist: 'A channel', artwork: [{ src: `https://${host}/vi/dQw4w9WgXcQ/hqdefault.jpg`, sizes: '1280x720' }],
  } });
  assert.equal(event.thumbnail.includes(host), true);
  assert.equal(bridge.receive({ method: 'POST', headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', authorization: `Bearer ${token}` }, body: { ...event, tabId: 'tab1' } }).status, 204);
  const presence = await bridge.provider.getPresence();
  assert.equal(presence.title, 'A video');
  assert.equal(presence.artworkUrl, host === 'i.ytimg.com' ? event.thumbnail : null);
}
console.log('reader -> bridge: all three hosts preserve playback; only allowed artwork is retained');
