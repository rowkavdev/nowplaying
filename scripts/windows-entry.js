import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const command = process.argv[2] ?? "help";

if (command === "--version" || command === "version") {
  const manifest = JSON.parse(await readFile(resolve("app", "package.json"), "utf8"));
  console.log(manifest.version);
} else if (command === "start") {
  const configPath = resolve(process.argv[3] ?? "nowplaying.config.mjs");
  const config = (await import(pathToFileURL(configPath).href)).default;
  if (!config || typeof config.start !== "function") throw new TypeError("config default export must provide start()");
  const app = await config.start();
  if (!app || typeof app.close !== "function") throw new TypeError("config start() must return an app with close()");
  const close = async () => { await app.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} else if (command === "help" || command === "--help") {
  console.log("Usage: nowplaying.exe start [config.mjs]\n       nowplaying.exe --version\n       nowplaying.exe --help");
} else {
  console.error(`nowplaying: unknown command: ${command}`);
  process.exitCode = 2;
}
