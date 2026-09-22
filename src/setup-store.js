import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createSetupConfig, serializeSetupConfig } from "./setup-config.js";

export function createSetupStore({ file } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("setup store.file is required");

  async function save(input) {
    const config = createSetupConfig(input);
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, serializeSetupConfig(input), { mode: 0o600 });
    await rename(temporary, file);
    return config;
  }

  async function load() {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function reset() {
    await rm(`${file}.tmp`, { force: true });
    await rm(file, { force: true });
  }

  return Object.freeze({ save, load, reset });
}
