// Windows CI visual smoke test of the packaged first-run path. This runs a
// throwaway local Subsonic server and never touches a real media account.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bundle = process.argv[2] ? join(process.cwd(), process.argv[2]) : null;
const out = process.argv[3] ? join(process.cwd(), process.argv[3]) : null;
if (process.platform !== "win32" || !bundle || !out) throw new Error("Windows bundle and artifact directory required");
const { chromium } = await import("playwright-core");
const temp = await mkdtemp(join(tmpdir(), "np-webui-e2e-"));
const media = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ "subsonic-response": path === "/rest/getNowPlaying.view"
    ? { status: "ok", nowPlaying: { entry: { username: "ci-user", title: "Windows UI Smoke", artist: "CI" } } }
    : { status: "ok" } }));
});
await new Promise((done) => media.listen(0, "127.0.0.1", done));
const mediaUrl = `http://127.0.0.1:${media.address().port}`;
const portProbe = createServer();
await new Promise((done) => portProbe.listen(0, "127.0.0.1", done));
const appPort = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const appUrl = `http://127.0.0.1:${appPort}`;
const child = spawn(join(bundle, "nowplaying.exe"), ["start", "--no-tray", "--no-setup"], {
  cwd: bundle, env: { ...process.env, LOCALAPPDATA: temp, NOWPLAYING_PORT: String(appPort) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
let browser;
try {
  const started = Date.now();
  while (!output.includes("NowPlaying Settings:") && Date.now() - started < 30000) {
    if (child.exitCode !== null) throw new Error(`NowPlaying exited ${child.exitCode}: ${output}`);
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.match(output, /NowPlaying Settings:/);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${appUrl}/settings`);
  await page.getByRole("heading", { name: "Set up NowPlaying" }).waitFor();
  await page.screenshot({ path: join(out, "windows-first-run.png"), fullPage: true });
  console.log("Windows WebUI: first-run screenshot saved");
  await page.locator("#manual-add summary").click();
  await page.locator("#server-provider").selectOption("navidrome");
  await page.locator("#server-url").fill(mediaUrl);
  await page.locator("#manual-connect").click();
  await page.locator("#signin-username").fill("ci-user");
  await page.locator("#signin-password").fill("ci-demo-password");
  await page.screenshot({ path: join(out, "windows-sign-in.png"), fullPage: true });
  console.log("Windows WebUI: sign-in screenshot saved");
  await page.locator("#signin-button").click();
  await page.getByRole("heading", { name: "Set up NowPlaying" }).waitFor({ state: "detached", timeout: 30000 });
  await page.locator("h1").filter({ hasText: /^Settings$/ }).waitFor({ timeout: 15000 });
  const state = await page.evaluate(async () => (await fetch("/api/settings/servers")).json());
  assert.equal(state.servers.length, 1);
  assert.equal(state.servers[0].provider, "navidrome");
  assert.match(await page.locator("#servers-list").innerText(), /ci-user/);
  await page.screenshot({ path: join(out, "windows-provider-active.png"), fullPage: true });
  console.log("Windows WebUI: provider-active screenshot saved");
  const config = await readFile(join(temp, "nowplaying", "config.json"), "utf8");
  assert.doesNotMatch(config, /ci-demo-password/);
  assert.doesNotMatch(output, /ci-demo-password/);
  console.log("Packaged Windows first-run -> sign-in -> provider activation verified; screenshots saved.");
} finally {
  await browser?.close();
  // The launcher waits for its bundled Node child. Killing only the launcher
  // leaves that child polling our fake server, preventing media.close().
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 });
  media.closeAllConnections();
  await new Promise((done) => media.close(done));
}
