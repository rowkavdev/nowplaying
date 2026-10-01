import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { createSetupDraft, serializeSetupDraft } from "./setup.js";

const MAX_DRAFT_BYTES = 4096;

export function createSetupDraftStore({ file } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("setup draft store.file is required");

  let transactionTail = Promise.resolve();
  let ioTail = Promise.resolve();
  function queue(operation, transactional = false) {
    const turn = (transactional ? transactionTail : ioTail).then(operation);
    const settled = turn.then(() => {}, () => {});
    if (transactional) transactionTail = settled;
    else ioTail = settled;
    return turn;
  }
  // The transaction queue owns read/merge/write; the separate I/O queue also
  // protects direct calls without deadlocking calls made inside transactions.
  const transaction = operation => queue(operation, true);

  async function save(draft) {
    const body = serializeSetupDraft(draft);
    if (Buffer.byteLength(body) > MAX_DRAFT_BYTES) throw new RangeError("setup draft is too large");
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${body}\n`, { mode: 0o600 });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
    return createSetupDraft(JSON.parse(body));
  }

  async function load() {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return Object.freeze({ draft: createSetupDraft(), resumed: false, discarded: false });
      throw error;
    }
    try {
      // save() limits the serialized body and then appends one newline, so the
      // cap applies to the body here too.
      if (Buffer.byteLength(text.endsWith("\n") ? text.slice(0, -1) : text) > MAX_DRAFT_BYTES) throw new RangeError("too large");
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1) throw new TypeError("unsupported draft");
      const { version, ...fields } = parsed;
      return Object.freeze({ draft: createSetupDraft(fields), resumed: true, discarded: false });
    } catch {
      await clear();
      return Object.freeze({ draft: createSetupDraft(), resumed: false, discarded: true });
    }
  }

  async function clear() {
    await rm(`${file}.tmp`, { force: true });
    await rm(file, { force: true });
  }

  return Object.freeze({ file, transaction, save: draft => queue(() => save(draft)), load: () => queue(load), clear: () => queue(clear) });
}
