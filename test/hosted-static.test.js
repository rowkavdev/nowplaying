import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Only hosted/public is served as static files, so the root URL has a page
// and the server source under hosted/lib is never downloadable.
test("hosted static output is limited to public/ and has a root page", async () => {
  const config = JSON.parse(await readFile(new URL("../hosted/vercel.json", import.meta.url), "utf8"));
  assert.equal(config.outputDirectory, "public");
  const page = await readFile(new URL("../hosted/public/index.html", import.meta.url), "utf8");
  assert.match(page, /href="\/healthz"/);
});

test("the requests badge has its public path", async () => {
  const config = JSON.parse(await readFile(new URL("../hosted/vercel.json", import.meta.url), "utf8"));
  assert.ok(config.rewrites.some((rule) => rule.source === "/badges/requests.json" && rule.destination === "/api/badge"));
});
