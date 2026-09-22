import test from "node:test";
import assert from "node:assert/strict";
import { providerConnectionContract, validateProviderConnectionConfig } from "../src/provider-connection.js";

const CASES = Object.freeze({
  plex: { requiredFields: ["baseUrl", "token"], complete: { baseUrl: "https://plex.invalid", token: "plex-secret" } },
  jellyfin: { requiredFields: ["baseUrl", "apiKey"], complete: { baseUrl: "https://jellyfin.invalid", apiKey: "jf-secret" } },
  emby: { requiredFields: ["baseUrl", "apiKey"], complete: { baseUrl: "https://emby.invalid", apiKey: "emby-secret" } },
  navidrome: { requiredFields: ["baseUrl", "username", "token", "salt"], complete: { baseUrl: "https://navidrome.invalid", username: "alice", token: "nav-secret", salt: "salt-secret" } },
});

for (const [provider, fixture] of Object.entries(CASES)) {
  test(`${provider} declares its first-run contract`, () => {
    assert.deepEqual(providerConnectionContract(provider), { provider, requiredFields: fixture.requiredFields, userSelection: { supported: true, field: "username" } });
  });

  test(`${provider} reports only missing field names`, () => {
    const result = validateProviderConnectionConfig({ provider });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "configuration");
    assert.equal(result.provider, provider);
    assert.deepEqual(result.missingFields, fixture.requiredFields);
    assert.doesNotMatch(JSON.stringify(result), /invalid|secret|https?:/i);
  });

  test(`${provider} accepts complete setup without echoing private values`, () => {
    const result = validateProviderConnectionConfig({ provider, ...fixture.complete });
    assert.deepEqual(result.missingFields, []);
    assert.equal(result.ok, true);
    assert.equal(result.userSelection.supported, true);
    assert.equal(result.userSelection.configured, provider === "navidrome");
    const serialized = JSON.stringify(result);
    for (const value of Object.values(fixture.complete)) assert.equal(serialized.includes(value), false, value);
  });
}

test("Plex, Jellyfin and Emby expose optional first-run user selection", () => {
  for (const provider of ["plex", "jellyfin", "emby"]) {
    const result = validateProviderConnectionConfig({ provider, ...CASES[provider].complete, username: "alice" });
    assert.equal(result.userSelection.configured, true);
    assert.equal(JSON.stringify(result).includes("alice"), false);
  }
});

test("unknown and absent providers fail without reflecting input", () => {
  for (const provider of [undefined, "spotify", "https://private.invalid"]) {
    const result = validateProviderConnectionConfig({ provider, token: "secret" });
    assert.deepEqual(result, { ok: false, stage: "configuration", provider: null, missingFields: ["provider"], userSelection: { supported: false, configured: false } });
    assert.equal(providerConnectionContract(provider), null);
  }
});

test("provider IDs are normalized but field values must be non-empty strings", () => {
  const result = validateProviderConnectionConfig({ provider: " PLEX ", baseUrl: "  ", token: 42 });
  assert.equal(result.provider, "plex");
  assert.deepEqual(result.missingFields, ["baseUrl", "token"]);
});
