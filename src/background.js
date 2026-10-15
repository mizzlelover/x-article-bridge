chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'ensureMainBridge') return;
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || !/^https:\/\/(?:x|twitter)\.com\/compose\/articles(?:\/|\?|$)/.test(sender.tab?.url || '')) {
    sendResponse({ok: false, error: '请在 X Article 编辑器内恢复通信'});
    return;
  }
  chrome.scripting.executeScript({target: {tabId}, files: ['src/placement.js', 'src/main-world.js'], world: 'MAIN'})
    .then(() => sendResponse({ok: true, bridgeVersion: '0.1.16'}))
    .catch(error => sendResponse({ok: false, error: `X 页面通信恢复失败：${error.message}`}));
  return true;
});
