import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { posix } from "node:path";

// "Start at login" on macOS (#215): a per-user LaunchAgent in
// ~/Library/LaunchAgents. Like the Windows Startup shortcut, enabling takes
// effect at the next login; it does not launch the app now (no launchctl
// bootstrap, so this also works from a headless shell).

export const MACOS_STARTUP_LABEL = "dev.rowkav.nowplaying";

export function launchAgentsDir({ home = process.env?.HOME } = {}) {
  if (typeof home !== "string" || !posix.isAbsolute(home))
    throw new TypeError("HOME is required");
  return posix.join(home, "Library", "LaunchAgents");
}

function xmlUnescape(value) {
  // &amp; comes last so "&amp;lt;" unescapes to "&lt;", not "<".
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function checkProgram(programPath, programArguments) {
  if (typeof programPath !== "string" || !posix.isAbsolute(programPath))
    throw new TypeError("programPath must be an absolute path");
  for (const part of programArguments) {
    if (typeof part !== "string" || part === "")
      throw new TypeError("programArguments must be non-empty strings");
  }
}

export function createMacosStartup({
  launchAgentsDir: dir,
  label = MACOS_STARTUP_LABEL,
  programPath,
  programArguments = [],
} = {}) {
  if (typeof dir !== "string" || !posix.isAbsolute(dir))
    throw new TypeError("launchAgentsDir must be an absolute path");
  if (typeof label !== "string" || !/^[a-z0-9][a-z0-9.-]*$/i.test(label))
    throw new TypeError("label must be a reverse-DNS style identifier");
  checkProgram(programPath, programArguments);
  const file = posix.join(dir, `${label}.plist`);
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>Label</key>",
    `\t<string>${xmlEscape(label)}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
    ...[programPath, ...programArguments].map(
      (part) => `\t\t<string>${xmlEscape(part)}</string>`,
    ),
    "\t</array>",
    "\t<key>RunAtLoad</key>",
    "\t<true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
  async function status() {
    let text;
    try {
      // Read only our own named plist; no arbitrary file contents or paths
      // leave this process through the Settings API.
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT")
        return Object.freeze({ enabled: false, broken: false });
      throw error;
    }
    // Compare the whole command vector, not just the program: an agent whose
    // script or arguments were edited away from this install is broken.
    const array = text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
    const parts = array ? [...array[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => xmlUnescape(m[1])) : [];
    const expected = [programPath, ...programArguments];
    const matches = parts.length === expected.length && parts.every((part, i) => part === expected[i]);
    return Object.freeze({ enabled: matches, broken: !matches });
  }
  return Object.freeze({
    file,
    status,
    async isEnabled() {
      return (await status()).enabled;
    },
    async setEnabled(enabled) {
      if (typeof enabled !== "boolean")
        throw new TypeError("enabled must be a boolean");
      if (!enabled) {
        await rm(file, { force: true });
        return;
      }
      await mkdir(dir, { recursive: true });
      await writeFile(file, plist, { mode: 0o644 });
    },
  });
}
