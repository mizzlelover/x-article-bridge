function isVisibleElement(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function visibleExactText(text, selector = "[role=menuitem],button") {
  return [...document.querySelectorAll(selector)].find((element) => {
    return isVisibleElement(element) && element.textContent?.trim() === text;
  }) || null;
}

function visibleButtons(text) {
  return [...document.querySelectorAll("button,[role=button]")].filter((button) => {
    return isVisibleElement(button) && button.textContent?.trim() === text;
  });
}

function editorContainer() {
  const root = [...document.querySelectorAll('[contenteditable="true"]')].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 200 && rect.height > 80;
  });
  if (!root) return null;
  let ancestor = root.parentElement;
  while (ancestor && ancestor !== document.body) {
    const hasInsert = [...ancestor.querySelectorAll("button,[role=button]")].some((button) => {
      const label = button.getAttribute?.("aria-label")?.trim();
      return isVisibleElement(button) && (button.textContent?.trim() === "Insert" || label === "Add Media");
    });
    if (hasInsert) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

function mediaInsertButton() {
  const container = editorContainer();
  const insertButton = container && [...container.querySelectorAll("button,[role=button]")].find((button) => {
    return isVisibleElement(button) && button.textContent?.trim() === "Insert";
  });
  const labelledInsert = [...document.querySelectorAll('button[aria-label="Add Media"],[role=button][aria-label="Add Media"]')]
    .filter(isVisibleElement)
    .find((button) => container?.contains(button));
  return insertButton || labelledInsert || visibleButtons("Insert").at(0) || null;
}

function fileInputs() {
  return [...document.querySelectorAll('input[type="file"]')];
}

function articleUploaderContainer(element) {
  let ancestor = element?.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (!isVisibleElement(ancestor)) {
      ancestor = ancestor.parentElement;
      continue;
    }
    const text = ancestor.textContent || "";
    if (/Choose a file or drag it here/i.test(text) && /\bInsert\b/.test(text)) return true;
    if (ancestor.matches?.('[role="dialog"],[aria-modal="true"]') && !/5:2 aspect ratio|We recommend an image/i.test(text)) {
      return true;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

function isArticleMediaInput(input) {
  return Boolean(articleUploaderContainer(input));
}

function mediaFileInput(previousInputs) {
  const inputs = fileInputs();
  const dialogInput = inputs.filter((input) => {
    const dialog = input.closest?.('[role="dialog"]');
    return dialog && isVisibleElement(dialog) && isArticleMediaInput(input);
  }).at(-1) || null;
  if (dialogInput) return dialogInput;
  const articleInput = inputs.filter(isArticleMediaInput).at(-1) || null;
  if (articleInput) return articleInput;
  const newInputs = inputs.filter((input) => !previousInputs.has(input));
  if (newInputs.length === 1) return newInputs[0];
  return null;
}

function inputForMediaControl(control) {
  if (!control) return null;
  const label = control.closest?.("label");
  const labelInput = label?.querySelector?.('input[type="file"]');
  if (labelInput && isArticleMediaInput(labelInput)) return labelInput;
  let ancestor = control.parentElement;
  while (ancestor && ancestor !== document.body) {
    const inputs = [...(ancestor.querySelectorAll?.('input[type="file"]') || [])];
    if (inputs.length === 1 && isArticleMediaInput(inputs[0])) return inputs[0];
    if (ancestor.matches?.('[role="dialog"],[aria-modal="true"]') && inputs.length) {
      return inputs.find(isArticleMediaInput) || null;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

function mediaEditorTitle() {
  return visibleExactText("Edit media", "h1,h2,h3,[role=dialog],div,span");
}

function mediaUploadStatus() {
  return [
    "Uploading media...",
    "Uploading media…",
    "Processing media...",
    "Processing media…"
  ].map((text) => visibleExactText(text, "h1,h2,h3,[role=dialog],div,span"))
    .find(Boolean) || null;
}

function mediaUploadFailure() {
  return [
    "Some of your media failed to upload.",
    "Some media failed to upload.",
    "Media failed to upload."
  ].some((text) => visibleExactText(text, "[role=alert],div,span"));
}

function addPhotosButton() {
  return [...document.querySelectorAll('[aria-label="Add photos or video"]')]
    .filter((control) => isVisibleElement(control) && Boolean(articleUploaderContainer(control)))
    .at(-1) || null;
}

function waitForUi(predicate, message, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const result = predicate();
      if (result) {
        resolve(result);
        return;
      }
      if (Date.now() - startedAt >= timeout) {
        reject(new Error(message));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

function bridgeRequest(kind, payload = {}, timeout = 1200) {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const requestId = `xab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(new Error("X 正文媒体桥接超时"));
    }, timeout);
    const listener = (event) => {
      if (event.source !== window || event.data?.source !== "xab-main" || event.data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(event.data);
    };
    window.addEventListener("message", listener);
    window.postMessage({ source: "xab-bridge", kind, requestId, ...payload }, "*");
  });
}

async function captureNativeUpload() {
  const result = await bridgeRequest("capture-media-baseline").catch(() => null);
  return result?.ok ? result : null;
}

async function relocateNativeUpload(marker, baseline) {
  if (!baseline) return null;
  const result = await bridgeRequest("relocate-native-media", {
    marker,
    beforeKeys: baseline.beforeKeys
  }, 15000);
  if (!result?.ok) throw new Error(result?.error || "X 图片上传后无法定位到正文位置");
  return result;
}

async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function uploadThroughEditorHandler(file, marker) {
  if (!marker || typeof window === "undefined") return null;
  const result = await bridgeRequest("upload-direct-media", {
    marker,
    name: file.name,
    type: file.type,
    base64: await fileBase64(file)
  }, 60000);
  if (!result) return null;
  if (!result.ok) throw new Error(result.error || "X 图片上传失败");
  return result;
}

async function closeMediaEditor() {
  if (!mediaEditorTitle()) return;
  const apply = visibleButtons("Apply").at(-1);
  const close = apply || visibleButtons("Back").at(-1);
  if (!close) throw new Error("找不到 X 图片编辑器的完成按钮");
  close.click();
  await waitForUi(() => !mediaEditorTitle(), "X 图片编辑界面未关闭");
}

function cancelMediaUpload() {
  const cancel = visibleButtons("Cancel upload").at(-1);
  if (cancel) cancel.click();
}

async function uploadFile(file, root = null, marker = "") {
  const directResult = await uploadThroughEditorHandler(file, marker);
  if (directResult) return directResult;
  const baseline = marker ? await captureNativeUpload() : null;
  if (visibleButtons("Cancel upload").length) cancelMediaUpload();
  if (mediaEditorTitle()) await closeMediaEditor();
  const button = mediaInsertButton();
  if (!button) throw new Error("找不到 X 的正文媒体插入按钮");
  const previousInputs = new Set(fileInputs());
  const initialMediaCount = root ? root.querySelectorAll("img,figure,video").length : null;
  let mediaMenuOpened = false;
  try {
    button.click();
    const mediaItem = await waitForUi(
      () => visibleExactText("Media"),
      "找不到 X 的 Media 插入项"
    );
    mediaItem.click();
    mediaMenuOpened = true;
    const mediaDestination = await waitForUi(() => {
      const input = mediaFileInput(previousInputs);
      if (input) return { input };
      const control = addPhotosButton();
      return control ? { control } : null;
    }, "找不到 X 的正文图片上传入口");
    const addPhotos = mediaDestination.control || null;
    let input = mediaDestination.input || inputForMediaControl(addPhotos);
    if (!input) {
      addPhotos.click();
      input = await waitForUi(
        () => mediaFileInput(previousInputs),
        "找不到 X 的正文图片上传入口"
      );
    }
    if (marker && root && typeof selectMarker === "function" && !selectMarker(root, marker)) {
      throw new Error(`找不到图片位置：${file.name || "图片"}`);
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const completion = await waitForUi(() => {
      if (mediaUploadFailure()) return { type: "failed" };
      const editor = mediaEditorTitle();
      if (editor) return { type: "editor" };
      if (mediaUploadStatus()) {
        return false;
      }
      if (root && root.querySelectorAll("img,figure,video").length > initialMediaCount) return { type: "inserted" };
      return false;
    }, "X 图片上传没有完成");
    if (completion.type === "failed") throw new Error("X 图片上传失败，请检查该图片格式和大小");
    if (completion.type === "editor") await closeMediaEditor();
    if (marker) await relocateNativeUpload(marker, baseline);
  } finally {
    if (mediaMenuOpened && (mediaUploadStatus() || visibleButtons("Cancel upload").length)) cancelMediaUpload();
    if (mediaMenuOpened && mediaEditorTitle()) {
      try {
        await closeMediaEditor();
      } catch {
      }
    }
  }
}
