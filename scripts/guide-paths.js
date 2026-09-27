// Tested-examples harness for the user guide (#142 phase 1). Every documented
// guide path runs here against the current tree and reports machine-visible
// results as JSONL: one line per step, then one summary line per path. A path
// stops at its first broken step, so the failing line names what drifted.
//
//   node scripts/guide-paths.js list
//   node scripts/guide-paths.js run <path-id|--all>
//   node scripts/guide-paths.js check-docs [file]   (default docs/guide-skeleton.md)
//
// check-docs fails when the skeleton's claimed per-path status or step list no
// longer matches a fresh run. Test: test/guide-paths.test.js.
import { createServer as createHttpServer } from "node:http";
import { createServer as createIpcServer } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createPlexProvider } from "../src/providers/plex.js";
import { OP, createDiscordIpcClient, decodeFrames, encodeFrame } from "../src/discord-ipc.js";
import { renderCard } from "../src/card.js";
import { EXAMPLES } from "./render-card-examples.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DOC = join(ROOT, "docs/guide-skeleton.md");

// Runs [id, fn] steps in order; the first failure stops the path and the rest
// are reported as skipped, so the output names the step that broke.
async function execute(pathId, defs) {
  const steps = [];
  for (let i = 0; i < defs.length; i++) {
    const [id, fn] = defs[i];
    try {
      const detail = await fn();
      steps.push({ path: pathId, step: id, status: "pass", ...(detail ? { detail } : {}) });
    } catch (error) {
      steps.push({ path: pathId, step: id, status: "fail", detail: String(error?.message ?? error) });
      for (const [rest] of defs.slice(i + 1)) steps.push({ path: pathId, step: rest, status: "skipped" });
      break;
    }
  }
  return { path: pathId, status: steps.every((s) => s.status === "pass") ? "pass" : "fail", steps };
}

function expect(condition, detail) {
  if (!condition) throw new Error(detail);
}

// --- Windows install and first launch -------------------------------------
// The install itself is manual (GUI, SmartScreen); the harness asserts every
// checklist item maps to a shipped artifact or workflow behavior.
async function windowsInstall() {
  return execute("windows-install", [
    ["installer-artifacts", async () => {
      const iss = await readFile(join(ROOT, "scripts/windows-installer.iss"), "utf8");
      expect(/^AppId=/m.test(iss), "installer script must pin an AppId");
      expect(iss.includes("Start nowplaying when I sign in"), "installer must offer the sign-in startup task");
      expect(/Check: NeedsSetup/.test(iss), "installer must launch first-run setup when setup is needed");
      for (const script of ["build-windows.ps1", "windows-launcher.cs", "windows-tray.ps1", "windows-setup.ps1"])
        await readFile(join(ROOT, "scripts", script), "utf8");
    }],
    ["checksums-published", async () => {
      const release = await readFile(join(ROOT, ".github/workflows/release.yml"), "utf8");
      expect(/sha256sum[^\n]*windows-x64-setup\.exe/.test(release), "release must checksum the Windows setup exe");
      expect(/release upload[^\n]*SHA256SUMS/.test(release), "release must upload SHA256SUMS alongside the assets");
    }],
    ["unsigned-build-guidance", async () => {
      const guide = await readFile(join(ROOT, "docs/testing-dev-build.md"), "utf8");
      expect(/SmartScreen/i.test(guide), "dev-build guide must explain the unsigned-build SmartScreen prompt");
      const beta = await readFile(join(ROOT, ".github/workflows/beta.yml"), "utf8");
      expect(/unsigned/i.test(beta) && /SHA256SUMS/.test(beta), "dev-build release notes must label unsigned assets and point at SHA256SUMS");
    }],
    ["first-run-wizard", async () => {
      const iss = await readFile(join(ROOT, "scripts/windows-installer.iss"), "utf8");
      expect(/Parameters: "start"; .*Check: NeedsSetup/.test(iss), "first launch must open the wizard, not the tray-only start");
      await readFile(join(ROOT, "src/first-run.js"), "utf8");
    }],
  ]);
}

// --- Provider connect (Plex against a local probe) -------------------------
const PLEX_TOKEN = "fixture-token";
async function plexProbe() {
  const sessions = { MediaContainer: { Metadata: [
    { title: "Arrival", type: "movie", year: 2016, viewOffset: 5, duration: 10,
      thumb: "/library/metadata/1/thumb", User: { username: "Rowan" }, Player: { state: "paused" } },
  ] } };
  const hits = [];
  const server = createHttpServer((req, res) => {
    hits.push({ url: req.url, token: req.headers["x-plex-token"] ?? null });
    const json = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers["x-plex-token"] !== PLEX_TOKEN) return json(401, { errors: [{ code: 1001, message: "unauthorized" }] });
    if (req.url === "/status/sessions") return json(200, sessions);
    if (req.url === "/accounts") return json(200, { MediaContainer: { Account: [{ id: "1" }] } });
    return json(404, {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { hits, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

async function providerConnect() {
  const probe = await plexProbe();
  try {
    return await execute("provider-connect", [
      ["probe-connect", async () => {
        const provider = createPlexProvider({ baseUrl: probe.baseUrl, token: PLEX_TOKEN });
        const presence = await provider.getPresence({ username: "rowan" });
        expect(presence.kind === "movie" && presence.state === "paused" && presence.title === "Arrival",
          `unexpected presence mapping: ${JSON.stringify(presence)}`);
        expect(probe.hits[0]?.url === "/status/sessions", "provider must poll /status/sessions");
      }],
      ["server-url-shape", async () => {
        const provider = createPlexProvider({ baseUrl: `${probe.baseUrl}/`, token: PLEX_TOKEN });
        const presence = await provider.getPresence({ username: "rowan" });
        expect(presence.title === "Arrival", "a trailing-slash server URL must connect identically");
      }],
      ["bad-token-rejected", async () => {
        const provider = createPlexProvider({ baseUrl: probe.baseUrl, token: "wrong-token" });
        let error;
        try { await provider.getPresence({ username: "rowan" }); } catch (caught) { error = caught; }
        expect(error?.status === 401, `a wrong token must surface the server 401, got: ${error?.message ?? "no error"}`);
      }],
    ]);
  } finally {
    await probe.close();
  }
}

// --- Discord Rich Presence visibility --------------------------------------
// A fake Discord desktop client on a local IPC endpoint records every frame.
const DISCORD_APP_ID = "123456789012345678";
async function fakeDiscord() {
  const dir = await mkdtemp(join(tmpdir(), "np-guide-ipc-"));
  const path = join(dir, "discord-ipc-0");
  const frames = [];
  const sockets = new Set();
  const server = createIpcServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeFrames(buffer);
      buffer = decoded.rest;
      for (const frame of decoded.frames) {
        frames.push(frame);
        if (frame.op === OP.HANDSHAKE)
          socket.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
        if (frame.op === OP.FRAME)
          socket.write(encodeFrame(OP.FRAME, { cmd: frame.payload.cmd, nonce: frame.payload.nonce, data: {} }));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(path, resolve));
  return {
    path, frames,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((r) => server.close(r)); },
  };
}

async function discordRichPresence() {
  const discord = await fakeDiscord();
  const client = createDiscordIpcClient({ paths: [discord.path] });
  try {
    return await execute("discord-rich-presence", [
      ["ipc-handshake", async () => {
        await client.login({ clientId: DISCORD_APP_ID });
        expect(discord.frames[0]?.op === OP.HANDSHAKE && discord.frames[0]?.payload?.client_id === DISCORD_APP_ID,
          "the client must handshake with the configured application ID");
      }],
      ["music-visibility", async () => {
        await client.setActivity({ type: "listening", details: "Holocene", state: "Bon Iver", startTimestamp: 1_700_000_000 });
        const activity = discord.frames.at(-1)?.payload?.args?.activity;
        expect(activity?.type === 2 && activity.details === "Holocene" && activity.state === "Bon Iver",
          `music presence must be visible to Discord, sent: ${JSON.stringify(activity)}`);
        expect(activity?.timestamps?.start === 1_700_000_000_000, "elapsed-time timestamp must reach Discord");
      }],
      ["episode-and-movie-visibility", async () => {
        await client.setActivity({ type: "watching", details: "Lost S4E5", state: "The Constant" });
        let activity = discord.frames.at(-1)?.payload?.args?.activity;
        expect(activity?.type === 3 && activity.details === "Lost S4E5", `episode presence mismatch: ${JSON.stringify(activity)}`);
        await client.setActivity({ type: "watching", details: "Spirited Away", state: "2001" });
        activity = discord.frames.at(-1)?.payload?.args?.activity;
        expect(activity?.type === 3 && activity.details === "Spirited Away", `movie presence mismatch: ${JSON.stringify(activity)}`);
      }],
      ["not-running-guidance", async () => {
        const offline = createDiscordIpcClient({ paths: [join(discord.path + "-missing")], timeoutMs: 500 });
        let error;
        try { await offline.login({ clientId: DISCORD_APP_ID }); } catch (caught) { error = caught; }
        expect(/Discord is not running/.test(String(error?.message)), `expected desktop-required guidance, got: ${error?.message ?? "no error"}`);
      }],
    ]);
  } finally {
    await client.destroy().catch(() => {});
    await discord.close();
  }
}

// --- Hosted SVG card render -------------------------------------------------
async function hostedCard() {
  return execute("hosted-card", [
    ["render-all-states", async () => {
      for (const example of EXAMPLES) {
        const svg = renderCard(example.presence, example.options);
        expect(svg.includes("<svg"), `${example.file}: output is not an SVG`);
        expect(svg.includes(example.presence.title), `${example.file}: rendered card must show the media title`);
      }
      return `${EXAMPLES.length} documented states render`;
    }],
    ["deterministic-output", async () => {
      const { presence, options } = EXAMPLES[0];
      expect(renderCard(presence, options) === renderCard(presence, options), "the same presence must render byte-identical SVG");
    }],
    ["gallery-in-sync", async () => {
      for (const example of EXAMPLES) {
        const committed = await readFile(join(ROOT, "docs/assets/cards", example.file), "utf8");
        expect(committed === renderCard(example.presence, example.options),
          `${example.file}: committed gallery SVG has drifted from the shipped renderer`);
      }
    }],
    ["no-secrets-in-markup", async () => {
      for (const example of EXAMPLES)
        expect(!/token|password|secret/i.test(renderCard(example.presence, example.options)),
          `${example.file}: card markup must never embed credentials`);
    }],
  ]);
}

export const PATHS = [
  { id: "windows-install", title: "Windows install and first launch", run: windowsInstall },
  { id: "provider-connect", title: "Provider connect (Plex)", run: providerConnect },
  { id: "discord-rich-presence", title: "Discord Rich Presence visibility", run: discordRichPresence },
  { id: "hosted-card", title: "Hosted SVG card render", run: hostedCard },
];

export async function runPath(id) {
  const path = PATHS.find((candidate) => candidate.id === id);
  if (!path) throw new Error(`unknown guide path: ${id}`);
  return path.run();
}

// The skeleton claims a status per path and lists every harness step; both
// must match a fresh run or the doc is drifting from shipped behavior.
export async function checkDocs(docFile = DEFAULT_DOC) {
  const doc = await readFile(docFile, "utf8");
  const failures = [];
  for (const { id } of PATHS) {
    if (!doc.includes(`<!-- guide-path: ${id} -->`)) {
      failures.push(`${id}: missing guide-path marker`);
      continue;
    }
    const claimed = doc.match(new RegExp(`<!-- guide-path: ${id} -->[^]*?Harness status: \\*\\*(pass|fail)\\*\\*`));
    if (!claimed) {
      failures.push(`${id}: missing harness status line`);
      continue;
    }
    const result = await runPath(id);
    if (claimed[1] !== result.status)
      failures.push(`${id}: doc claims ${claimed[1]} but a fresh run reports ${result.status}`);
    for (const step of result.steps)
      if (!doc.includes(`harness step: ${step.step}`)) failures.push(`${id}: doc never mentions harness step ${step.step}`);
  }
  return { status: failures.length ? "fail" : "pass", failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, arg] = process.argv.slice(2);
  if (command === "list") {
    for (const { id, title } of PATHS) console.log(JSON.stringify({ path: id, title }));
  } else if (command === "run") {
    const targets = arg === "--all" ? PATHS.map(({ id }) => id) : [arg];
    let failed = false;
    for (const id of targets) {
      const result = await runPath(id);
      for (const step of result.steps) console.log(JSON.stringify(step));
      console.log(JSON.stringify({ path: result.path, status: result.status,
        passed: result.steps.filter((s) => s.status === "pass").length,
        failed: result.steps.filter((s) => s.status === "fail").length }));
      if (result.status !== "pass") failed = true;
    }
    if (failed) process.exitCode = 1;
  } else if (command === "check-docs") {
    const result = await checkDocs(arg);
    console.log(JSON.stringify(result));
    if (result.status !== "pass") process.exitCode = 1;
  } else {
    console.error("usage: guide-paths.js list | run <path-id|--all> | check-docs [file]");
    process.exitCode = 2;
  }
}
