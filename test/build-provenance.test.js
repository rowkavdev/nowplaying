import test from "node:test";
import assert from "node:assert/strict";
import { createBuildProvenance, formatBuildProvenance } from "../src/build-provenance.js";

const VALID = Object.freeze({
  version: "0.2.1-beta.7",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  buildTime: "2026-09-22T15:30:00.000Z",
  channel: "beta",
  signed: false,
});

test("validates and freezes exact packaged provenance", () => {
  const result = createBuildProvenance(VALID);
  assert.deepEqual(result, VALID);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.channel = "stable"; }, TypeError);
});

test("supports every known package channel and explicit signature state", () => {
  for (const channel of ["stable", "beta", "development"]) {
    for (const signed of [true, false]) {
      const result = formatBuildProvenance({ ...VALID, version: channel === "stable" ? "0.2.0" : VALID.version, channel, signed });
      assert.equal(result.channel, channel);
      assert.equal(result.signature, signed ? "signed" : "unsigned");
    }
  }
});

test("normalizes the commit and channel without changing artifact identity", () => {
  const result = createBuildProvenance({ ...VALID, commitSha: VALID.commitSha.toUpperCase(), channel: "BETA" });
  assert.equal(result.commitSha, VALID.commitSha);
  assert.equal(result.channel, "beta");
});

test("rejects missing fields", () => {
  for (const field of Object.keys(VALID)) {
    const fixture = { ...VALID };
    delete fixture[field];
    assert.throws(() => createBuildProvenance(fixture), /build provenance/, field);
  }
  assert.throws(() => createBuildProvenance(), /required/);
});

test("rejects malformed semantic versions", () => {
  for (const version of ["v0.2.0", "0.2", "01.2.0", "0.2.0+build", "0.2.0-"]) {
    assert.throws(() => createBuildProvenance({ ...VALID, version }), /version is invalid/, version);
  }
});

test("rejects abbreviated or non-hex commits", () => {
  for (const commitSha of ["0123456", "g".repeat(40), `${VALID.commitSha}0`, ""]) {
    assert.throws(() => createBuildProvenance({ ...VALID, commitSha }), /commitSha/, commitSha);
  }
});

test("rejects non-canonical, invalid and local build times", () => {
  for (const buildTime of ["2026-09-22", "2026-09-22T15:30:00Z", "2026-09-22T16:30:00.000+01:00", "not-a-date"]) {
    assert.throws(() => createBuildProvenance({ ...VALID, buildTime }), /buildTime is invalid/, buildTime);
  }
});

test("rejects unknown channels and inferred signature labels", () => {
  assert.throws(() => createBuildProvenance({ ...VALID, channel: "nightly" }), /channel is invalid/);
  for (const signed of ["unsigned", 0, null]) assert.throws(() => createBuildProvenance({ ...VALID, signed }), /signed is invalid/);
});

test("rejects whitespace and unrelated input is not reflected", () => {
  assert.throws(() => createBuildProvenance({ ...VALID, version: ` ${VALID.version}` }), /version is required/);
  const result = createBuildProvenance({ ...VALID, privateUrl: "https://private.invalid", token: "secret" });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private"), false);
  assert.equal(serialized.includes("secret"), false);
});
