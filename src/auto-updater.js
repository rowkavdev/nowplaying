import { checkForUpdate } from "./update-check.js";
import { downloadVerifiedUpdate } from "./update-download.js";
import { installVerifiedUpdate } from "./update-install.js";

export function createAutoUpdater({ currentVersion, repository, token, targetDir, channel = "beta", mode = "notify", fetchImpl, onUpdate } = {}) {
  if (!["stable", "beta"].includes(channel)) throw new TypeError("channel: expected stable or beta");
  if (!["off", "notify", "install"].includes(mode)) throw new TypeError("mode: expected off, notify or install");
  if (onUpdate !== undefined && typeof onUpdate !== "function") throw new TypeError("onUpdate: expected a function");
  const version = channel === "beta" && !String(currentVersion).includes("-") ? `${currentVersion}-beta` : currentVersion;
  let running;

  async function check() {
    if (mode === "off") return Object.freeze({ status: "disabled" });
    if (running) return running;
    running = (async () => {
      const update = await checkForUpdate({ currentVersion: version, repository, token, fetchImpl });
      if (!update.available) return Object.freeze({ status: "current", version: update.currentVersion });
      if (mode === "notify") { await onUpdate?.(update); return Object.freeze({ status: "available", ...update }); }
      const verified = await downloadVerifiedUpdate({ update, token, fetchImpl });
      const installed = await installVerifiedUpdate({ update: verified, targetDir });
      await onUpdate?.({ ...update, ...installed });
      return Object.freeze({ status: "installed", ...installed });
    })().finally(() => { running = undefined; });
    return running;
  }

  return Object.freeze({ mode, channel, check });
}
