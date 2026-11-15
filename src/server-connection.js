import { createHash } from "node:crypto";
import { normalizeServerUrl } from "./provider-signin.js";

export function serverAccountKey({ provider, identity, serverUrl }) {
  return JSON.stringify([provider, identity.id, serverUrl ? normalizeServerUrl(serverUrl) : null]);
}

export function serverCredentialRef(server) {
  const { provider, identity, serverUrl } = server;
  const identityId = serverUrl
    ? "server:" + createHash("sha256").update(serverAccountKey(server)).digest("base64url")
    : identity.id;
  return { provider, identityId };
}
