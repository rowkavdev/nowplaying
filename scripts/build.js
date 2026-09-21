import { mkdir, rm, cp, readFile, writeFile } from "node:fs/promises";
import { renderCard, createPresence } from "../src/index.js";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("src", "dist/src", { recursive: true });
await writeFile("dist/card.svg", renderCard(createPresence({
  state: "playing",
  kind: "track",
  title: "Example track",
  subtitle: "Example artist",
  positionMs: 45_000,
  durationMs: 180_000,
  updatedAt: 0,
})));
await writeFile("dist/manifest.json", `${JSON.stringify({ version: packageJson.version, entrypoint: "src/index.js" }, null, 2)}\n`);
