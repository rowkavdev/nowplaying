import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLinuxStartup, xdgAutostartDir } from "../src/linux-startup.js";

const dir = () => mkdtemp(join(tmpdir(), "np-linux-startup-"));
const make = (over = {}) => {
  const autostartDir = over.autostartDir;
  return createLinuxStartup({
    autostartDir,
    execPath: "/usr/bin/node",
    args: ["/home/u/nowplaying/scripts/nowplaying.js", "start"],
    ...over.rest,
  });
};

test("the autostart dir follows XDG_CONFIG_HOME, falling back to ~/.config (#215)", () => {
  assert.equal(
    xdgAutostartDir({ env: { XDG_CONFIG_HOME: "/xdg" }, home: "/home/u" }),
    "/xdg/autostart",
  );
  assert.equal(
    xdgAutostartDir({ env: {}, home: "/home/u" }),
    "/home/u/.config/autostart",
  );
  // A relative XDG_CONFIG_HOME is invalid per the spec and ignored.
  assert.equal(
    xdgAutostartDir({ env: { XDG_CONFIG_HOME: "relative" }, home: "/home/u" }),
    "/home/u/.config/autostart",
  );
  assert.throws(() => xdgAutostartDir({ env: {} }), /HOME is required/);
});

test("missing entry reports disabled, not broken", async () => {
  const startup = make({ autostartDir: await dir() });
  assert.deepEqual(await startup.status(), { enabled: false, broken: false });
  assert.equal(await startup.isEnabled(), false);
});

test("enable writes the desktop entry; status sees it; disable removes it (round trip)", async () => {
  const startup = make({ autostartDir: await dir() });
  await startup.setEnabled(true);
  const text = await readFile(startup.file, "utf8");
  assert.match(text, /^\[Desktop Entry\]$/m);
  assert.match(text, /^Type=Application$/m);
  assert.match(text, /^Name=NowPlaying$/m);
  assert.match(
    text,
    /^Exec=\/usr\/bin\/node \/home\/u\/nowplaying\/scripts\/nowplaying\.js start$/m,
  );
  assert.match(text, /^Terminal=false$/m);
  assert.match(text, /^X-GNOME-Autostart-enabled=true$/m);
  assert.equal((await stat(startup.file)).mode & 0o777, 0o644);
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
  assert.equal(await startup.isEnabled(), true);
  await startup.setEnabled(false);
  assert.deepEqual(await startup.status(), { enabled: false, broken: false });
});

test("an entry pointing at a different exec reports broken until re-enabled", async () => {
  const autostartDir = await dir();
  const startup = make({ autostartDir });
  await startup.setEnabled(true);
  const moved = createLinuxStartup({
    autostartDir,
    execPath: "/usr/local/bin/node",
    args: ["/opt/nowplaying/nowplaying.js", "start"],
  });
  assert.deepEqual(await moved.status(), { enabled: false, broken: true });
  // Re-enabling from the new location repairs the stale entry.
  await moved.setEnabled(true);
  assert.deepEqual(await moved.status(), { enabled: true, broken: false });
});

test("Exec parts with spaces and $ are quoted and escaped per the desktop entry spec", async () => {
  const autostartDir = await dir();
  const startup = createLinuxStartup({
    autostartDir,
    execPath: "/opt/my app/bin/node",
    args: ["/home/u/a$b/now playing.js", "start"],
  });
  await startup.setEnabled(true);
  const text = await readFile(startup.file, "utf8");
  assert.match(
    text,
    /^Exec="\/opt\/my app\/bin\/node" "\/home\/u\/a\\\$b\/now playing\.js" start$/m,
  );
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
});

test("invalid exec definitions are rejected before any file is written", async () => {
  const autostartDir = await dir();
  assert.throws(
    () =>
      createLinuxStartup({ autostartDir, execPath: "relative/node", args: [] }),
    /absolute/,
  );
  assert.throws(
    () =>
      createLinuxStartup({
        autostartDir,
        execPath: "/usr/bin/node",
        args: ["bad\narg"],
      }),
    /newlines/,
  );
  assert.throws(
    () => createLinuxStartup({ execPath: "/usr/bin/node", args: [] }),
    /autostartDir/,
  );
  const startup = make({ autostartDir });
  await assert.rejects(startup.setEnabled("yes"), /boolean/);
});

test("Hidden=true disables the entry: status reports broken, re-enabling repairs (#672 review)", async () => {
  const startup = make({ autostartDir: await dir() });
  await startup.setEnabled(true);
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
  const { appendFile } = await import("node:fs/promises");
  await appendFile(startup.file, "Hidden=true\n");
  assert.deepEqual(await startup.status(), { enabled: false, broken: true });
  await startup.setEnabled(true);
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
});

test("X-GNOME-Autostart-enabled=false disables the entry: status reports broken", async () => {
  const startup = make({ autostartDir: await dir() });
  await startup.setEnabled(true);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(startup.file, (await readFile(startup.file, "utf8")).replace("X-GNOME-Autostart-enabled=true", "X-GNOME-Autostart-enabled=false"));
  assert.deepEqual(await startup.status(), { enabled: false, broken: true });
});

test("a literal % in Exec is doubled per the XDG spec, and status still matches (#672 review)", async () => {
  const autostartDir = await dir();
  const startup = createLinuxStartup({ autostartDir, execPath: "/usr/bin/node", args: ["/home/u/100% done/nowplaying.js", "start"] });
  await startup.setEnabled(true);
  const text = await readFile(startup.file, "utf8");
  assert.match(text, /^Exec=\/usr\/bin\/node "\/home\/u\/100%% done\/nowplaying\.js" start$/m);
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
});

test("a bare single % on disk (field-code-invalid) reads as broken", async () => {
  const autostartDir = await dir();
  const startup = createLinuxStartup({ autostartDir, execPath: "/usr/bin/node", args: ["/home/u/100%/nowplaying.js", "start"] });
  await startup.setEnabled(true);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(startup.file, (await readFile(startup.file, "utf8")).replace("100%%", "100%"));
  assert.deepEqual(await startup.status(), { enabled: false, broken: true });
});
