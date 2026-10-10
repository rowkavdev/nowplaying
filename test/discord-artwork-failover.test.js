import test from "node:test";
import assert from "node:assert/strict";
import { createTemporaryCoverUploader, createTmpfilesUploader } from "../src/discord-artwork-upload.js";
import { artworkResolverOptions, createDiscordArtworkResolver } from "../src/discord-artwork.js";

const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const coverSource = async () => ({ dataUri: `data:image/png;base64,${bytes.toString("base64")}` });
const page = "https://tmpfiles.org/Ab123/cover.png";
const image = "https://tmpfiles.org/dl/1234.opaque/Ab123/cover.png";
const reference = { provider: "plex", itemId: "private-item", sourceIndex: 0 };

test("a blocked primary host fails over to the exact sanitized cover and a direct image URL", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) return new Response("blocked", { status: 403 });
    if (requests.length === 2) return Response.json({ status: "success", data: { url: page } });
    return new Response(`<img src="${image}">`);
  };
  const resolver = createDiscordArtworkResolver(artworkResolverOptions({ artworkUpload: true }, { coverSource, fetchImpl }));
  const result = await resolver.resolve({ artwork: reference, title: "Private title", artist: "Private artist" });
  assert.equal(result.strategy, "upload");
  assert.equal(result.image, image);
  assert.equal(result.failure, null);
  assert.deepEqual(requests.map((r) => r.url), ["https://litterbox.catbox.moe/resources/internals/api.php", "https://tmpfiles.org/api/v1/upload", page]);
  const form = requests[1].init.body;
  assert.deepEqual([...form.keys()].sort(), ["expire", "file"]);
  assert.equal(form.get("expire"), "172800");
  assert.equal(form.get("file").name, "cover.png");
  assert.deepEqual(Buffer.from(await form.get("file").arrayBuffer()), bytes);
  for (const { init } of requests) assert.equal(init.redirect, "error");
  await resolver.resolve({ artwork: reference, title: "Private title", artist: "Private artist" });
  assert.equal(requests.length, 3, "the successful cover remains cached");
});

test("a successful primary, missing cover, or disabled upload never contacts the secondary", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("https://litter.catbox.moe/cover.png"); };
  assert.equal(await createTemporaryCoverUploader({ coverSource, fetchImpl })(reference), "https://litter.catbox.moe/cover.png");
  assert.equal(calls, 1);
  assert.equal(await createTemporaryCoverUploader({ coverSource: async () => null, fetchImpl })(reference), null);
  const resolver = createDiscordArtworkResolver(artworkResolverOptions({ artworkUpload: false }, { coverSource, fetchImpl }));
  assert.equal((await resolver.resolve({ artwork: reference })).strategy, "fallback");
  assert.equal(calls, 1);
});

test("secondary replies cannot redirect retrieval or expose a preview page as an image", async () => {
  for (const url of ["http://tmpfiles.org/Ab123/cover.png", "https://private.example/cover.png", "https://127.0.0.1/cover.png", "https://user:pass@tmpfiles.org/Ab123/cover.png", page + "?token=secret", "https://tmpfiles.org/Ab123/wrong.png"]) {
    let calls = 0;
    const upload = createTmpfilesUploader({ coverSource, fetchImpl: async () => { calls++; return Response.json({ status: "success", data: { url } }); } });
    await assert.rejects(upload(reference), { code: "upload_error" });
    assert.equal(calls, 1, url);
  }
  for (const html of ["<html>preview only</html>", '<img src="https://attacker.example/cover.png">', '<img src="https://tmpfiles.org/dl/opaque/Other/cover.png">', `<img src="${image}?token=secret">`]) {
    let calls = 0;
    const upload = createTmpfilesUploader({ coverSource, fetchImpl: async () => ++calls === 1 ? Response.json({ status: "success", data: { url: page } }) : new Response(html) });
    await assert.rejects(upload(reference), { code: "upload_error" });
  }
});

test("secondary malformed, oversized and timed-out bodies remain bounded failures", async () => {
  for (const reply of ["not JSON", "x".repeat(100_000), JSON.stringify({ status: "error" })]) {
    const upload = createTmpfilesUploader({ coverSource, fetchImpl: async () => new Response(reply) });
    await assert.rejects(upload(reference), { code: "upload_error" });
  }
  const upload = createTmpfilesUploader({ coverSource, fetchImpl: async () => { throw new DOMException("secret upstream", "TimeoutError"); } });
  await assert.rejects(upload(reference), (error) => error.code === "upload_timeout" && !error.message.includes("secret"));
  let cancelled = false;
  const hanging = createTmpfilesUploader({ coverSource, timeoutMs: 15, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(hanging(reference), { code: "upload_timeout" }); }
  finally { clearTimeout(keepAlive); }
  assert.equal(cancelled, true);
});

test("manual refresh discards the successful failover cover and repeats the upload", async () => {
  let uploads = 0;
  const fetchImpl = async (url) => {
    if (url.includes("litterbox")) return new Response("blocked", { status: 403 });
    if (url.endsWith("/upload")) { uploads++; return Response.json({ status: "success", data: { url: page } }); }
    return new Response(`<a href="${image}">Download</a>`);
  };
  const resolver = createDiscordArtworkResolver(artworkResolverOptions({ artworkUpload: true }, { coverSource, fetchImpl }));
  await resolver.resolve({ artwork: reference });
  resolver.clear();
  assert.equal((await resolver.resolve({ artwork: reference })).image, image);
  assert.equal(uploads, 2);
});
