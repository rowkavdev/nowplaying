function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

export function createProviderIdentity(input = {}) {
  return Object.freeze({
    id: requiredString(input.id, "identity.id"),
    displayName: requiredString(input.displayName, "identity.displayName"),
  });
}

export function resolveProviderIdentity(candidates, selection = {}) {
  if (!Array.isArray(candidates)) throw new TypeError("identity candidates must be an array");
  const identities = candidates.map(createProviderIdentity);
  const selectedId = selection.id?.trim();
  const selectedName = selection.displayName?.trim();

  if (selectedId) {
    const match = identities.find((identity) => identity.id === selectedId);
    if (!match) return Object.freeze({ ok: false, status: "identity_missing", identity: null });
    return Object.freeze({ ok: true, status: "identity_resolved", identity: match });
  }

  if (!selectedName) return Object.freeze({ ok: false, status: "identity_required", identity: null });
  const matches = identities.filter((identity) => identity.displayName.localeCompare(
    selectedName,
    undefined,
    { sensitivity: "accent" },
  ) === 0);

  if (matches.length === 0) return Object.freeze({ ok: false, status: "identity_missing", identity: null });
  if (matches.length > 1) return Object.freeze({ ok: false, status: "identity_ambiguous", identity: null });
  return Object.freeze({ ok: true, status: "identity_resolved", identity: matches[0] });
}
