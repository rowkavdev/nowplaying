import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EXAMPLES, renderExamples } from "../scripts/render-card-examples.js";

// The gallery in docs/card-examples.md must match the shipped renderer.
test("committed card examples match a fresh render", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-cards-"));
  const fresh = await renderExamples(dir);
  for (const example of EXAMPLES) {
    const committed = await readFile(new URL(`../docs/assets/cards/${example.file}`, import.meta.url), "utf8");
    assert.equal(fresh[example.file], committed, `${example.file} is stale - run: node scripts/render-card-examples.js`);
  }
});
