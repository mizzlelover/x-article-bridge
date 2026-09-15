import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/format.js", import.meta.url), "utf8");
const context = {};
runInNewContext(`${source}\nthis.api = { markdownToHtml };`, context);
const { markdownToHtml } = context.api;

const importStateSource = readFileSync(new URL("../src/import-state.js", import.meta.url), "utf8");
const importStateContext = {};
runInNewContext(`${importStateSource}\nthis.api = { createImportGate };`, importStateContext);
const { createImportGate } = importStateContext.api;

const mediaSource = readFileSync(new URL("../src/media.js", import.meta.url), "utf8");
const existingFileInput = { id: "cover-input" };
const freshFileInput = { id: "article-input" };
const mediaContext = {
  document: { querySelectorAll: () => [existingFileInput, freshFileInput] }
};
runInNewContext(`${mediaSource}\nthis.api = { mediaFileInput };`, mediaContext);
const { mediaFileInput } = mediaContext.api;

const editorSource = readFileSync(new URL("../src/editor.js", import.meta.url), "utf8");
const editorEvents = [];
const editorRange = {
  selectNodeContents: (root) => { editorRange.selectedRoot = root; },
  deleteContents: () => { editorRange.deleted = true; },
  createContextualFragment: (html) => ({ html }),
  insertNode: (fragment) => { editorRange.inserted = fragment.html; }
};
const editorContext = {
  window: {
    getSelection: () => ({
      removeAllRanges: () => editorEvents.push("remove"),
      addRange: (range) => editorEvents.push(range)
    })
  },
  document: {
    createRange: () => editorRange,
    execCommand: () => true
  },
  InputEvent: class {}
};
runInNewContext(`${editorSource}\nthis.api = { dispatchHtml };`, editorContext);
const { dispatchHtml } = editorContext.api;

test("markdownToHtml preserves supported blocks and image markers", () => {
  const result = markdownToHtml("# Title\n\n**Bold** and *italic*.\n\n![Chart](data:image/png;base64,AA==)\n\n- One\n- Two");
  assert.equal(result.title, "Title");
  assert.match(result.html, /<strong>Bold<\/strong>/);
  assert.match(result.html, /<em>italic<\/em>/);
  assert.match(result.html, /XABIMG0/);
  assert.equal(JSON.stringify(result.assets[0]), JSON.stringify({ marker: "XABIMG0", source: "data:image/png;base64,AA==", name: "article-image-1.png", alt: "Chart" }));
  assert.match(result.html, /<ul><li>One<\/li><li>Two<\/li><\/ul>/);
});

test("createImportGate rejects overlapping imports and releases the lock", () => {
  const gate = createImportGate();
  const first = gate.begin({ id: "first-root" });
  assert.throws(() => gate.begin({ id: "second-root" }), /上一份文章仍在导入/);
  assert.doesNotThrow(() => gate.assert(first));
  gate.end(first);
  assert.doesNotThrow(() => gate.begin({ id: "second-root" }));
});

test("dispatchHtml replaces the existing editor selection instead of appending", () => {
  const events = [];
  const root = {
    focus: () => events.push("focus"),
    dispatchEvent: () => events.push("input")
  };
  dispatchHtml(root, "<p>new article</p>");
  assert.equal(editorRange.selectedRoot, root);
  assert.deepEqual(events, ["focus", "input"]);
});

test("mediaFileInput prefers the input created for the current media dialog", () => {
  assert.equal(mediaFileInput(new Set([existingFileInput])), freshFileInput);
});

test("mediaInsertButton prefers the body editor Insert control over a cover Add Media control", () => {
  const body = {};
  const insertButton = {
    textContent: "Insert",
    getBoundingClientRect: () => ({ width: 10, height: 10 })
  };
  const coverButton = {
    textContent: "",
    getAttribute: (name) => name === "aria-label" ? "Add Media" : null,
    getBoundingClientRect: () => ({ width: 10, height: 10 })
  };
  const container = {
    parentElement: body,
    querySelectorAll: () => [insertButton],
    contains: (element) => element === insertButton
  };
  const root = {
    parentElement: container,
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const context = {
    document: {
      body,
      querySelectorAll: (selector) => {
        if (selector === '[contenteditable="true"]') return [root];
        if (selector.includes("Add Media")) return [coverButton];
        return [];
      }
    }
  };
  runInNewContext(`${mediaSource}\nthis.api = { mediaInsertButton };`, context);
  assert.equal(context.api.mediaInsertButton(), insertButton);
});

test("mediaInsertButton never falls back to the cover Add Media control", () => {
  const body = {};
  const coverButton = {
    textContent: "",
    getAttribute: (name) => name === "aria-label" ? "Add Media" : null,
    getBoundingClientRect: () => ({ width: 10, height: 10 })
  };
  const root = {
    parentElement: body,
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const context = {
    document: {
      body,
      querySelectorAll: (selector) => {
        if (selector === '[contenteditable="true"]') return [root];
        if (selector.includes("Add Media")) return [coverButton];
        return [];
      }
    }
  };
  runInNewContext(`${mediaSource}\nthis.api = { mediaInsertButton };`, context);
  assert.equal(context.api.mediaInsertButton(), null);
});

test("mediaInsertButton recognizes X's labelled body control without visible text", () => {
  const body = {};
  const insertButton = {
    textContent: "",
    getAttribute: (name) => name === "aria-label" ? "Add Media" : null,
    getBoundingClientRect: () => ({ width: 10, height: 10 })
  };
  const container = {
    parentElement: body,
    querySelectorAll: () => [insertButton],
    contains: (element) => element === insertButton
  };
  const root = {
    parentElement: container,
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const context = {
    document: {
      body,
      querySelectorAll: (selector) => {
        if (selector === '[contenteditable="true"]') return [root];
        if (selector.includes("Add Media")) return [insertButton];
        return [];
      }
    }
  };
  runInNewContext(`${mediaSource}\nthis.api = { mediaInsertButton };`, context);
  assert.equal(context.api.mediaInsertButton(), insertButton);
});

test("mediaFileInput rejects the cover input when the modal reuses existing inputs", () => {
  const body = { getBoundingClientRect: () => ({ width: 1000, height: 800 }) };
  const coverContainer = {
    parentElement: body,
    textContent: "Add photos or video We recommend an image with a 5:2 aspect ratio",
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const articleContainer = {
    parentElement: body,
    textContent: "Insert Choose a file or drag it here.",
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const coverInput = {
    id: "cover-input",
    parentElement: coverContainer,
    closest: () => null
  };
  const articleInput = {
    id: "article-input",
    parentElement: articleContainer,
    closest: () => null
  };
  const context = {
    document: {
      body,
      querySelectorAll: (selector) => selector === 'input[type="file"]' ? [coverInput, articleInput] : []
    }
  };
  runInNewContext(`${mediaSource}\nthis.api = { mediaFileInput };`, context);
  assert.equal(context.api.mediaFileInput(new Set([coverInput, articleInput])), articleInput);
});

test("addPhotosButton ignores the persistent cover-image control", () => {
  const body = { getBoundingClientRect: () => ({ width: 1000, height: 800 }) };
  const articleContainer = {
    parentElement: body,
    textContent: "Insert Choose a file or drag it here.",
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const coverContainer = {
    parentElement: body,
    textContent: "We recommend an image with a 5:2 aspect ratio for best results.",
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const articleControl = {
    id: "article-control",
    parentElement: articleContainer,
    getBoundingClientRect: () => ({ width: 20, height: 20 })
  };
  const coverControl = {
    id: "cover-control",
    parentElement: coverContainer,
    getBoundingClientRect: () => ({ width: 20, height: 20 })
  };
  const context = {
    document: {
      body,
      querySelectorAll: (selector) => selector === '[aria-label="Add photos or video"]'
        ? [articleControl, coverControl]
        : []
    }
  };
  runInNewContext(`${mediaSource}\nthis.api = { addPhotosButton };`, context);
  assert.equal(context.api.addPhotosButton(), articleControl);
});

test("uploadFile closes the X media editor before resolving", async () => {
  let menuOpen = false;
  let inputCreated = false;
  let editorOpen = false;
  let addPhotosClicked = false;
  const body = { getBoundingClientRect: () => ({ width: 1000, height: 800 }) };
  const articleContainer = {
    parentElement: body,
    textContent: "Insert Choose a file or drag it here.",
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const coverInput = { id: "cover-input", parentElement: body };
  const articleInput = {
    id: "article-input",
    files: null,
    parentElement: articleContainer,
    closest: () => null,
    dispatchEvent: () => { editorOpen = true; }
  };
  const addButton = {
    getAttribute: (name) => name === "aria-label" ? "Add Media" : null,
    textContent: "",
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    click: () => { menuOpen = true; }
  };
  const insertButton = {
    textContent: "Insert",
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    click: () => { menuOpen = true; }
  };
  const mediaItem = {
    textContent: "Media",
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    click: () => { inputCreated = true; }
  };
  const addPhotos = {
    getAttribute: (name) => name === "aria-label" ? "Add photos or video" : null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    parentElement: articleContainer,
    click: () => { addPhotosClicked = true; }
  };
  const editorTitle = {
    textContent: "Edit media",
    getBoundingClientRect: () => ({ width: 10, height: 10 })
  };
  const backButton = {
    textContent: "Back",
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    click: () => { editorOpen = false; }
  };
  const fakeDocument = {
    body,
    querySelectorAll: (selector) => {
      if (selector.includes("Add Media")) return [addButton];
      if (selector === '[aria-label="Add photos or video"]') return inputCreated ? [addPhotos] : [];
      if (selector === "[role=menuitem],button") return menuOpen ? [mediaItem] : [];
      if (selector === 'input[type="file"]') return inputCreated ? [coverInput, articleInput] : [coverInput];
      if (selector === "h1,h2,h3,[role=dialog],div,span") return editorOpen ? [editorTitle] : [];
      if (selector === "[role=alert],div,span") return [];
      if (selector === "button,[role=button]") return editorOpen ? [backButton] : [insertButton];
      return [];
    }
  };
  const uploadContext = {
    document: fakeDocument,
    requestAnimationFrame: (callback) => callback(),
    DataTransfer: class {
      constructor() { this.items = { add: () => {} }; this.files = []; }
    },
    Event: class {}
  };
  runInNewContext(`${mediaSource}\nthis.api = { uploadFile };`, uploadContext);
  await uploadContext.api.uploadFile({ name: "article-image.png" });
  assert.equal(addPhotosClicked, false);
  assert.equal(editorOpen, false);
  assert.equal(articleInput.files.length, 0);
});

test("uploadFile rejects X's failed-media state", async () => {
  let menuOpen = false;
  let inputCreated = false;
  let failureVisible = false;
  const body = { getBoundingClientRect: () => ({ width: 1000, height: 800 }) };
  const articleContainer = {
    parentElement: body,
    textContent: "Insert Choose a file or drag it here.",
    getBoundingClientRect: () => ({ width: 500, height: 300 })
  };
  const coverInput = { id: "cover-input", parentElement: body };
  const articleInput = {
    id: "article-input",
    files: null,
    parentElement: articleContainer,
    closest: () => null,
    dispatchEvent: () => { failureVisible = true; }
  };
  const addButton = {
    getAttribute: (name) => name === "aria-label" ? "Add Media" : null,
    textContent: "",
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    click: () => { menuOpen = true; }
  };
  const insertButton = {
    textContent: "Insert",
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    click: () => { menuOpen = true; }
  };
  const mediaItem = {
    textContent: "Media",
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    click: () => { inputCreated = true; }
  };
  const addPhotos = {
    getAttribute: (name) => name === "aria-label" ? "Add photos or video" : null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    parentElement: articleContainer,
    click: () => {}
  };
  const failureToast = {
    textContent: "Some of your media failed to upload.",
    getBoundingClientRect: () => ({ width: 10, height: 10 })
  };
  const fakeDocument = {
    body,
    querySelectorAll: (selector) => {
      if (selector.includes("Add Media")) return [addButton];
      if (selector === '[aria-label="Add photos or video"]') return inputCreated ? [addPhotos] : [];
      if (selector === "[role=menuitem],button") return menuOpen ? [mediaItem] : [];
      if (selector === 'input[type="file"]') return inputCreated ? [coverInput, articleInput] : [coverInput];
      if (selector === "h1,h2,h3,[role=dialog],div,span") return [];
      if (selector === "[role=alert],div,span") return failureVisible ? [failureToast] : [];
      if (selector === "button,[role=button]") return [insertButton];
      return [];
    }
  };
  const uploadContext = {
    document: fakeDocument,
    requestAnimationFrame: (callback) => callback(),
    DataTransfer: class {
      constructor() { this.items = { add: () => {} }; this.files = []; }
    },
    Event: class {}
  };
  runInNewContext(`${mediaSource}\nthis.api = { uploadFile };`, uploadContext);
  await assert.rejects(
    uploadContext.api.uploadFile({ name: "article-image.png" }),
    /X 图片上传失败/
  );
});

test("uploadFile keeps marked images on X's native body-media picker", async () => {
  let directCalls = 0;
  let inserted = false;
  const input = {
    files: null,
    dispatchEvent: () => { inserted = true; }
  };
  const root = {
    querySelectorAll: () => inserted ? [{}] : []
  };
  const context = {
    document: { querySelectorAll: () => [] },
    directCalls: 0,
    input,
    DataTransfer: class {
      constructor() { this.items = { add: () => {} }; this.files = []; }
    },
    Event: class {}
  };
  runInNewContext(`${mediaSource}
    uploadAtMarker = async () => { globalThis.directCalls += 1; return null; };
    visibleButtons = () => [];
    mediaEditorTitle = () => null;
    mediaInsertButton = () => ({ click: () => {} });
    fileInputs = () => [];
    visibleExactText = () => ({ click: () => {} });
    mediaUploadFailure = () => false;
    addPhotosButton = () => ({});
    inputForMediaControl = () => globalThis.input;
    waitForUi = async (predicate) => predicate();
    this.api = { uploadFile };
  `, context);
  await context.api.uploadFile({ name: "article-image.png" }, root, "XABIMG0");
  assert.equal(context.directCalls, 0);
  assert.equal(input.files.length, 0);
});

test("uploadFile accepts X's direct body file input when no Add photos button appears", async () => {
  let inserted = false;
  const input = {
    files: null,
    dispatchEvent: () => { inserted = true; }
  };
  const root = {
    querySelectorAll: () => inserted ? [{}] : []
  };
  const context = {
    document: { querySelectorAll: () => [] },
    input,
    DataTransfer: class {
      constructor() { this.items = { add: () => {} }; this.files = []; }
    },
    Event: class {}
  };
  runInNewContext(`${mediaSource}
    bridgeRequest = async () => null;
    visibleButtons = () => [];
    mediaEditorTitle = () => null;
    mediaInsertButton = () => ({ click: () => {} });
    fileInputs = () => [];
    visibleExactText = () => ({ click: () => {} });
    mediaUploadFailure = () => false;
    addPhotosButton = () => null;
    mediaFileInput = () => globalThis.input;
    waitForUi = async (predicate) => predicate();
    this.api = { uploadFile };
  `, context);
  await context.api.uploadFile({ name: "article-image.png" }, root);
  assert.equal(input.files.length, 0);
});
