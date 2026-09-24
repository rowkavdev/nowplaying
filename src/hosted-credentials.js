// Keeps the hosted card device registration in
// the OS credential store (Windows Credential Manager in the app), next to the
// media-server sign-in. Never written to config.json.

const SERVICE = "nowplaying";
const ACCOUNT = "hosted:device";
const ID = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// Either an anonymous per-PC card ({ cardId, deviceId, token }) or a PC
// signed in with GitHub ({ login, deviceId, token }, #140).
function valid(value) {
  if (!value || typeof value !== "object" || !ID.test(value.deviceId) || !TOKEN.test(value.token)) return false;
  return LOGIN.test(value.login ?? "") || ID.test(value.cardId ?? "");
}
function pick(value) {
  return LOGIN.test(value.login ?? "") ? { login: value.login, deviceId: value.deviceId, token: value.token } : { cardId: value.cardId, deviceId: value.deviceId, token: value.token };
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
      return valid(parsed) ? Object.freeze(pick(parsed)) : null;
    },
    async save(value) {
      if (!valid(value)) throw new TypeError("hosted registration is invalid");
      await adapter.setPassword(SERVICE, ACCOUNT, JSON.stringify(pick(value)));
    },
    async clear() {
      await adapter.deletePassword(SERVICE, ACCOUNT);
    },
  });
}
