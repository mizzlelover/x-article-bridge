(() => {
  if (window.__xabMainBridgeInstalled) return;
  window.__xabMainBridgeInstalled = true;

  const CHANNEL_TO_MAIN = "xab-bridge";
  const CHANNEL_FROM_MAIN = "xab-main";
  const EDITOR_SELECTOR = "[data-contents='true'] [contenteditable='true'], [contenteditable='true'][role='textbox'], [contenteditable='true'].public-DraftEditor-content, [contenteditable='true']";
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  let activeOperation = false;

  async function replaceBody(html) {
    editorElement()?.focus();
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
    const selectedState = state.constructor.forceSelection(state, selection);
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const plain = parsed.body.textContent || "";
    const pasteNode = node.draftEditor || node;
    const handled = typeof pasteNode.props.handlePastedText === "function"
      && pasteNode.props.handlePastedText(plain, html, selectedState) === "handled";
    if (!handled) {
      node.props.onChange(selectedState);
      await sleep(100);
      const transfer = new DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", plain);
      editorElement().dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true, cancelable: true, clipboardData: transfer
      }));
    }
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

  function fiberForEditor(withAncestors = false) {
    const editor = editorElement();
    if (!editor) return null;
    const fiberKey = Object.keys(editor).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
    const mounted = fiberKey ? editor[fiberKey] : null;
    let root = mounted;
    while (root?.return) root = root.return;
    const current = root?.stateNode?.current;
    if (!current) {
      const path = [];
      for (let fiber = mounted; fiber; fiber = fiber.return) path.push(fiber);
      return withAncestors ? path : mounted;
    }
    const stack = [{ fiber: current, parents: [] }];
    while (stack.length) {
      const { fiber, parents } = stack.pop();
      if (fiber.stateNode === editor) return withAncestors ? [fiber, ...parents] : fiber;
      if (fiber.sibling) stack.push({ fiber: fiber.sibling, parents });
      if (fiber.child) stack.push({ fiber: fiber.child, parents: [fiber, ...parents] });
    }
    return withAncestors ? [] : null;
  }

  function draftStateNode() {
    let draftEditor = null;
    for (const fiber of fiberForEditor(true) || []) {
      const stateNode = fiber.stateNode;
      if (!draftEditor && stateNode?.props?.editorState && typeof stateNode.props.onChange === "function") {
        draftEditor = stateNode;
      }
      const props = stateNode?.props || fiber.memoizedProps;
      if (props?.editorState && typeof props.onChange === "function" && typeof props.onAddMediaFiles === "function") {
        return { props, draftEditor };
      }
    }
    return draftEditor;
  }

  function articleMediaLimit() {
    for (const fiber of fiberForEditor(true) || []) {
      for (const props of [fiber.stateNode?.props, fiber.memoizedProps]) {
        const switches = props?.value?.featureSwitches || props?.featureSwitches;
        if (typeof switches?.getNumberValue === "function") {
          const limit = switches.getNumberValue("responsive_web_twitter_article_media_limit", 25);
          if (Number.isInteger(limit) && limit > 0) return limit;
        }
      }
    }
    return 25;
  }

  function markerLocation(contentState, marker) {
    if (!marker) return null;
    let exact = null;
    let partial = null;
    contentState.getBlockMap().forEach((block, key) => {
      if (block.getType() === "atomic") return;
      const text = block.getText() || "";
      let offset = text.indexOf(marker);
      while (offset >= 0 && /\d/.test(text[offset + marker.length] || "")) {
        offset = text.indexOf(marker, offset + marker.length);
      }
      if (offset < 0) return;
      const candidate = { blockKey: key, offset, length: marker.length, exact: text.trim() === marker };
      if (candidate.exact && !exact) exact = candidate;
      else if (!partial) partial = candidate;
    });
    return exact || partial;
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

  function serverMediaIds(content, block) {
    if (block.getType() !== "atomic") return [];
    const chars = block.getCharacterList();
    const ids = new Set();
    chars.forEach((character) => {
      const key = character.getEntity();
      if (key == null) return;
      const entity = content.getEntity(key);
      if (entity.getType() !== "MEDIA") return;
      const visit = (data, depth = 0) => {
        if (!data || typeof data !== "object" || depth > 5) return;
        for (const [name, value] of Object.entries(data)) {
          if (/^(media_?id(_string)?|mediaIdString|media_?key|id_str|rest_id)$/i.test(name)
            && /^(?:\d+_)?\d{8,}$/.test(String(value))) ids.add(String(value));
          if (typeof value === "object") visit(value, depth + 1);
        }
      };
      visit(entity.getData());
    });
    return [...ids];
  }

  function uploadedMedia(content, block) {
    return serverMediaIds(content, block).length > 0;
  }

  function allServerMediaIds(content) {
    const ids = new Set();
    content.getBlockMap().forEach((block) => {
      for (const id of serverMediaIds(content, block)) ids.add(id);
    });
    return ids;
  }

  function mediaBlockForId(content, mediaId) {
    if (!mediaId) return null;
    return atomicBlockKeys(content).find((key) => serverMediaIds(content, content.getBlockMap().get(key))
      .includes(String(mediaId))) || null;
  }

  function findUploadedMedia(content, beforeIds, expectedMediaId = null) {
    if (expectedMediaId) return mediaBlockForId(content, expectedMediaId);
    return atomicBlockKeys(content).find((key) => serverMediaIds(content, content.getBlockMap().get(key))
      .some((id) => !beforeIds.has(id))) || null;
  }

  function uploadFailureAlerts() {
    return [...document.querySelectorAll('[role="alert"]')].filter((element) =>
      /(?:Some (?:of your )?media failed to upload|Media failed to upload)/i.test(element.textContent || ""));
  }

  async function waitForNewAtomic(beforeIds, timeout = 120000, articleUrl = location.href, previousAlerts = new Set(), expectedMediaId = null) {
    const deadline = Date.now() + timeout;
    while (true) {
      if (location.href !== articleUrl) throw new Error("文章已切换，已停止图片定位");
      const latest = draftStateNode();
      const contentState = latest?.props?.editorState?.getCurrentContent?.();
      if (contentState) {
        const key = findUploadedMedia(contentState, beforeIds, expectedMediaId);
        if (key) return { draftNode: latest, blockKey: key, mediaId: expectedMediaId || serverMediaIds(contentState, contentState.getBlockMap().get(key)).find((id) => !beforeIds.has(id)) };
      }
      if (uploadFailureAlerts().some((alert) => !previousAlerts.has(alert))) {
        const error = new Error("X 图片上传失败，请稍后重试或检查该图片格式和大小");
        error.uploadFailed = true;
        throw error;
      }
      if (Date.now() >= deadline) return null;
      await sleep(Math.min(100, deadline - Date.now()));
    }
  }

  function contentSignature(content) {
    const parts = [];
    content.getBlockMap().forEach((block) => {
      if (block.getType() === "atomic") {
        parts.push(`media:${serverMediaIds(content, block).sort().join(",")}`);
      } else {
        parts.push(`text:${block.getText()}`);
      }
    });
    return parts.join("\u001f");
  }

  async function confirmMediaPlacement(marker, mediaId, timeout = 30000, articleUrl = location.href) {
    if (!marker || !mediaId) return {ok: false, error: "图片位置确认缺少媒体编号"};
    const deadline = Date.now() + timeout;
    let lastSignature = null;
    let stableSince = 0;
    while (true) {
      if (location.href !== articleUrl) return {ok: false, mediaId, error: "文章已切换，已停止图片定位"};
      const latest = draftStateNode();
      const content = latest?.props?.editorState?.getCurrentContent?.();
      const mediaKey = content ? mediaBlockForId(content, mediaId) : null;
      if (mediaKey) {
        if (markerLocation(content, marker)) {
          relocateMediaBlock(latest, marker, mediaKey);
          lastSignature = null;
          stableSince = 0;
        } else {
          const editorText = editorElement()?.textContent || "";
          const markerVisible = new RegExp(`${marker}(?!\\d)`).test(editorText);
          if (!markerVisible) {
            const signature = contentSignature(content);
            if (signature === lastSignature && Date.now() - stableSince >= 2000) {
              return {ok: true, mediaId, blockKey: mediaKey};
            }
            if (signature !== lastSignature) {
              lastSignature = signature;
              stableSince = Date.now();
            }
          } else {
            lastSignature = null;
            stableSince = 0;
          }
        }
      } else {
        lastSignature = null;
        stableSince = 0;
      }
      if (Date.now() >= deadline) {
        return {ok: false, mediaId, error: "图片已上传，但正文位置尚未稳定；点击重试只确认位置，不会重复上传这张图片"};
      }
      await sleep(100);
    }
  }

  async function settleImportedMedia(placements, timeout = 30000, articleUrl = location.href) {
    if (!Array.isArray(placements) || placements.some((placement) => !placement?.marker || !placement?.mediaId)) {
      return {ok: false, error: "X 尚未确认所有正文图片的媒体编号，请点击重试确认"};
    }
    if (!placements.length) return {ok: true, mediaCount: 0};
    const deadline = Date.now() + timeout;
    const stableFor = 6000;
    let lastSignature = "";
    let stableSince = 0;
    while (true) {
      if (location.href !== articleUrl) {
        return {ok: false, error: "文章已切换，请在当前文章重试确认图片位置"};
      }
      const latest = draftStateNode();
      const content = latest?.props?.editorState?.getCurrentContent?.();
      if (content) {
        const mediaKeys = atomicBlockKeys(content).filter((key) => uploadedMedia(content, content.getBlockMap().get(key)));
        const presentIds = new Set(mediaKeys.flatMap((key) => serverMediaIds(content, content.getBlockMap().get(key))));
        const allImagesPresent = mediaKeys.length === placements.length
          && placements.every(({mediaId}) => presentIds.has(String(mediaId)));
        if (allImagesPresent) {
          let repaired = false;
          for (const {marker, mediaId} of placements) {
            if (!markerLocation(content, marker)) continue;
            const mediaKey = mediaBlockForId(content, mediaId);
            if (mediaKey && relocateMediaBlock(latest, marker, mediaKey)) {
              repaired = true;
              break;
            }
          }
          if (repaired) {
            lastSignature = "";
            stableSince = 0;
          } else {
            const editorText = editorElement()?.textContent || "";
            const noDomMarkers = placements.every(({marker}) => !new RegExp(`${marker}(?!\\d)`).test(editorText));
            if (noDomMarkers) {
              const signature = contentSignature(content);
              if (signature === lastSignature) {
                if (Date.now() - stableSince >= stableFor) return {ok: true, mediaCount: mediaKeys.length};
              } else {
                lastSignature = signature;
                stableSince = Date.now();
              }
            } else {
              lastSignature = "";
              stableSince = 0;
            }
          }
        } else {
          lastSignature = "";
          stableSince = 0;
        }
      }
      if (Date.now() >= deadline) {
        return {ok: false, error: "X 尚未确认全部图片和正文位置稳定，请点击重试确认；不会重复上传图片"};
      }
      await sleep(100);
    }
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
    if (message.kind === "article-media-limit") {
      post("article-media-limit-result", { requestId: message.requestId, mediaLimit: articleMediaLimit() });
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
        beforeIds: [...allServerMediaIds(draftNode.props.editorState.getCurrentContent())]
      });
      return;
    }
    if (message.kind === "confirm-media-placement") {
      confirmMediaPlacement(message.marker, message.mediaId, 30000, message.articleUrl || location.href)
        .then((result) => post("confirmed-media-result", {requestId: message.requestId, ...result}))
        .catch((error) => post("confirmed-media-result", {requestId: message.requestId, ok: false, mediaId: message.mediaId, error: error instanceof Error ? error.message : "图片位置尚未确认"}));
      return;
    }
    if (message.kind === "settle-imported-media") {
      settleImportedMedia(message.placements, 30000, message.articleUrl || location.href)
        .then((result) => post("settled-media-result", {requestId: message.requestId, ...result}))
        .catch((error) => post("settled-media-result", {requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : "X 图片位置尚未稳定"}));
      return;
    }
    if (message.kind !== "relocate-native-media") return;
    waitForNewAtomic(new Set(message.beforeIds || []), 120000)
      .then((uploaded) => {
        if (!uploaded) return { ok: false, error: "X 图片上传成功后没有生成正文媒体块" };
        const latest = draftStateNode() || uploaded.draftNode;
        if (!relocateMediaBlock(latest, message.marker, uploaded.blockKey)) {
          return { ok: false, mediaId: uploaded.mediaId, error: "图片已上传，但找不到对应的正文位置" };
        }
        return { ok: true, blockKey: uploaded.blockKey, mediaId: uploaded.mediaId };
      })
      .then((result) => post("native-media-result", { requestId: message.requestId, ...result }))
      .catch((error) => post("native-media-result", { requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : "X 图片定位失败" }));
  });
})();
