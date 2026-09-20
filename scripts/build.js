import { mkdir, rm, cp, writeFile } from "node:fs/promises";
import { renderCard, createPresence } from "../src/index.js";

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
await writeFile("dist/manifest.json", `${JSON.stringify({ builtAt: new Date().toISOString(), entrypoint: "src/index.js" }, null, 2)}\n`);
