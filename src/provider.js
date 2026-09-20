import { createPresence } from "./presence.js";

export function defineProvider({ id, getPresence }) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new TypeError("Provider id must be a lowercase slug");
  }
  if (typeof getPresence !== "function") {
    throw new TypeError("Provider getPresence must be a function");
  }

  return Object.freeze({
    id,
    async getPresence(context = {}) {
      const result = await getPresence(context);
      return createPresence(result);
    },
  });
}
