import { spawn } from "node:child_process";
// Pass only desktop session variables to the tray/browser children.
export function linuxDesktopEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    ["DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "HOME", "PATH", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "XAUTHORITY"].includes(key) || /^XDG_[A-Z_]+$/.test(key)));
}

export function openLinuxWebUiUrl(url, { spawnProcess = spawn, env = process.env } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !["/", "/settings", "/logs"].includes(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password)
    throw new TypeError("Web UI URL must be an allowed loopback page");
  const child = spawnProcess("xdg-open", [parsed.href], { env: linuxDesktopEnv(env), detached: true, stdio: "ignore", shell: false });
  child.on?.("error", () => {});
  child.unref?.();
  return parsed.href;
}

export function linuxTrayAvailable({ platform = process.platform, env = process.env } = {}) {
  return platform === "linux" && Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

// The helper sees only the icon path. Menu events are a small allowlist, not
// commands or URLs supplied by the helper. Missing desktop support leaves the
// WebUI/server running rather than turning Quit into a startup failure.
export function createLinuxTray({ url, script, icon, spawnProcess = spawn, openUrl = openLinuxWebUiUrl, onQuit = () => {}, onUnavailable = () => {}, readyTimeoutMs = 5000, killTimeoutMs = 1000, env = process.env } = {}) {
  const target = new URL(url);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.username || target.password || target.pathname !== "/" || target.search || target.hash)
    throw new TypeError("tray URL must be a loopback app origin");
  let child, buffer = "", closed = false, didQuit = false, readyDone = false, timer;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const settle = (value) => { if (!readyDone) { readyDone = true; clearTimeout(timer); resolveReady(value); } };
  let exited = false, killTimer;
  const stopChild = () => {
    if (!child || exited) return;
    child.stdin.end();
    child.kill("SIGTERM");
    if (!exited) killTimer = setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, killTimeoutMs);
  };
  const unavailable = () => {
    if (closed || didQuit) return;
    closed = true;
    settle(false);
    stopChild();
    onUnavailable();
  };
  timer = setTimeout(unavailable, readyTimeoutMs);
  try {
    child = spawnProcess("python3", [script, icon], { shell: false, stdio: ["pipe", "pipe", "ignore"], env: linuxDesktopEnv(env) });
    child.stdin.on("error", () => {});
    child.on("error", unavailable);
    child.on("close", () => { exited = true; clearTimeout(killTimer); unavailable(); });
    child.stdout.on("data", (chunk) => {
      if (closed || didQuit) return;
      buffer += chunk.toString();
      if (buffer.length > 1024) { unavailable(); return; }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (event === "ready") settle(true);
        else if (readyDone && event === "quit") { didQuit = true; onQuit(); break; }
        else if (readyDone && ["open", "settings", "logs"].includes(event))
          try { openUrl(event === "open" ? target.origin : `${target.origin}/${event}`); }
          catch { /* A browser failure must not terminate the media app. */ }
      }
    });
  } catch { unavailable(); }
  return Object.freeze({ ready, close() { if (closed) return; closed = true; settle(false); stopChild(); } });
}
