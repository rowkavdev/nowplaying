import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MACOS_STARTUP_LABEL,
  createMacosStartup,
  launchAgentsDir,
} from "../src/macos-startup.js";

const dir = () => mkdtemp(join(tmpdir(), "np-macos-startup-"));
const make = (launchAgentsDir, over = {}) =>
  createMacosStartup({
    launchAgentsDir,
    programPath: "/usr/local/bin/node",
    programArguments: ["/Users/u/nowplaying/scripts/nowplaying.js", "start"],
    ...over,
  });

test("LaunchAgents live under ~/Library (#215)", () => {
  assert.equal(
    launchAgentsDir({ home: "/Users/u" }),
    "/Users/u/Library/LaunchAgents",
  );
  assert.throws(() => launchAgentsDir({ home: "" }), /HOME is required/);
  assert.equal(MACOS_STARTUP_LABEL, "dev.rowkav.nowplaying");
});

test("missing plist reports disabled, not broken", async () => {
  const startup = make(await dir());
  assert.deepEqual(await startup.status(), { enabled: false, broken: false });
  assert.equal(await startup.isEnabled(), false);
});

test("enable writes the LaunchAgent plist; status sees it; disable removes it (round trip)", async () => {
  const startup = make(await dir());
  await startup.setEnabled(true);
  const text = await readFile(startup.file, "utf8");
  assert.ok(startup.file.endsWith(`/${MACOS_STARTUP_LABEL}.plist`));
  assert.match(
    text,
    /<key>Label<\/key>\n\t<string>dev\.rowkav\.nowplaying<\/string>/,
  );
  assert.match(
    text,
    /<key>ProgramArguments<\/key>\n\t<array>\n\t\t<string>\/usr\/local\/bin\/node<\/string>\n\t\t<string>\/Users\/u\/nowplaying\/scripts\/nowplaying\.js<\/string>\n\t\t<string>start<\/string>/,
  );
  assert.match(text, /<key>RunAtLoad<\/key>\n\t<true\/>/);
  assert.equal((await stat(startup.file)).mode & 0o777, 0o644);
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
  assert.equal(await startup.isEnabled(), true);
  await startup.setEnabled(false);
  assert.deepEqual(await startup.status(), { enabled: false, broken: false });
});

test("a plist pointing at a different program reports broken until re-enabled", async () => {
  const launchAgents = await dir();
  const startup = make(launchAgents);
  await startup.setEnabled(true);
  const moved = make(launchAgents, { programPath: "/opt/homebrew/bin/node" });
  assert.deepEqual(await moved.status(), { enabled: false, broken: true });
  await moved.setEnabled(true);
  assert.deepEqual(await moved.status(), { enabled: true, broken: false });
});

test("XML special characters in paths are escaped", async () => {
  const launchAgents = await dir();
  const startup = make(launchAgents, {
    programPath: "/Users/a & b/node",
    programArguments: ["/Users/u/a<b>/nowplaying.js", "start"],
  });
  await startup.setEnabled(true);
  const text = await readFile(startup.file, "utf8");
  assert.match(text, /<string>\/Users\/a &amp; b\/node<\/string>/);
  assert.match(
    text,
    /<string>\/Users\/u\/a&lt;b&gt;\/nowplaying\.js<\/string>/,
  );
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
});

test("invalid definitions are rejected before any file is written", async () => {
  const launchAgents = await dir();
  assert.throws(
    () => make(launchAgents, { programPath: "relative/node" }),
    /absolute/,
  );
  assert.throws(
    () => make(launchAgents, { programArguments: [""] }),
    /non-empty/,
  );
  assert.throws(
    () => make(launchAgents, { label: "bad label!" }),
    /reverse-DNS/,
  );
  const startup = make(launchAgents);
  await assert.rejects(startup.setEnabled("yes"), /boolean/);
});

// Real lint on macOS (the CI macOS job runs this): the written plist must be
// well-formed for launchd, not just for our own reader.
test(
  "the written plist passes plutil -lint",
  { skip: process.platform !== "darwin" },
  async () => {
    const startup = make(await dir());
    await startup.setEnabled(true);
    assert.match(
      execFileSync("plutil", ["-lint", startup.file], { encoding: "utf8" }),
      /OK/,
    );
  },
);

test("an edited argument in the plist reports broken, not enabled (#672 review)", async () => {
  const launchAgents = await dir();
  // Enable with /usr/bin/node /good/nowplaying.js start...
  const startup = createMacosStartup({ launchAgentsDir: launchAgents, programPath: "/usr/bin/node", programArguments: ["/good/nowplaying.js", "start"] });
  await startup.setEnabled(true);
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
  // ...then the script path in the plist is edited to /other/nowplaying.js.
  const { writeFile } = await import("node:fs/promises");
  await writeFile(startup.file, (await readFile(startup.file, "utf8")).replace("/good/nowplaying.js", "/other/nowplaying.js"));
  assert.deepEqual(await startup.status(), { enabled: false, broken: true });
  // Re-enabling repairs the edited agent.
  await startup.setEnabled(true);
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
});

test("a dropped argument in the plist reports broken, not enabled", async () => {
  const launchAgents = await dir();
  const startup = createMacosStartup({ launchAgentsDir: launchAgents, programPath: "/usr/bin/node", programArguments: ["/good/nowplaying.js", "start"] });
  await startup.setEnabled(true);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(startup.file, (await readFile(startup.file, "utf8")).replace("\t\t<string>start</string>\n", ""));
  assert.deepEqual(await startup.status(), { enabled: false, broken: true });
});
