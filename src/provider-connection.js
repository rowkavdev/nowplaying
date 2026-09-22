const PROVIDERS = Object.freeze({
  plex: Object.freeze({ required: Object.freeze(["baseUrl", "token"]), userField: "username" }),
  jellyfin: Object.freeze({ required: Object.freeze(["baseUrl", "apiKey"]), userField: "username" }),
  emby: Object.freeze({ required: Object.freeze(["baseUrl", "apiKey"]), userField: "username" }),
  navidrome: Object.freeze({ required: Object.freeze(["baseUrl", "username", "token", "salt"]), userField: "username" }),
});

/** Validate first-run provider settings without copying any configured value. */
export function validateProviderConnectionConfig(config) {
  const provider = normalizedProvider(config?.provider);
  if (!provider) return result("configuration", null, ["provider"]);
  const contract = PROVIDERS[provider];
  const missingFields = contract.required.filter((field) => !hasValue(config?.[field]));
  if (missingFields.length) return result("configuration", provider, missingFields);
  return Object.freeze({ ok: true, stage: "configuration", provider, missingFields: Object.freeze([]), userSelection: Object.freeze({ supported: true, configured: hasValue(config?.[contract.userField]) }) });
}

export function providerConnectionContract(provider) {
  const id = normalizedProvider(provider);
  if (!id) return null;
  const contract = PROVIDERS[id];
  return Object.freeze({ provider: id, requiredFields: contract.required, userSelection: Object.freeze({ supported: true, field: contract.userField }) });
}

function result(stage, provider, missingFields) {
  return Object.freeze({ ok: false, stage, provider, missingFields: Object.freeze([...missingFields]), userSelection: Object.freeze({ supported: provider !== null, configured: false }) });
}

function normalizedProvider(value) {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return Object.hasOwn(PROVIDERS, id) ? id : null;
}

function hasValue(value) { return typeof value === "string" && value.trim().length > 0; }
