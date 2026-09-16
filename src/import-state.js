function createImportGate() {
  let activeToken = null;

  return {
    begin() {
      if (activeToken) throw new Error("上一份文章仍在导入，请等待完成");
      activeToken = {};
      return activeToken;
    },
    assert(token) {
      if (!activeToken || activeToken !== token) throw new Error("导入上下文已失效，请重新导入");
    },
    end(token) {
      if (activeToken === token) activeToken = null;
    }
  };
}

function createImportRetryState({articleUrl, root, fileName, parsed, images}) {
  return {
    articleUrl,
    root,
    fileName,
    parsed,
    images,
    nextIndex: 0,
    failedIndex: null,
    completedCount: 0,
    remainingIndexes: parsed.assets.map((_, index) => index),
    error: null
  };
}

function markImportAssetComplete(state, index) {
  if (index !== state.nextIndex) throw new Error("导入图片顺序已失效，请重新导入");
  state.nextIndex = index + 1;
  state.completedCount = state.nextIndex;
  state.failedIndex = null;
  state.error = null;
  state.remainingIndexes = state.parsed.assets
    .map((_, assetIndex) => assetIndex)
    .filter((assetIndex) => assetIndex >= state.nextIndex);
  return state;
}

function markImportAssetFailure(state, index, error) {
  if (index < state.nextIndex || index >= state.parsed.assets.length) {
    throw new Error("失败图片索引已失效，请重新导入");
  }
  state.failedIndex = index;
  state.error = error;
  state.remainingIndexes = state.parsed.assets
    .map((_, assetIndex) => assetIndex)
    .filter((assetIndex) => assetIndex >= index);
  return state;
}
