import test from "node:test";
import assert from "node:assert/strict";
import { fetchArtwork } from "../src/artwork-fetch.js";

for (const mode of ["same-origin", "cross-origin", "no-location", "invalid-location", "loop"]) {
  test(`artwork redirect bodies are discarded (${mode})`, async () => {
    const discarded = [];
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (mode === "same-origin" && calls === 2) return { status: 404 };
      const location = mode === "cross-origin" ? "https://other.invalid/cover" : mode === "no-location" ? null : mode === "invalid-location" ? "http://[" : "/next";
      const body = new ReadableStream({ cancel() { discarded.push(calls); } });
      return new Response(body, { status: 302, headers: location === null ? {} : { location } });
    };
    const run = fetchArtwork({ url: "https://media.invalid/cover", headers: { "X-Plex-Token": "private" } }, { fetchImpl });
    if (mode === "same-origin") assert.equal(await run, null);
    else await assert.rejects(run);
    assert.equal(discarded.length, mode === "loop" ? 4 : 1);
  });
}

for (const mode of ["throw", "reject", "pending"]) {
  test(`artwork redirect cleanup cannot delay or mask an origin error (${mode})`, async () => {
    let discarded = false;
    const fetchImpl = async () => ({ status: 302, headers: { get: () => "https://other.invalid/cover" }, body: { cancel() {
      discarded = true;
      if (mode === "throw") throw new Error("cleanup failed");
      if (mode === "reject") return Promise.reject(new Error("cleanup failed"));
      return new Promise(() => {});
    } } });
    await assert.rejects(fetchArtwork({ url: "https://media.invalid/cover", headers: {} }, { fetchImpl }), /outside its origin/);
    assert.equal(discarded, true);
  });
}
