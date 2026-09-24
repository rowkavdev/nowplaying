import { spawn } from "node:child_process";

// macOS Keychain adapter for createCredentialStore (#215), through the
// built-in `security` tool. Reads and deletes only put the service and
// account on the command line. Writes go through `security -i` on stdin, with
// the secret hex-encoded (-X), so it is never in the process list and needs no
// quoting. Every write is read back to confirm it landed.

const MAX_SECRET_BYTES = 4096;
const SERVICE = /^[A-Za-z0-9._-]{1,64}$/;
const ACCOUNT = /^[^\u0000-\u001f\u007f"\\]{1,256}$/; // quoted on the security -i line, so no quotes or backslashes
const PRINTABLE = /^[\x20-\x7e]+$/; // what `find-generic-password -w` gives back unchanged
const NOT_FOUND = 44; // errSecItemNotFound as security's exit code

export function runSecurity(args, { input, timeoutMs = 20000, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess("/usr/bin/security", args, { shell: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { reject(new Error("Keychain is unavailable")); return; }
    const out = [];
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill?.(); finish(new Error("Keychain timed out")); }, timeoutMs);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", () => {}); // never surface stderr
    child.on("error", () => finish(new Error("Keychain is unavailable")));
    child.on("close", (code) => finish(null, { code, stdout: Buffer.concat(out).toString("utf8") }));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

export function createMacosCredentialAdapter({ run = runSecurity } = {}) {
  if (typeof run !== "function") throw new TypeError("run must be a function");
  const target = (service, account) => {
    if (typeof service !== "string" || typeof account !== "string" || !SERVICE.test(service) || !ACCOUNT.test(account)) throw new TypeError("credential target is invalid");
    return ["-s", service, "-a", account];
  };
  async function find(service, account) {
    const result = await run(["find-generic-password", ...target(service, account), "-w"]);
    if (result?.code === 0) return result.stdout.replace(/\n$/, "");
    if (result?.code === NOT_FOUND) return null;
    throw new Error("Keychain request failed");
  }
  return Object.freeze({
    async setPassword(service, account, secret) {
      if (typeof secret !== "string" || !secret) throw new TypeError("credential secret is required");
      if (!PRINTABLE.test(secret)) throw new TypeError("credential secret must be printable ASCII on macOS");
      if (Buffer.byteLength(secret) > MAX_SECRET_BYTES) throw new RangeError("credential secret is too large");
      const [, s, , a] = target(service, account);
      const hex = Buffer.from(secret, "utf8").toString("hex");
      await run(["-i"], { input: `add-generic-password -U -s "${s}" -a "${a}" -l "NowPlaying" -X ${hex}\n` });
      if ((await find(service, account)) !== secret) throw new Error("Keychain request failed");
    },
    getPassword: find,
    async deletePassword(service, account) {
      const result = await run(["delete-generic-password", ...target(service, account)]);
      if (result?.code === 0) return true;
      if (result?.code === NOT_FOUND) return false;
      throw new Error("Keychain request failed");
    },
  });
}
