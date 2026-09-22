import test from "node:test";
import assert from "node:assert/strict";
import { createProviderIdentity, resolveProviderIdentity } from "../src/provider-identity.js";

test("normalizes a provider-stable identity and display label", () => {
  assert.deepEqual(createProviderIdentity({ id: " user-42 ", displayName: " Rowan " }), {
    id: "user-42",
    displayName: "Rowan",
  });
});

test("keeps following a stable identity after its display name changes", () => {
  const result = resolveProviderIdentity([
    { id: "user-42", displayName: "New Rowan" },
    { id: "user-84", displayName: "Other" },
  ], { id: "user-42", displayName: "Old Rowan" });

  assert.deepEqual(result, {
    ok: true,
    status: "identity_resolved",
    identity: { id: "user-42", displayName: "New Rowan" },
  });
});

test("requires an explicit choice when display names are ambiguous", () => {
  assert.deepEqual(resolveProviderIdentity([
    { id: "parent", displayName: "Rowan" },
    { id: "managed", displayName: "Rowan" },
  ], { displayName: "Rowan" }), {
    ok: false,
    status: "identity_ambiguous",
    identity: null,
  });
});

test("reports a missing saved identity without exposing other users", () => {
  assert.deepEqual(resolveProviderIdentity([
    { id: "other-user", displayName: "Someone else" },
  ], { id: "deleted-user" }), {
    ok: false,
    status: "identity_missing",
    identity: null,
  });
});

test("validates provider identity input", () => {
  assert.throws(() => createProviderIdentity({ id: "", displayName: "Rowan" }), /identity.id is required/);
  assert.throws(() => resolveProviderIdentity(null, {}), /candidates must be an array/);
});
