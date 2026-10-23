// Selection layers share observation order so falling back to an older
// still-playing source does not turn it into new playback at the next layer.
// The symbol is internal metadata on providers, never on public presences.
export const PRESENCE_ACTIVITY_ORDER = Symbol("presence activity order");
let nextOrder = 0;

export function nextPresenceActivityOrder() {
  return ++nextOrder;
}
