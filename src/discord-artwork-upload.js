import { classifyArtworkUrl } from "./discord-artwork.js";
import { readBoundedBytes } from "./bounded-response.js";

// Discord fetches the large image itself, so a cover that lives on a private
// media server has to be copied somewhere public first. This is what Discord
// Rich Presence for Plex does: it downloads the poster from the server and
// uploads it to Litterbox, with tmpfiles.org as a temporary-host fallback,
// then hands Discord a direct image URL. Only the sanitized cover image is
// sent, never a token, server address, title or artist.
const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";
const TMPFILES_API = "https://tmpfiles.org/api/v1/upload";
const EXPIRY_HOURS = new Set([1, 12, 24, 72]);
const MAX_BYTES = 2_000_000;
const MAX_REPLY_BYTES = 64 * 1024; // the reply is one short URL

function dataUriBytes(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  return bytes.length > 0 && bytes.length <= MAX_BYTES ? { type: match[1], bytes } : null;
}

function coverFilename(image) {
  return `cover.${image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg"}`;
}

function uploadFailure(error) {
  return Object.assign(new Error("upload failed"), { code: error?.name === "TimeoutError" ? "upload_timeout" : "upload_error" });
}

function isUploadFailure(error) {
  return ["upload_blocked", "upload_rate_limited", "upload_timeout", "upload_error"].includes(error?.code);
}

async function fetchUploadReply(url, options, fetchImpl, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, redirect: "error", signal });
    if (!response.ok) {
      try { Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
      const code = response.status === 403 ? "upload_blocked" : response.status === 429 ? "upload_rate_limited" : "upload_error";
      throw Object.assign(new Error("upload failed"), { code });
    }
    return new TextDecoder().decode(await readBoundedBytes(response, MAX_REPLY_BYTES, "artwork upload reply", { signal })).trim();
  } catch (error) {
    if (isUploadFailure(error)) throw error;
    throw uploadFailure(error);
  }
}

// The API returns a preview page, not an image. Its download address includes
// an opaque segment, so read the bounded page and accept only this upload's
// same-host direct image. Never send Discord the HTML page or follow redirects.
export function createTmpfilesUploader({ coverSource, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (typeof coverSource !== "function") throw new TypeError("discord artwork upload: coverSource is required");
  return async function upload(artwork) {
    const image = dataUriBytes((await coverSource(artwork))?.dataUri);
    if (!image) return null;
    const filename = coverFilename(image);
    const form = new FormData();
    form.set("file", new Blob([image.bytes], { type: image.type }), filename);
    form.set("expire", "172800"); // 48 hours; longer than the six-hour cover cache.
    try {
      const reply = JSON.parse(await fetchUploadReply(TMPFILES_API, { method: "POST", body: form }, fetchImpl, timeoutMs));
      const page = new URL(reply?.data?.url);
      if (reply?.status !== "success" || page.origin !== "https://tmpfiles.org" || page.search || page.hash || page.username || page.password || !new RegExp(`^/[A-Za-z0-9_-]+/${filename.replace(".", "\\.")}$`).test(page.pathname)) throw uploadFailure();
      const html = await fetchUploadReply(page.href, { method: "GET" }, fetchImpl, timeoutMs);
      const candidates = html.match(/https:\/\/tmpfiles\.org\/dl\/[A-Za-z0-9._/-]+(?=["'\s<>])/g) ?? [];
      const direct = candidates.find((value) => new URL(value).pathname.endsWith(page.pathname) && classifyArtworkUrl(value).ok);
      if (!direct) throw uploadFailure();
      return direct;
    } catch (error) {
      if (isUploadFailure(error)) throw error;
      throw uploadFailure(error);
    }
  };
}

// Only enabled when the user allows server-cover uploads. Keep the original
// temporary host first and use a second temporary host when it rejects or
// cannot complete the upload. Both receive sanitized image bytes only.
export function createTemporaryCoverUploader(options = {}) {
  const primary = createLitterboxUploader(options);
  const secondary = createTmpfilesUploader(options);
  return async (artwork) => {
    try { return await primary(artwork); }
    catch { return secondary(artwork); }
  };
}

// coverSource(ref) resolves to { dataUri } (the card's own sanitized cover) or null.
export function createLitterboxUploader({ coverSource, fetchImpl = fetch, expiryHours = 72, timeoutMs = 10_000 } = {}) {
  if (typeof coverSource !== "function") throw new TypeError("discord artwork upload: coverSource is required");
  if (!EXPIRY_HOURS.has(expiryHours)) throw new RangeError("discord artwork upload: expiryHours must be 1, 12, 24 or 72");
  return async function upload(artwork) {
    const cover = await coverSource(artwork);
    const image = dataUriBytes(cover?.dataUri);
    if (!image) return null;
    const form = new FormData();
    form.set("reqtype", "fileupload");
    form.set("time", `${expiryHours}h`);
    form.set("fileToUpload", new Blob([image.bytes], { type: image.type }), coverFilename(image));
    let response;
    try {
      response = await fetchImpl(LITTERBOX_API, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw Object.assign(new Error("upload failed"), { code: error?.name === "TimeoutError" ? "upload_timeout" : "upload_error" });
    }
    if (!response.ok) {
      // The failed reply body is never read; release it without waiting or
      // letting cleanup replace the real error.
      try { Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
      const code = response.status === 403 ? "upload_blocked" : response.status === 429 ? "upload_rate_limited" : "upload_error";
      throw Object.assign(new Error("upload failed"), { code });
    }
    let text;
    try {
      text = new TextDecoder().decode(await readBoundedBytes(response, MAX_REPLY_BYTES, "artwork upload reply")).trim();
    } catch (error) {
      if (error?.name === "TimeoutError") throw Object.assign(new Error("upload failed"), { code: "upload_timeout" });
      throw error;
    }
    const checked = classifyArtworkUrl(text);
    if (!checked.ok) throw new Error("upload returned no public image URL");
    return checked.url;
  };
}
