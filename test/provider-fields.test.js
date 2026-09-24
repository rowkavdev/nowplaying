import test from "node:test";
import assert from "node:assert/strict";
import { optionalCount, optionalText, optionalYear } from "../src/providers/fields.js";

test("provider field readers accept clean values and numeric strings", () => {
  assert.equal(optionalText(" Lost "), "Lost");
  assert.equal(optionalCount("05"), 5);
  assert.equal(optionalCount(0), 0);
  assert.equal(optionalYear("2016"), 2016);
});

test("provider field readers drop anything else as null", () => {
  for (const value of [undefined, null, "", "  ", 3, {}]) assert.equal(optionalText(value), null);
  for (const value of [undefined, -1, 1.5, 10000, "4a", "", NaN]) assert.equal(optionalCount(value), null);
  for (const value of [undefined, 1799, 2201, "20x6", 2016.5]) assert.equal(optionalYear(value), null);
});
