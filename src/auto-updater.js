import { checkForUpdate } from "./update-check.js";
import { downloadVerifiedUpdate } from "./update-download.js";
import { installVerifiedUpdate } from "./update-install.js";

export function createAutoUpdater({ currentVersion, repository, token, targetDir, channel, platform, mode = "notify", fetchImpl, onUpdate } = {}) {
  if (!["off", "notify", "install"].includes(mode)) throw new TypeError("mode: expected off, notify or install");
  // No default channel: which releases a user gets must be their explicit choice (#172).
  if (mode !== "off" && !["stable", "beta"].includes(channel)) throw new TypeError("channel: choose stable or beta");
  if (channel !== undefined && !["stable", "beta"].includes(channel)) throw new TypeError("channel: expected stable or beta");
  if (onUpdate !== undefined && typeof onUpdate !== "function") throw new TypeError("onUpdate: expected a function");
  let running;
  async function check() {
    if (mode === "off") return Object.freeze({ status: "disabled" });
    if (running) return running;
    running = (async () => {
      const update = await checkForUpdate({ currentVersion, repository, token, channel, platform, fetchImpl });
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
