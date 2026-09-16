const STATUS_ID = "xab-status-rail";
const importGate = createImportGate();
let coverImages = [];
let coverArticleUrl = '';
let retrySession = null;

function editorRoot() {
  return [...document.querySelectorAll('[contenteditable="true"]')].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 200 && rect.height > 80;
  }) || null;
}

function setStatus(kind, title, detail = "") {
  const rail = document.getElementById(STATUS_ID);
  if (!rail) return;
  rail.dataset.kind = kind;
  rail.querySelector("[data-status-title]").textContent = title;
  rail.querySelector("[data-status-detail]").textContent = detail;
}

function createStatusRail() {
  if (document.getElementById(STATUS_ID)) return;
  const rail = document.createElement("aside");
  rail.id = STATUS_ID;
  rail.setAttribute("role", "status");
  rail.innerHTML = '<strong data-status-title>X Article Bridge</strong><span data-status-detail>拖入 .html 或 .md 文件</span>';
  const close = document.createElement('button');
  close.type = 'button';
  close.id = 'xab-close-status';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭上传悬浮层');
  close.title = '关闭悬浮层（不取消上传）';
  close.addEventListener('click', () => { rail.hidden = true; });
  rail.prepend(close);
  document.body.append(rail);
}

function clearRetryAction() {
  document.getElementById('xab-retry-import')?.remove();
}

function showRetryAction(session) {
  const rail = document.getElementById(STATUS_ID);
  if (!rail || !session) return;
  clearRetryAction();
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.id = 'xab-retry-import';
  retry.textContent = `重试失败图片（${session.remainingIndexes.length} 张）`;
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    try {
      await retryPendingImages();
    } catch {
      retry.disabled = false;
    }
  });
  rail.append(retry);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : '未知错误';
}

function reportImportError(error) {
  if (retrySession) {
    const failed = retrySession.parsed.assets[retrySession.failedIndex ?? retrySession.nextIndex];
    setStatus('error', '导入未完成', `已完成 ${retrySession.completedCount}/${retrySession.parsed.assets.length} 张；${failed?.name || '图片'}失败：${errorMessage(error)}`);
    showRetryAction(retrySession);
    return;
  }
  setStatus('error', '导入失败', errorMessage(error));
}

function setTitle(title) {
  if (!title) return;
  const target = document.querySelector('[aria-label="Add a title"], [placeholder="Add a title"]');
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.value = title;
  else {
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("insertText", false, title);
  }
  target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: title }));
}

function findMarker(root, marker) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const index = node.textContent?.indexOf(marker) ?? -1;
    if (index >= 0) return { node, index };
  }
  return null;
}

function selectMarker(root, marker) {
  const match = findMarker(root, marker);
  if (!match) return false;
  const range = document.createRange();
  range.setStart(match.node, match.index);
  range.setEnd(match.node, match.index + marker.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  root.focus();
  return true;
}

function removeMarker(root, marker) {
  if (!selectMarker(root, marker)) return false;
  document.execCommand("delete");
  return true;
}

function isLocalAsset(source) {
  return !/^(https?:|data:)/i.test(source);
}

function matchLocalAsset(source, files) {
  const normalize = (value) => {
    try { value = decodeURIComponent(value); } catch {}
    return value.replace(/\\/g, "/").replace(/^\.\//, "");
  };
  const path = normalize(source);
  const matches = files.filter((file) => {
    const candidate = normalize(file.webkitRelativePath || file.name);
    return candidate === path || candidate.endsWith(`/${path}`);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`图片路径不唯一，请选择更具体的目录：${source}`);
  const named = files.filter((file) => normalize(file.name) === path.split("/").at(-1));
  if (named.length === 1) return named[0];
  throw new Error(`${named.length ? "图片重名" : "缺少图片"}：${source}`);
}

function chooseLocalAssets(assets) {
  return new Promise((resolve, reject) => {
    setStatus("working", "需要读取 MD 本地图片", `请选择文章图片，或选择包含图片的文件夹（共 ${assets.length} 处引用）`);
    const rail = document.getElementById(STATUS_ID);
    const controls = document.createElement("div");
    const finish = (error, files) => {
      controls.remove();
      if (error) reject(error); else resolve(files);
    };
    for (const directory of [false, true]) {
      const label = document.createElement("label");
      label.textContent = directory ? "选择图片文件夹" : "选择全部图片";
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      if (directory) input.webkitdirectory = true;
      else input.accept = "image/*";
      input.addEventListener("change", () => {
        const files = [...input.files];
        try {
          for (const asset of assets) matchLocalAsset(asset.source, files);
          finish(null, files);
        } catch (error) {
          rail.querySelector("[data-status-detail]").textContent = error.message;
          input.value = "";
        }
      });
      label.append(input);
      controls.append(label);
    }
    const cancel = document.createElement("button");
    cancel.textContent = "取消导入";
    cancel.addEventListener("click", () => finish(new Error("已取消导入，正文未修改")));
    controls.append(cancel);
    rail.append(controls);
  });
}

async function assetFile(asset, localFiles = []) {
  if (isLocalAsset(asset.source)) return matchLocalAsset(asset.source, localFiles);
  if (asset.source.startsWith("data:")) {
    const data = extractDataUrl(asset.source);
    if (!data) throw new Error(`图片数据无效：${asset.name}`);
    return new File([data.bytes], asset.name, { type: data.mime });
  }
  const response = await fetch(asset.source);
  if (!response.ok) throw new Error(`图片读取失败：${asset.name}`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`返回的内容不是图片：${asset.name}`);
  return new File([blob], asset.name, { type: blob.type });
}

async function uploadRemainingImages(session, token) {
  for (let index = session.nextIndex; index < session.parsed.assets.length; index += 1) {
    importGate.assert(token);
    const asset = session.parsed.assets[index];
    session.failedIndex = index;
    setStatus('working', `正在上传图片 ${index + 1}/${session.parsed.assets.length}`, asset.name);
    if (location.href !== session.articleUrl || !session.root.isConnected) {
      throw new Error('文章已切换，已停止导入');
    }
    try {
      const image = session.images[index];
      if (!selectMarker(session.root, asset.marker)) throw new Error(`找不到图片位置：${asset.name}`);
      await uploadFile(image, session.root, asset.marker);
      if (findMarker(session.root, asset.marker)) throw new Error(`图片定位尚未完成：${asset.name}`);
      markImportAssetComplete(session, index);
    } catch (error) {
      markImportAssetFailure(session, index, error);
      throw error;
    }
  }
}

function finishImportedSession(session) {
  retrySession = null;
  clearRetryAction();
  setStatus('done', '已导入 X 草稿', `${session.fileName} · ${session.parsed.assets.length} 张图片`);
  offerCover(session.images);
  coverImages = session.images;
  coverArticleUrl = location.href;
}

async function retryPendingImages() {
  const session = retrySession;
  if (!session) throw new Error('当前没有可重试的图片');
  document.getElementById(STATUS_ID).hidden = false;
  let token = null;
  try {
    token = importGate.begin();
    if (location.href !== session.articleUrl || !session.root.isConnected) {
      throw new Error('文章已切换，请重新导入');
    }
    await uploadRemainingImages(session, token);
    finishImportedSession(session);
  } catch (error) {
    retrySession = session;
    reportImportError(error);
    throw error;
  } finally {
    if (token) importGate.end(token);
  }
}

async function importArticle(file) {
  const root = editorRoot();
  if (!root) throw new Error("没有找到 X Article 正文编辑器");
  let token = null;
  let session = null;
  try {
    token = importGate.begin();
    retrySession = null;
    clearRetryAction();
    document.getElementById(STATUS_ID).hidden = false;
    coverImages = [];
    document.getElementById('xab-cover-options')?.remove();
    setStatus("working", "正在读取文章", file.name);
    const source = typeof file.text === "function" ? await file.text() : file.content;
    importGate.assert(token);
    if (typeof source !== "string") throw new Error("无法读取文章内容");
    const parsed = file.name.toLowerCase().endsWith(".md") ? markdownToHtml(source) : normalizeHtml(source);
    if (!parsed.html) throw new Error("文件没有可导入的正文");
    const articleUrl = location.href;
    const localAssets = parsed.assets.filter((asset) => isLocalAsset(asset.source));
    const localFiles = localAssets.length ? await chooseLocalAssets(localAssets) : [];
    const images = [];
    for (const asset of parsed.assets) {
      const image = await assetFile(asset, localFiles);
      if (!image.size || !image.type.startsWith("image/")) throw new Error(`文件不是有效图片：${asset.name}`);
      try {
        const bitmap = await createImageBitmap(image);
        bitmap.close();
      } catch { throw new Error(`无法解码图片：${asset.name}`); }
      images.push(image);
    }
    if (location.href !== articleUrl || !root.isConnected) throw new Error("文章已切换，请在当前文章重新导入");
    setTitle(parsed.title);
    const bodyResult = await bridgeRequest("replace-body", { html: parsed.html }, 10000);
    if (!bodyResult?.ok) throw new Error(bodyResult?.error || "正文写入失败");
    session = createImportRetryState({ articleUrl, root, fileName: file.name, parsed, images });
    await uploadRemainingImages(session, token);
    finishImportedSession(session);
  } catch (error) {
    if (session) {
      retrySession = session;
    }
    throw error;
  } finally {
    if (token) importGate.end(token);
  }
}

function acceptDrop(event) {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.(html?|md)$/i.test(file.name)) {
    setStatus("error", "不支持的文件", "请拖入 .html、.htm 或 .md");
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  importArticle(file).catch(reportImportError);
}

function boot() {
  createStatusRail();
  document.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  document.addEventListener("drop", acceptDrop, true);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'configureCover') {
      document.getElementById(STATUS_ID).hidden = false;
      offerCover(coverArticleUrl === location.href ? coverImages : []);
      sendResponse({ok:true});
      return;
    }
    if (message.type === 'retryFailed') {
      retryPendingImages()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    }
    if (message.type === "ping") {
      sendResponse({ ready: Boolean(editorRoot()), retryAvailable: Boolean(retrySession) });
      return;
    }
    if (message.type === "importArticle") {
      importArticle(message)
        .then(() => ({ ok: true }))
        .then(sendResponse)
        .catch((error) => {
          const detail = errorMessage(error);
          reportImportError(error);
          sendResponse({ ok: false, error: detail });
        });
      return true;
    }
  });
}

boot();
