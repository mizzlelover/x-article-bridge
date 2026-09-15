(() => {
  if (window.__xabMainBridgeInstalled) return;
  window.__xabMainBridgeInstalled = true;

  const CHANNEL_TO_MAIN = "xab-bridge";
  const CHANNEL_FROM_MAIN = "xab-main";
  const EDITOR_SELECTOR = "[data-contents='true'] [contenteditable='true'], [contenteditable='true'][role='textbox'], [contenteditable='true'].public-DraftEditor-content, [contenteditable='true']";
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  let activeOperation = false;

  async function replaceBody(html) {
    const node = draftStateNode();
    if (!node) throw new Error("找不到 X 正文编辑状态");
    const state = node.props.editorState;
    const blocks = state.getCurrentContent().getBlockMap();
    const first = blocks.first();
    const last = blocks.last();
    const selection = state.getSelection().merge({
      anchorKey: first.getKey(), anchorOffset: 0,
      focusKey: last.getKey(), focusOffset: last.getLength(),
      isBackward: false, hasFocus: true
    });
    node.props.onChange(state.constructor.forceSelection(state, selection));
    await sleep(100);
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const plain = parsed.body.textContent || "";
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", plain);
    editorElement().dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true, cancelable: true, clipboardData: transfer
    }));
    const normalized = (text) => text.replace(/\s/g, "");
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await sleep(100);
      const current = draftStateNode()?.props.editorState.getCurrentContent();
      if (current && normalized(current.getPlainText("")) === normalized(plain)) return;
    }
    throw new Error("正文写入校验失败，已停止图片上传，请检查正文");
  }

  function post(kind, payload = {}) {
    window.postMessage({ source: CHANNEL_FROM_MAIN, kind, ...payload }, "*");
  }

  function editorElement() {
    return [...document.querySelectorAll(EDITOR_SELECTOR)].find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 200 && rect.height > 80;
    }) || null;
  }

  function fiberForEditor() {
    const editor = editorElement();
    if (!editor) return null;
    const fiberKey = Object.keys(editor).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
    return fiberKey ? editor[fiberKey] : null;
  }

  function draftStateNode() {
    let fiber = fiberForEditor();
    for (let depth = 0; depth < 80 && fiber; depth += 1) {
      const stateNode = fiber.stateNode;
      if (stateNode?.props?.editorState && typeof stateNode.props.onChange === "function") return stateNode;
      fiber = fiber.return;
    }
    return null;
  }

  function findOnFilesAddedInChildren(fiber, depth = 0) {
    if (!fiber || depth > 8) return null;
    const props = fiber.memoizedProps || fiber.stateNode?.props;
    if (typeof props?.onFilesAdded === "function") return props.onFilesAdded;
    return findOnFilesAddedInChildren(fiber.child, depth + 1)
      || findOnFilesAddedInChildren(fiber.sibling, depth);
  }

  function onFilesAdded() {
    let fiber = fiberForEditor();
    for (let depth = 0; depth < 160 && fiber; depth += 1) {
      const props = fiber.memoizedProps || fiber.stateNode?.props;
      if (typeof props?.onFilesAdded === "function") return props.onFilesAdded;
      const nested = findOnFilesAddedInChildren(fiber.child);
      if (nested) return nested;
      fiber = fiber.return;
    }
    return null;
  }

  function base64ToFile(base64, name, type) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], name || "article-image.png", { type: type || "image/png" });
  }

  function markerLocation(contentState, marker) {
    if (!marker) return null;
    let exact = null;
    let partial = null;
    contentState.getBlockMap().forEach((block, key) => {
      if (block.getType() === "atomic") return;
      const text = block.getText() || "";
      const offset = text.indexOf(marker);
      if (offset < 0) return;
      const candidate = { blockKey: key, offset, length: marker.length, exact: text.trim() === marker };
      if (candidate.exact && !exact) exact = candidate;
      else if (!partial) partial = candidate;
    });
    return exact || partial;
  }

  function placeSelectionAtMarker(draftNode, marker) {
    const editorState = draftNode.props.editorState;
    const location = markerLocation(editorState.getCurrentContent(), marker);
    if (!location) return null;
    const selection = editorState.getSelection().constructor.createEmpty(location.blockKey).merge({
      anchorOffset: location.offset,
      focusOffset: location.offset
    });
    const EditorState = editorState.constructor;
    draftNode.props.onChange(EditorState.forceSelection(editorState, selection));
    return location;
  }

  function atomicBlockKeys(contentState) {
    const keys = [];
    contentState.getBlockMap().forEach((block, key) => {
      if (block.getType() === "atomic") keys.push(key);
    });
    return keys;
  }

  function orderBlocks(blockKeys, markerKey, mediaKey, removeMarkerBlock) {
    if (typeof window.markerBlockOrder === "function") return window.markerBlockOrder(blockKeys, markerKey, mediaKey, removeMarkerBlock);
    const ordered = [];
    for (const key of blockKeys) {
      if (key === mediaKey) continue;
      if (key === markerKey) {
        ordered.push(mediaKey);
        if (!removeMarkerBlock) ordered.push(key);
      } else {
        ordered.push(key);
      }
    }
    return ordered.includes(mediaKey) ? ordered : [...ordered, mediaKey];
  }

  function emptyBlockMap(blockMap) {
    try {
      return blockMap.constructor();
    } catch {
      return new blockMap.constructor();
    }
  }

  function newBlockKey(blockMap) {
    let key = "";
    do {
      key = Math.random().toString(36).slice(2, 7);
    } while (blockMap.has(key));
    return key;
  }

  function relocateMediaBlock(draftNode, marker, mediaKey) {
    const editorState = draftNode.props.editorState;
    const contentState = editorState.getCurrentContent();
    const location = markerLocation(contentState, marker);
    if (!location) return false;
    const blockMap = contentState.getBlockMap();
    const markerBlock = blockMap.get(location.blockKey);
    const mediaBlock = blockMap.get(mediaKey);
    if (!markerBlock || !mediaBlock) return false;
    const text = markerBlock.getText() || "";
    const characters = markerBlock.getCharacterList();
    const prefixText = location.exact ? "" : text.slice(0, location.offset);
    const suffixText = location.exact ? "" : text.slice(location.offset + marker.length);
    const prefixBlock = prefixText
      ? markerBlock.merge({ text: prefixText, characterList: characters.slice(0, location.offset) })
      : null;
    const suffixKey = suffixText ? newBlockKey(blockMap) : null;
    const suffixBlock = suffixKey
      ? markerBlock.merge({ key: suffixKey, text: suffixText, characterList: characters.slice(location.offset + marker.length) })
      : null;
    const originalKeys = [...blockMap.keys()];
    const orderedKeys = location.exact
      ? orderBlocks(originalKeys, location.blockKey, mediaKey, true)
      : originalKeys.flatMap((key) => {
        if (key === mediaKey) return [];
        if (key !== location.blockKey) return [key];
        return [
          ...(prefixBlock ? [location.blockKey] : []),
          mediaKey,
          ...(suffixBlock ? [suffixKey] : [])
        ];
      });
    let nextBlockMap = emptyBlockMap(blockMap);
    for (const key of orderedKeys) {
      if (key === location.blockKey && prefixBlock) nextBlockMap = nextBlockMap.set(key, prefixBlock);
      else if (key === suffixKey && suffixBlock) nextBlockMap = nextBlockMap.set(key, suffixBlock);
      else if (key !== location.blockKey) nextBlockMap = nextBlockMap.set(key, blockMap.get(key));
    }
    const SelectionState = editorState.getSelection().constructor;
    const EditorState = editorState.constructor;
    const selection = SelectionState.createEmpty(mediaKey);
    const nextContent = contentState
      .set("blockMap", nextBlockMap)
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    let nextEditorState = EditorState.push(editorState, nextContent, "remove-range");
    nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
    draftNode.props.onChange(nextEditorState);
    return true;
  }

  function uploadedMedia(content, block) {
    if (block.getType() !== "atomic") return false;
    const chars = block.getCharacterList();
    let complete = false;
    chars.forEach((character) => {
      const key = character.getEntity();
      if (key == null) return;
      const entity = content.getEntity(key);
      if (entity.getType() !== "MEDIA") return;
      const visit = (data, depth = 0) => {
        if (!data || typeof data !== "object" || depth > 5) return false;
        return Object.entries(data).some(([name, value]) => {
          if (/^(media_?id(_string)?|mediaIdString|media_?key|id_str|rest_id)$/i.test(name)
            && /^(?:\d+_)?\d{8,}$/.test(String(value))) return true;
          return typeof value === "object" && visit(value, depth + 1);
        });
      };
      if (visit(entity.getData())) complete = true;
    });
    return complete;
  }

  async function waitForNewAtomic(beforeKeys, timeout = 45000, articleUrl = location.href) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (location.href !== articleUrl) throw new Error("文章已切换，已停止图片定位");
      const latest = draftStateNode();
      const contentState = latest?.props?.editorState?.getCurrentContent?.();
      if (contentState) {
        const key = atomicBlockKeys(contentState).find((candidate) => !beforeKeys.has(candidate)
          && uploadedMedia(contentState, contentState.getBlockMap().get(candidate)));
        if (key) return { draftNode: latest, blockKey: key };
      }
      await sleep(100);
    }
    return null;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== CHANNEL_TO_MAIN) return;
    const message = event.data;
    if (message.kind === "replace-body") {
      if (activeOperation) {
        post("body-result", {requestId: message.requestId, ok: false, error: "上一项导入仍在进行"});
        return;
      }
      activeOperation = true;
      replaceBody(message.html).then(() => post("body-result", {requestId: message.requestId, ok: true}))
        .catch((error) => post("body-result", {requestId: message.requestId, ok: false, error: error.message}))
        .finally(() => { activeOperation = false; });
      return;
    }
    if (message.kind === "ready?") {
      post("ready", { requestId: message.requestId, ready: Boolean(draftStateNode()) });
      return;
    }
    if (message.kind === "capture-media-baseline") {
      const draftNode = draftStateNode();
      if (!draftNode) {
        post("media-baseline", { requestId: message.requestId, ok: false, error: "X 正文媒体桥接不可用" });
        return;
      }
      post("media-baseline", {
        requestId: message.requestId,
        ok: true,
        beforeKeys: atomicBlockKeys(draftNode.props.editorState.getCurrentContent())
      });
      return;
    }
    if (message.kind === "upload-direct-media") {
      const draftNode = draftStateNode();
      const handler = onFilesAdded();
      if (!draftNode || !handler) {
        post("direct-media-result", { requestId: message.requestId, ok: false, error: "X 正文媒体上传接口不可用" });
        return;
      }
      const location = placeSelectionAtMarker(draftNode, message.marker);
      if (!location) {
        post("direct-media-result", { requestId: message.requestId, ok: false, error: "找不到图片对应的正文位置" });
        return;
      }
      const beforeKeys = new Set(atomicBlockKeys(draftNode.props.editorState.getCurrentContent()));
      let file;
      try {
        file = base64ToFile(message.base64, message.name, message.type);
        handler([file]);
      } catch (error) {
        post("direct-media-result", { requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : "X 图片上传未能启动" });
        return;
      }
      waitForNewAtomic(beforeKeys, 45000)
        .then((uploaded) => {
          if (!uploaded) return { ok: false, error: "X 图片上传没有生成正文媒体块" };
          const latest = draftStateNode() || uploaded.draftNode;
          if (!relocateMediaBlock(latest, message.marker, uploaded.blockKey)) {
            return { ok: false, error: "找不到图片对应的正文位置" };
          }
          return { ok: true, blockKey: uploaded.blockKey };
        })
        .then((result) => post("direct-media-result", { requestId: message.requestId, ...result }))
        .catch((error) => post("direct-media-result", { requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : "X 图片上传失败" }));
      return;
    }
    if (message.kind !== "relocate-native-media") return;
    waitForNewAtomic(new Set(message.beforeKeys || []), 12000)
      .then((uploaded) => {
        if (!uploaded) return { ok: false, error: "X 图片上传成功后没有生成正文媒体块" };
        const latest = draftStateNode() || uploaded.draftNode;
        if (!relocateMediaBlock(latest, message.marker, uploaded.blockKey)) {
          return { ok: false, error: "找不到图片对应的正文位置" };
        }
        return { ok: true, blockKey: uploaded.blockKey };
      })
      .then((result) => post("native-media-result", { requestId: message.requestId, ...result }))
      .catch((error) => post("native-media-result", { requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : "X 图片定位失败" }));
  });
})();
