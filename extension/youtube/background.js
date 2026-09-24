// Forwards the content script's playback events to the NowPlaying app on
// 127.0.0.1, with the pairing code saved on the options page. Nothing is sent
// until the extension is paired.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "nowplaying-youtube" || !sender.tab?.id) return;
  forward({ ...message.event, tabId: `t${sender.tab.id}` });
});

chrome.tabs?.onRemoved?.addListener((tabId) => forward({ tabId: `t${tabId}`, state: "stopped" }));

async function forward(event) {
  const { token, port } = await chrome.storage.local.get(["token", "port"]);
  if (!token) return;
  try {
    await fetch(`http://127.0.0.1:${Number(port) || 47832}/bridge/youtube`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(event),
    });
  } catch {
    // App not running: nothing to do, the next tick tries again.
  }
}
