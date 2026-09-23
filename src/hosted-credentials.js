// Keeps the hosted card device registration ({ cardId, deviceId, token }) in
// the OS credential store (Windows Credential Manager in the app), next to the
// media-server sign-in. Never written to config.json.

const SERVICE = "nowplaying";
const ACCOUNT = "hosted:device";
const ID = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

function valid(value) {
  return Boolean(value && typeof value === "object" && ID.test(value.cardId) && ID.test(value.deviceId) && TOKEN.test(value.token));
}

export function createHostedCredentials({ adapter } = {}) {
  for (const method of ["setPassword", "getPassword", "deletePassword"]) {
    if (typeof adapter?.[method] !== "function") throw new TypeError(`credential adapter.${method} is required`);
  }
  return Object.freeze({
    async load() {
      const raw = await adapter.getPassword(SERVICE, ACCOUNT);
      if (typeof raw !== "string" || !raw) return null;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return null; }
      return valid(parsed) ? Object.freeze({ cardId: parsed.cardId, deviceId: parsed.deviceId, token: parsed.token }) : null;
    },
    async save(value) {
      if (!valid(value)) throw new TypeError("hosted registration is invalid");
      await adapter.setPassword(SERVICE, ACCOUNT, JSON.stringify({ cardId: value.cardId, deviceId: value.deviceId, token: value.token }));
    },
    async clear() {
      await adapter.deletePassword(SERVICE, ACCOUNT);
    },
  });
}
