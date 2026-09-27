import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { posix } from "node:path";

// "Start at login" on Linux (#215): an XDG autostart .desktop entry, the same
// mechanism desktop apps use (systemd user units are deliberately left out -
// XDG covers GNOME, KDE, XFCE and friends with no service manager). Like the
// Windows Startup shortcut, enabling takes effect at the next login; it does
// not launch the app now.

export function xdgAutostartDir({ env = process.env, home = env?.HOME } = {}) {
  const configHome =
    typeof env?.XDG_CONFIG_HOME === "string" &&
    posix.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : (() => {
          if (typeof home !== "string" || !posix.isAbsolute(home))
            throw new TypeError("HOME is required");
          return posix.join(home, ".config");
        })();
  return posix.join(configHome, "autostart");
}

// The desktop entry spec quotes arguments containing reserved characters
// (space, tab, newline, double quote, single quote, backslash and the
// ASCII punctuation it lists) in double quotes, with " ` $ \ escaped.
// A literal % must be doubled to %%: single percent signs start field
// codes (%f, %U, ...) that the launcher expands or rejects.
function quoteExecArg(arg) {
  const escaped = arg.replaceAll("%", "%%");
  if (!/[ \t"'\\|><~$&*?#()`]/.test(arg)) return escaped;
  return `"${escaped.replace(/["`$\\]/g, "\\$&")}"`;
}

function checkExec(execPath, args) {
  if (typeof execPath !== "string" || !posix.isAbsolute(execPath))
    throw new TypeError("execPath must be an absolute path");
  for (const part of [execPath, ...args]) {
    if (typeof part !== "string" || part === "" || /[\n\r]/.test(part))
      throw new TypeError(
        "Exec parts must be non-empty strings without newlines",
      );
  }
}

export function createLinuxStartup({
  autostartDir,
  execPath,
  args = [],
  appName = "nowplaying",
} = {}) {
  if (typeof autostartDir !== "string" || !posix.isAbsolute(autostartDir))
    throw new TypeError("autostartDir must be an absolute path");
  checkExec(execPath, args);
  const file = posix.join(autostartDir, `${appName}.desktop`);
  const execLine = [execPath, ...args].map(quoteExecArg).join(" ");
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=NowPlaying",
    "Comment=Share what you are listening to on Discord",
    `Exec=${execLine}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
  async function status() {
    let text;
    try {
      // Read only our own named entry; no arbitrary file contents or paths
      // leave this process through the Settings API.
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT")
        return Object.freeze({ enabled: false, broken: false });
      throw error;
    }
    // The file holds the escaped form (%% for a literal %), which is what
    // execLine is built as, so the comparison is byte-for-byte.
    const current = text
      .split("\n")
      .find((line) => line.startsWith("Exec="))
      ?.slice("Exec=".length);
    // XDG disable keys: Hidden=true acts as if the entry were deleted, and
    // X-GNOME-Autostart-enabled=false is GNOME's off switch. Either one means
    // autostart is off despite the file - report broken so the Settings
    // toggle shows off and re-enabling repairs the entry.
    const disabled = /^\s*Hidden\s*=\s*true\s*$/m.test(text) || /^\s*X-GNOME-Autostart-enabled\s*=\s*false\s*$/m.test(text);
    const matches = current === execLine && !disabled;
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
      await mkdir(autostartDir, { recursive: true });
      await writeFile(file, entry, { mode: 0o644 });
    },
  });
}
