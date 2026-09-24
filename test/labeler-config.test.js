import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchesGlob } from "node:path";

// Checks .github/labeler.yml against file lists from real PRs (#391), so a
// PR that touches app code always gets at least one area label.
async function loadRules() {
  const text = await readFile(new URL("../.github/labeler.yml", import.meta.url), "utf8");
  const rules = new Map();
  let label = null;
  for (const line of text.split("\n")) {
    const heading = /^([a-z][\w:-]*):\s*$/.exec(line);
    if (heading) { label = heading[1]; rules.set(label, []); continue; }
    if (label) for (const [, glob] of line.matchAll(/"([^"]+)"/g)) rules.get(label).push(glob);
  }
  return rules;
}

function labelsFor(rules, files) {
  return [...rules].filter(([, globs]) => files.some((file) => globs.some((glob) => matchesGlob(file, glob)))).map(([label]) => label).sort();
}

const SAMPLES = [
  [364, ["src/app-config.js", "src/app-settings.js", "src/setup-config.js", "test/app-config.test.js", "test/setup-app.test.js", "test/windows-setup-ui.test.js"], ["area:server", "area:installer"]],
  [366, ["src/providers/spotify.js", "test/spotify.test.js"], ["area:providers"]],
  [374, ["src/auto-updater.js", "src/update-check.js", "test/auto-updater.test.js"], ["area:updater"]],
  [379, ["src/spotify-auth.js", "test/spotify-auth.test.js"], ["area:providers"]],
  [384, ["src/app-config.js", "src/multi-server.js", "test/multi-server.test.js"], ["area:server"]],
  [386, ["src/provider-backoff.js", "test/provider-backoff.test.js"], ["area:providers"]],
  [387, ["src/spotify-signin.js", "test/spotify-signin.test.js"], ["area:providers"]],
  [389, ["src/app-config.js", "src/credential-store.js", "src/setup-config.js", "test/spotify-config.test.js"], ["area:server", "area:security", "area:providers"]],
  [400, ["src/app-settings.js", "src/setup-config.js", "test/config-card.test.js"], ["area:server"]],
  [414, ["hosted/README.md", "hosted/lib/http.js", "test/hosted-http.test.js"], ["area:server", "area:docs"]],
  [416, ["test/card-visual.test.js", "test/fixtures/cards/default.svg"], ["area:cards"]],
];

test("every sample PR gets the expected area labels", async () => {
  const rules = await loadRules();
  for (const [pr, files, expected] of SAMPLES) {
    const got = labelsFor(rules, files);
    for (const label of expected) assert.ok(got.includes(label), `#${pr}: expected ${label}, got ${got.join(", ") || "nothing"}`);
  }
});

test("provider code is labelled providers, not cards", async () => {
  const rules = await loadRules();
  assert.deepEqual(labelsFor(rules, ["src/providers/plex.js"]), ["area:providers"]);
});

test("every area label in the repo has rules, and every src file gets an area", async () => {
  const rules = await loadRules();
  for (const label of ["area:server", "area:cards", "area:artwork", "area:providers", "area:discord", "area:security", "area:release", "area:installer", "area:tray", "area:updater", "area:ci", "area:docs"]) {
    assert.ok(rules.get(label)?.length, `${label} has no globs`);
  }
  const { readdir } = await import("node:fs/promises");
  const src = (await readdir(new URL("../src/", import.meta.url))).filter((name) => name.endsWith(".js")).map((name) => `src/${name}`);
  const unlabelled = src.filter((file) => !labelsFor(rules, [file]).length);
  assert.deepEqual(unlabelled, [], `src files with no area: ${unlabelled.join(", ")}`);
});

test("the labeller workflow still re-applies mira-paused after syncing", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pull-request-labels.yml", import.meta.url), "utf8");
  assert.match(workflow, /Keep mira-paused after syncing labels/);
  assert.match(workflow, /labels: \['mira-paused'\]/);
});
