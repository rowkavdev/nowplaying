// Reads the active YouTube / YouTube Music player (#136). Every page-specific
// selector lives in this file, so a YouTube layout change is a one-file fix.
// It only ever reads the player that is on the page right now: no history,
// searches, recommendations or other tabs.
(function (root) {
  const SELECTORS = {
    video: "video.html5-main-video, video",
    player: "#movie_player",
    adClass: "ad-showing",
    liveBadge: ".ytp-live-badge",
  };

  function videoIdFrom(location) {
    const url = new URL(location.href);
    const v = url.searchParams.get("v");
    return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
  }

  function largestArtwork(metadata) {
    const list = Array.isArray(metadata?.artwork) ? [...metadata.artwork] : [];
    const size = (item) => Number(String(item.sizes || "0x0").split("x")[0]) || 0;
    list.sort((a, b) => size(b) - size(a));
    return list.find((item) => typeof item.src === "string" && item.src.startsWith("https://"))?.src ?? null;
  }

  // Returns the event to send, or null when there's nothing to report.
  function readPlayback(doc, location, mediaSession) {
    if (location.pathname.startsWith("/shorts/")) return { skip: "shorts" };
    const video = doc.querySelector(SELECTORS.video);
    const videoId = videoIdFrom(location);
    if (!video || !videoId) return null;
    const player = doc.querySelector(SELECTORS.player);
    if (player?.classList?.contains(SELECTORS.adClass)) return { skip: "ad" };
    const metadata = mediaSession?.metadata ?? null;
    const title = (metadata?.title || "").trim();
    if (!title) return null;
    const live = Boolean(doc.querySelector(SELECTORS.liveBadge)?.offsetParent) || !Number.isFinite(video.duration);
    return {
      videoId,
      title: title.slice(0, 300),
      channel: (metadata?.artist || "").trim().slice(0, 200) || null,
      thumbnail: largestArtwork(metadata),
      positionMs: live ? null : Math.round(video.currentTime * 1000),
      durationMs: live ? null : Math.round(video.duration * 1000),
      state: video.paused || video.ended ? "paused" : "playing",
      live,
      music: location.hostname === "music.youtube.com",
    };
  }

  root.NowPlayingReader = { readPlayback, SELECTORS };
})(globalThis);
