import test from "node:test";
import assert from "node:assert/strict";
import { createSettings } from "../src/settings.js";
import { renderCard } from "../src/card.js";
import { createPresence } from "../src/presence.js";

test("settings and renderer share the same card width range", () => {
  assert.throws(() => createSettings({ card: { width: 279 } }), /between 280 and 800/);
  const settings = createSettings({ card: { width: 280 } });
  assert.doesNotThrow(() => renderCard(createPresence(), { width: settings.card.width }));
});
