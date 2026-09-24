// Picks which device's state a user's card shows (#140, one card per GitHub
// user, many PCs). Pure: the service passes every device's live state.
//
// 1. Playing beats paused; paused beats nothing. Expired states never arrive
//    here (they have a TTL in Redis).
// 2. Several playing: the one that started playing most recently wins.
//    startedAt only moves when a device goes into "playing", never on a
//    heartbeat or track change, so two PCs playing at once don't flip-flop.
// 3. Paused never replaces a device that is playing; among paused devices
//    the most recently heard from wins.
// All times are the server's (startedAt, receivedAt), never the PC's clock.
export function resolveDeviceStates(entries) {
  const live = entries.filter((e) => e && (e.state === "playing" || e.state === "paused"));
  if (!live.length) return null;
  const playing = live.filter((e) => e.state === "playing");
  const pool = playing.length ? playing : live;
  const key = playing.length ? (e) => e.startedAt ?? e.receivedAt ?? 0 : (e) => e.receivedAt ?? 0;
  return [...pool].sort((a, b) => key(b) - key(a) || (b.receivedAt ?? 0) - (a.receivedAt ?? 0) || String(a.deviceId).localeCompare(String(b.deviceId)))[0];
}

// Progress bar position now. The PC's observedAt only adjusts for the
// upload's travel time, clamped to 0-5s, so a PC clock that is fast or slow
// by minutes can't push progress out of range.
export const MAX_UPLOAD_LAG_MS = 5_000;
export function currentPosition(stored, now) {
  if (stored.positionMs === null || stored.positionMs === undefined) return null;
  if (stored.state !== "playing") return stored.positionMs;
  const received = stored.receivedAt ?? stored.observedAt;
  const lag = Math.min(MAX_UPLOAD_LAG_MS, Math.max(0, received - (stored.observedAt ?? received)));
  const position = stored.positionMs + lag + Math.max(0, now - received);
  return stored.durationMs === null || stored.durationMs === undefined ? position : Math.min(position, stored.durationMs);
}
