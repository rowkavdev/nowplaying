import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { releaseAssetNames } from "../scripts/release-artifacts.js";
import { publishRelease } from "../scripts/publish-release.js";

const tag = "v0.2.1", repository = "owner/nowplaying", sha = "a".repeat(40);
async function fixture(t, { draft = true, commit = sha, existing = [], corruptDownload = null, releaseId = 422301019 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "np-publish-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const local = new Map(releaseAssetNames(tag).map(name => [name, Buffer.from(`verified ${name}`)]));
  local.set("SHA256SUMS", Buffer.from([...local].map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`).join("")));
  await Promise.all([...local].map(([name, bytes]) => writeFile(join(directory, name), bytes)));
  const remote = new Map(existing.map(name => [name, local.get(name)]));
  const state = { draft, tag_name: tag, prerelease: false };
  const calls = [];
  async function gh(args) {
    calls.push(args);
    if (args[0] === "api") {
      // GitHub's REST by-tag route returns 404 for this authenticated draft.
      // Only the numeric-ID route exposes the fresh draft and asset state.
      if (args[1].includes("/releases/tags/")) throw new Error("HTTP 404: Not Found");
      if (args[1] === `repos/${repository}/commits/${tag}`) return JSON.stringify({ sha: commit });
      assert.equal(args[1], `repos/${repository}/releases/${releaseId}`);
      return JSON.stringify({ id: releaseId, ...state, assets: [...remote.keys()].map(name => ({ name })) });
    }
    if (args[1] === "view") {
      assert.deepEqual(args, ["release", "view", tag, "--repo", repository, "--json", "databaseId"]);
      return JSON.stringify({ databaseId: releaseId });
    }
    if (args[1] === "upload") {
      assert.ok(!args.includes("--clobber"), "release uploads must never overwrite existing assets");
      for (const file of args.slice(5)) {
        const name = basename(file);
        if (remote.has(name)) throw new Error("existing asset would be overwritten");
        remote.set(name, await readFile(file));
      }
    } else if (args[1] === "download") {
      const destination = args[args.indexOf("--dir") + 1];
      const names = args.flatMap((arg, index) => arg === "--pattern" ? [args[index + 1]] : []);
      for (const name of names) {
        if (!remote.has(name)) throw new Error(`missing remote asset ${name}`);
        await writeFile(join(destination, name), name === corruptDownload ? "corrupt" : remote.get(name));
      }
    } else if (args[1] === "edit") { state.draft = false; }
    else throw new Error(`unexpected gh command ${args}`);
    return "";
  }
  return { directory, remote, local, state, calls, run: () => publishRelease({ directory, tag, repository, sha, gh }) };
}

test("authenticated draft lookup uses its release ID when REST by tag returns 404", async t => {
  const f = await fixture(t);
  await f.run();
  assert.equal(f.state.draft, false);
  assert.deepEqual(f.remote, f.local);
  assert.deepEqual(f.calls[0], ["release", "view", tag, "--repo", repository, "--json", "databaseId"]);
  assert.equal(f.calls.filter(call => call[0] === "api" && call[1] === `repos/${repository}/releases/422301019`).length, 2, "recheck the same draft ID after verifying uploaded bytes");
  assert.ok(!f.calls.some(call => call[1]?.includes("/releases/tags/")));
  assert.equal(f.calls.at(-1)[1], "edit");
  assert.ok(f.calls.at(-1).includes("--latest"));
  assert.ok(f.calls.findIndex(call => call[1] === "download") > f.calls.findIndex(call => call[1] === "upload"));
});

test("published releases and mismatched immutable tags are refused without mutations", async t => {
  for (const options of [{ draft: false }, { commit: "b".repeat(40) }]) {
    const f = await fixture(t, options);
    await assert.rejects(f.run(), /published release|verified commit/);
    assert.ok(f.calls.every(call => call[0] === "api" || call[1] === "view"));
  }
});

test("a corrupt local artifact fails before any GitHub call", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, releaseAssetNames(tag)[0]), "tampered");
  await assert.rejects(f.run(), /checksum mismatch/);
  assert.deepEqual(f.calls, []);
});

test("a bad downloadable asset leaves the release as a draft", async t => {
  const f = await fixture(t, { corruptDownload: releaseAssetNames(tag)[3] });
  await assert.rejects(f.run(), /checksum mismatch/);
  assert.equal(f.state.draft, true);
  assert.ok(!f.calls.some(call => call[1] === "edit"));
});

test("a partial upload resumes only when existing draft assets match the verified build", async t => {
  const existing = releaseAssetNames(tag).slice(0, 2);
  const f = await fixture(t, { existing });
  await f.run();
  const upload = f.calls.find(call => call[1] === "upload");
  assert.ok(upload.slice(5).every(file => !existing.includes(basename(file))));
  assert.deepEqual(f.remote, f.local);
  const changed = await fixture(t, { existing });
  changed.remote.set(existing[0], Buffer.from("different build"));
  await assert.rejects(changed.run(), /draft asset differs/);
  assert.ok(!changed.calls.some(call => ["upload", "edit"].includes(call[1])));
});

test("incomplete and ambiguous checksum manifests cannot publish", async t => {
  for (const ambiguous of [false, true]) {
    const f = await fixture(t);
    const lines = (await readFile(join(f.directory, "SHA256SUMS"), "utf8")).trim().split("\n");
    await writeFile(join(f.directory, "SHA256SUMS"), ambiguous ? `${lines.join("\n")}\n${lines[0]}\n` : `${lines.slice(1).join("\n")}\n`);
    await assert.rejects(f.run(), /checksum/);
    assert.deepEqual(f.calls, []);
  }
});


test("an invalid release ID fails before any GitHub mutation", async t => {
  for (const releaseId of [null, "422301019", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const f = await fixture(t, { releaseId });
    await assert.rejects(f.run(), /invalid release ID/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1], "view");
  }
});
