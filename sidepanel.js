const input = document.getElementById("article-file");
const status = document.getElementById("file-status");
const retryButton = document.getElementById("retry-failed");

function setStatus(text) {
  status.textContent = text;
}

const contentScriptFiles = [
  "src/format.js",
  "src/import-state.js",
  "src/editor.js",
  "src/media.js",
  "src/cover.js",
  "src/content.js"
];
const mainWorldFiles = ["src/placement.js", "src/main-world.js"];

document.getElementById('configure-cover').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if (!tab?.id) throw new Error('请先打开 X Article');
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, {type:'configureCover'});
    setStatus('请在 X 页面右上角选择封面图片。无需重新导入正文。');
  } catch (error) { setStatus(error.message); }
});

retryButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error('请先打开 X Article');
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'retryFailed' });
    if (!response?.ok) throw new Error(response?.error || '当前没有可重试的图片');
    setStatus('已开始重试失败图片，详情看正文右上角状态');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '重试失败');
  }
});

async function ensureContentScript(tabId) {
  let ping = null;
  try {
    ping = await chrome.tabs.sendMessage(tabId, { type: "ping" });
  } catch {
  }
  if (ping) {
    if (ping.ready) return;
    throw new Error("当前标签页不是可用的 X Article 编辑器");
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: contentScriptFiles });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: mainWorldFiles, world: "MAIN" });
  const ready = await chrome.tabs.sendMessage(tabId, { type: "ping" });
  if (!ready?.ready) throw new Error("当前标签页不是可用的 X Article 编辑器");
}

async function sendArticle(file) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("没有找到当前 X Article 标签页");
  await ensureContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, { type: "importArticle", name: file.name, content: await file.text() });
  if (response?.ok === false) throw new Error(response.error || "导入失败");
}

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  if (!/\.(html?|md)$/i.test(file.name)) {
    setStatus("请选择 .html、.htm 或 .md 文件");
    return;
  }
  setStatus(`正在发送：${file.name}`);
  try {
    await sendArticle(file);
    setStatus("已发送到 X 草稿，详情看正文右上角状态");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "发送失败");
  }
});
