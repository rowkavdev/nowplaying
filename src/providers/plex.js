import { readBoundedJson } from "../bounded-response.js";
/*
 * Plex session polling adapted from discord-rich-presence-plex (DRPP).
 * Source: https://github.com/phin05/discord-rich-presence-plex/blob/a4f95f08ec96c3f837876e73354665560115dfac/server/plex/client.go
 * Copyright (C) phin05 and DRPP contributors.
 * Licensed under AGPL-3.0. See LICENSE and NOTICE.
 */

import { defineProvider } from "../provider.js";
import { discardResponseBody, fetchWithTimeout } from "./request.js";
import { imageRef, optionalCount, optionalText, optionalYear, playbackTimes, pickSession } from "./fields.js";

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
      .then((reply) => {
        // Only the status proves owner access; discard the unused body
        // without letting cleanup delay or change that authorization result.
        try { Promise.resolve(reply.body?.cancel?.()).catch(() => {}); } catch {}
        if (!reply.ok) owner = undefined;
        return reply.ok;
      }, () => { owner = undefined; return false; });
    return owner;
  }
  async function ownerSession(sessions) {
    const candidate = pickSession(sessions, (item) => String(item?.User?.id ?? "") === "1", (item) => item?.Player?.state === "paused");
    return candidate && await isOwner() ? candidate : null;
  }
  return defineProvider({
    id: "plex",
    async getPresence({ username, userId } = {}) {
      const response = await fetchWithTimeout(fetchImpl, `${origin}/status/sessions`, {
        headers: { Accept: "application/json", "X-Plex-Client-Identifier": CLIENT_ID, "X-Plex-Token": token },
      });
      if (!response.ok) { discardResponseBody(response); throw Object.assign(new Error(`Plex sessions request failed: ${response.status} ${response.statusText}`), { status: response.status }); }
      const payload = await readBoundedJson(response);
      const listed = payload?.MediaContainer?.Metadata ?? [];
      if (!Array.isArray(listed)) throw new Error("Plex sessions response was not a list");
      const sessions = listed.filter((item) => item && typeof item === "object");
      const paused = (item) => item?.Player?.state === "paused";
      const session = userId
        ? pickSession(sessions, (item) => sameId(item?.User?.id, userId), paused) ?? await ownerSession(sessions)
        : pickSession(sessions, (item) => matchesUser(item, username), paused);
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
  const actual = optionalText(session?.User?.username) || optionalText(session?.User?.title) || "";
  return actual.localeCompare(username, undefined, { sensitivity: "accent" }) === 0;
}

function trackArtist(session) {
  return optionalText(session.grandparentTitle) || optionalText(session.originalTitle);
}

function subtitleFor(kind, session, year) {
  if (kind === "episode") return optionalText(session.grandparentTitle) || optionalText(session.parentTitle);
  if (kind === "track") return trackArtist(session);
  return year !== null ? String(year) : null;
}

function mapSession(session) {
  const state = session?.Player?.state === "paused" ? "paused" : "playing";
  const type = session.type;
  const kind = type === "track" ? "track" : type === "episode" ? "episode" : type === "movie" ? "movie" : "unknown";
  const year = optionalYear(session.year);
  const subtitle = subtitleFor(kind, session, year);
  return {
    state, kind, title: optionalText(session.title), subtitle,
    artist: kind === "track" ? trackArtist(session) : null,
    artwork: imageRef("plex", optionalText(session.thumb) || session.grandparentThumb, "thumb"),
    artworkUrl: null,
    ...playbackTimes(session.viewOffset, session.duration),
    // Episode and movie details (#143). Plex sends parentIndex/index for the
    // season and episode number.
    series: kind === "episode" ? optionalText(session.grandparentTitle) : null,
    season: kind === "episode" ? optionalCount(session.parentIndex) : null,
    episode: kind === "episode" ? optionalCount(session.index) : null,
    year: kind === "episode" || kind === "movie" ? optionalYear(session.year) : null,
  };
}

