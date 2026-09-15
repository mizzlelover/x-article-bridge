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
