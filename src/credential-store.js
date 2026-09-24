// "spotify" holds the Spotify refresh token (#135).
const PROVIDERS = new Set(["plex", "jellyfin", "navidrome", "emby", "spotify"]);

function credentialTarget(input = {}) {
  if (!PROVIDERS.has(input.provider)) throw new TypeError("credential.provider is invalid");
  if (typeof input.identityId !== "string" || !input.identityId.trim()) {
    throw new TypeError("credential.identityId is required");
  }
  return Object.freeze({
    service: "nowplaying",
    account: `${input.provider}:${input.identityId.trim()}`,
  });
}

function assertAdapter(adapter) {
  for (const method of ["setPassword", "getPassword", "deletePassword"]) {
    if (typeof adapter?.[method] !== "function") throw new TypeError(`credential adapter.${method} is required`);
  }
}

export function createCredentialStore({ adapter } = {}) {
  assertAdapter(adapter);
  return Object.freeze({
    async save(input, secret) {
      if (typeof secret !== "string" || !secret) throw new TypeError("credential secret is required");
      const target = credentialTarget(input);
      await adapter.setPassword(target.service, target.account, secret);
      return Object.freeze({ provider: input.provider, identityId: input.identityId.trim(), stored: true });
    },
    async read(input) {
      const target = credentialTarget(input);
      return adapter.getPassword(target.service, target.account);
    },
    async remove(input) {
      const target = credentialTarget(input);
      return Boolean(await adapter.deletePassword(target.service, target.account));
    },
  });
}
