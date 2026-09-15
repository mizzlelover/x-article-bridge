import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const context = {};
runInNewContext(`${readFileSync(new URL("../src/placement.js", import.meta.url), "utf8")}\nthis.api = { markerBlockOrder };`, context);
const { markerBlockOrder } = context.api;

test("markerBlockOrder moves an asynchronously appended media block to its marker", () => {
  assert.deepEqual(
    Array.from(markerBlockOrder(["p1", "p2", "media", "p3"], "p2", "media", true)),
    ["p1", "media", "p3"]
  );
});
