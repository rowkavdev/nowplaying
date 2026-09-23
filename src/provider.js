import { createPresence } from "./presence.js";

export function defineProvider({ id, getPresence, whoami }) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new TypeError("Provider id must be a lowercase slug");
  }
  if (typeof getPresence !== "function") {
    throw new TypeError("Provider getPresence must be a function");
  }

  if (whoami !== undefined && typeof whoami !== "function") {
    throw new TypeError("Provider whoami must be a function when set");
  }

  return Object.freeze({
    id,
    async getPresence(context = {}) {
      const result = await getPresence(context);
      return createPresence(result);
    },
    // Optional: which user the server says the saved sign-in belongs to,
    // as { id, displayName }. Used by setup to catch user mismatches.
    ...(whoami ? { whoami } : {}),
  });
}
