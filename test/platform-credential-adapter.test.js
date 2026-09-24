import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformCredentialAdapter } from "../src/platform-credential-adapter.js";

test("picks a keychain adapter for each supported OS (#215)", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const adapter = createPlatformCredentialAdapter({ platform });
    for (const method of ["getPassword", "setPassword", "deletePassword"]) assert.equal(typeof adapter[method], "function", `${platform} ${method}`);
  }
});

test("refuses an OS it has no keychain for", () => {
  assert.throws(() => createPlatformCredentialAdapter({ platform: "freebsd" }), /can't store sign-ins on freebsd/);
});
