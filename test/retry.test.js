import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/import-state.js", import.meta.url), "utf8");
const context = {};
runInNewContext(`${source}\nthis.api = { createImportRetryState, markImportAssetComplete, markImportAssetFailure };`, context);

test("a failed asset can resume without replacing the already imported body", () => {
  const state = context.api.createImportRetryState({
    articleUrl: "https://x.com/compose/articles/1",
    fileName: "article.md",
    parsed: {assets: [{name: "one.png"}, {name: "two.png"}, {name: "three.png"}]},
    images: ["one", "two", "three"]
  });

  context.api.markImportAssetComplete(state, 0);
  context.api.markImportAssetFailure(state, 1, new Error("X 图片上传失败"));

  assert.equal(state.nextIndex, 1);
  assert.equal(state.failedIndex, 1);
  assert.equal(state.completedCount, 1);
  assert.deepEqual(state.remainingIndexes, [1, 2]);
  assert.equal(state.error.message, "X 图片上传失败");
});
