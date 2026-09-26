import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createAnalyticsStore({ file, salt } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("file: expected a path");
  if (typeof salt !== "string" || salt.length < 16) throw new TypeError("salt: expected at least 16 characters");
  let queue = Promise.resolve();

  async function record(kind, installationId) {
    if (!["card", "discord"].includes(kind)) throw new TypeError("kind: expected card or discord");
    if (typeof installationId !== "string" || installationId.length < 16 || installationId.length > 128) throw new TypeError("installationId: expected 16-128 characters");
    const id = createHash("sha256").update(`${salt}\0${installationId}`).digest("hex");
    const write = queue.then(async () => {
      const data = await load(file);
      data[`${kind}s`] += 1;
      if (!data.installations.includes(id)) data.installations.push(id);
      if (!data[`${kind}Installations`].includes(id)) data[`${kind}Installations`].push(id);
      await save(file, data);
    });
    // Each caller sees its own failure, but a failed write must not poison
    // later records or reads. The next operation reloads the file from disk.
    queue = write.catch(() => {});
    await write;
  }

  async function stats() {
    await queue;
    const data = await load(file);
    return Object.freeze({
      users: data.installations.length,
      cardsGenerated: data.cards,
      cardUsers: data.cardInstallations.length,
      discordEvents: data.discords,
      discordUsers: data.discordInstallations.length,
    });
  }
  return Object.freeze({ recordCard: (id) => record("card", id), recordDiscord: (id) => record("discord", id), stats });
}

async function load(file) {
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    if (data?.version !== 1) throw new Error("unsupported analytics format");
    return data;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, cards: 0, discords: 0, installations: [], cardInstallations: [], discordInstallations: [] };
  }
}
async function save(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}
