/*
 * Plex session polling adapted from discord-rich-presence-plex (DRPP).
 * Source: https://github.com/phin05/discord-rich-presence-plex/blob/a4f95f08ec96c3f837876e73354665560115dfac/server/plex/client.go
 * Copyright (C) phin05 and DRPP contributors.
 * Licensed under AGPL-3.0. See LICENSE and NOTICE.
 */

import { defineProvider } from "../provider.js";
import { fetchWithTimeout } from "./request.js";
import { optionalCount, optionalText, optionalYear } from "./fields.js";

const CLIENT_ID = "nowplaying";

export function createPlexProvider({ baseUrl, token, fetchImpl = fetch }) {
  const origin = normalizeBaseUrl(baseUrl);
  if (typeof token !== "string" || !token.trim()) throw new TypeError("Plex token is required");
  // The local server reports its owner as user "1" rather than the plex.tv
  // account ID we store. Only the owner's token can list /accounts, so that
  // answers "is this sign-in the owner?" once per run.
  let owner;
  async function isOwner() {
    owner ??= fetchWithTimeout(fetchImpl, `${origin}/accounts`, { headers: { Accept: "application/json", "X-Plex-Client-Identifier": CLIENT_ID, "X-Plex-Token": token } })
      .then((reply) => reply.ok, () => { owner = undefined; return false; });
    return owner;
  }
  async function ownerSession(sessions) {
    const candidate = sessions.find((item) => String(item?.User?.id ?? "") === "1");
    return candidate && await isOwner() ? candidate : null;
  }
  return defineProvider({
    id: "plex",
    async getPresence({ username, userId } = {}) {
      const response = await fetchWithTimeout(fetchImpl, `${origin}/status/sessions`, {
        headers: { Accept: "application/json", "X-Plex-Client-Identifier": CLIENT_ID, "X-Plex-Token": token },
      });
      if (!response.ok) throw new Error(`Plex sessions request failed: ${response.status} ${response.statusText}`);
      const payload = await response.json();
      const sessions = payload?.MediaContainer?.Metadata ?? [];
      const session = userId
        ? sessions.find((item) => sameId(item?.User?.id, userId)) ?? await ownerSession(sessions)
        : sessions.find((item) => matchesUser(item, username)) ?? null;
      return session ? mapSession(session) : { state: "idle" };
    },
  });
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Plex baseUrl is required");
  return new URL(value).toString().replace(/\/$/, "");
}

function sameId(actual, expected) {
  return actual !== undefined && actual !== null && String(actual) !== "" && String(actual) === String(expected);
}

function matchesUser(session, username) {
  if (!username) return true;
  const actual = session?.User?.username || session?.User?.title || "";
  return actual.localeCompare(username, undefined, { sensitivity: "accent" }) === 0;
}

function mapSession(session) {
  const state = session?.Player?.state === "paused" ? "paused" : "playing";
  const type = session.type;
  const kind = type === "track" ? "track" : type === "episode" ? "episode" : type === "movie" ? "movie" : "unknown";
  const subtitle = kind === "episode" ? session.grandparentTitle || session.parentTitle : kind === "track" ? session.grandparentTitle || session.originalTitle : session.year ? String(session.year) : null;
  const imageId = session.thumb || session.grandparentThumb;
  return {
    state, kind, title: session.title, subtitle,
    artwork: imageId ? { provider: "plex", imageId, type: "thumb" } : null,
    artworkUrl: null,
    positionMs: session.viewOffset, durationMs: session.duration,
    // Episode and movie details (#143). Plex sends parentIndex/index for the
    // season and episode number.
    series: kind === "episode" ? optionalText(session.grandparentTitle) : null,
    season: kind === "episode" ? optionalCount(session.parentIndex) : null,
    episode: kind === "episode" ? optionalCount(session.index) : null,
    year: kind === "episode" || kind === "movie" ? optionalYear(session.year) : null,
  };
}

