import test from "node:test";
import assert from "node:assert/strict";
import { createCardHandler, parseCardQuery } from "../src/http-handler.js";

const query = (value) => parseCardQuery(new URLSearchParams(value));

test("accepts bounded public card options", () => {
  assert.deepEqual(query("theme=paper&width=560&show=state,progress"), {
    theme: "paper",
    width: 560,
    show: { artwork: false, mediaType: false, progress: true, state: true, subtitle: false },
  });
});

test("rejects unknown, duplicate and invalid values", () => {
  for (const value of ["debug=true", "theme=paper&theme=compact", "theme=x", "width=027", "width=801", "show=state,state", "show=title"]) {
    assert.throws(() => query(value), { message: "invalid card query" });
  }
});

test("passes parsed options to the resolver and returns a generic 400", async () => {
  let received;
  const handler = createCardHandler({ resolveCard: async (options) => { received = options; return "<svg></svg>"; } });
  assert.equal((await handler({ url: "/card.svg?width=320&show=artwork" })).status, 200);
  assert.deepEqual(received, { width: 320, show: { artwork: true, mediaType: false, progress: false, state: false, subtitle: false } });
  assert.deepEqual(await handler({ url: "/card.svg?width=999" }), { status: 400, headers: {}, body: "Invalid card query" });
});
