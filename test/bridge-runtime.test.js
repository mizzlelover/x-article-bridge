import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../src/main-world.js', import.meta.url), 'utf8');
function bridge(editor) {
  const context = {editorElement: () => editor};
  runInNewContext(source.slice(source.indexOf('  function fiberForEditor('), source.indexOf('  function markerLocation(')) + '\nthis.api = {fiberForEditor, draftStateNode, articleMediaLimit};', context);
  return context.api;
}
function attach(parent, child) {
  parent.child = child;
  child.return = parent;
  return child;
}
function currentTree() {
  const editor = {};
  const rootState = {};
  const staleRoot = {tag: 3, stateNode: rootState};
  const currentRoot = {tag: 3, stateNode: rootState};
  rootState.current = currentRoot;
  staleRoot.alternate = currentRoot;
  currentRoot.alternate = staleRoot;
  const staleParent = attach(staleRoot, {});
  const currentParent = attach(currentRoot, {});
  const staleHost = attach(staleParent, {tag: 5, stateNode: editor});
  const currentHost = attach(currentParent, {tag: 5, stateNode: editor});
  staleHost.alternate = currentHost;
  currentHost.alternate = staleHost;
  editor.__reactFiber$test = staleHost;
  return {editor, rootState, staleRoot, currentRoot, staleParent, currentParent, staleHost, currentHost};
}

test('editor fiber resolves through HostRoot.current instead of a stale DOM expando', () => {
  const tree = currentTree();
  assert.equal(bridge(tree.editor).fiberForEditor(), tree.currentHost);
});
test('draft state comes from the committed article owner', () => {
  const tree = currentTree();
  tree.staleParent.stateNode = {props: {editorState: {revision: 'stale'}, onChange() {}, onAddMediaFiles() {}}};
  tree.currentParent.stateNode = {props: {editorState: {revision: 'current'}, onChange() {}, onAddMediaFiles() {}}};
  const api = bridge(tree.editor);
  const owner = api.draftStateNode();
  assert.equal(owner.props, tree.currentParent.stateNode.props);
  assert.equal(owner.draftEditor, tree.currentParent.stateNode);
});
test('each operation re-resolves the committed tree after the React root switches', () => {
  const tree = currentTree();
  const api = bridge(tree.editor);
  assert.equal(api.fiberForEditor(), tree.currentHost);
  tree.rootState.current = tree.staleRoot;
  assert.equal(api.fiberForEditor(), tree.staleHost);
});

const markerContext = {};
runInNewContext(source.slice(source.indexOf('  function markerLocation('), source.indexOf('  function atomicBlockKeys(')) + '\nthis.locate = markerLocation;', markerContext);
const markerContent = (text) => ({getBlockMap: () => new Map([['paragraph', {getType: () => 'unstyled', getText: () => text}]])});
const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const domMarkerContext = {
  NodeFilter: {SHOW_TEXT: 4},
  document: {createTreeWalker(root) {
    let index = -1;
    return {nextNode() { index += 1; return index < root.length; }, get currentNode() { return root[index]; }};
  }}
};
runInNewContext(contentSource.slice(contentSource.indexOf('function findMarker('), contentSource.indexOf('function selectMarker(')) + '\nthis.locate = findMarker;', domMarkerContext);

test('Draft marker XABIMG1 does not match the remaining XABIMG10 marker', () => {
  assert.equal(markerContext.locate(markerContent('XABIMG10'), 'XABIMG1'), null);
  assert.equal(markerContext.locate(markerContent('XABIMG10 and XABIMG1'), 'XABIMG1')?.offset, 13);
});
test('DOM marker XABIMG1 does not match the remaining XABIMG10 marker', () => {
  assert.equal(domMarkerContext.locate([{textContent: 'XABIMG10'}], 'XABIMG1'), null);
  assert.equal(domMarkerContext.locate([{textContent: 'XABIMG10 and XABIMG1'}], 'XABIMG1')?.index, 13);
});

test('article media limit reads the committed provider flag instead of a fixed default', () => {
  const tree = currentTree();
  const requests = [];
  tree.staleParent.memoizedProps = {value: {featureSwitches: {getNumberValue: () => 4}}};
  tree.currentParent.memoizedProps = {value: {featureSwitches: {getNumberValue(name, fallback) {
    requests.push([name, fallback]);
    return 17;
  }}}};
  assert.equal(bridge(tree.editor).articleMediaLimit(), 17);
  assert.deepEqual(requests, [['responsive_web_twitter_article_media_limit', 25]]);
});
test('article media limit falls back to 25 when no provider exists', () => {
  assert.equal(bridge({}).articleMediaLimit(), 25);
});
const settlementSource = source.slice(source.indexOf('  function contentSignature('), source.indexOf('  window.addEventListener('));

function settlementHarness() {
  let now = 0;
  let injected = false;
  const calls = {relocations: [], settledAt: null};
  const placements = Array.from({length: 6}, (_, index) => ({marker: `XABIMG${index}`, mediaId: `20994624847469690${index}`}));
  const blocks = [];
  const textBlock = (key, text) => ({key, type: 'unstyled', text, getType() { return this.type; }, getText() { return this.text; }});
  const mediaBlock = (key, mediaId) => ({key, type: 'atomic', mediaId, getType() { return this.type; }, getText() { return ''; }});
  for (let index = 0; index < placements.length - 1; index += 1) {
    blocks.push(textBlock(`before-${index}`, `第 ${index + 1} 张图片前`));
    blocks.push(mediaBlock(`media-${index}`, placements[index].mediaId));
  }
  blocks.push(textBlock('before-5', '第 6 张图片前'));
  blocks.push(mediaBlock('media-5', placements[5].mediaId));
  blocks.push(textBlock('after-5', '第 6 张图片后'));
  const content = {
    getBlockMap() { return new Map(blocks.map((block) => [block.key, block])); }
  };
  const node = {props: {editorState: {getCurrentContent: () => content}}};
  const markerLocation = (current, marker) => {
    for (const [key, block] of current.getBlockMap()) {
      if (block.getType() === 'atomic') continue;
      const offset = block.getText().indexOf(marker);
      if (offset >= 0) return {blockKey: key, offset, exact: block.getText() === marker};
    }
    return null;
  };
  const context = {
    Date: {now: () => now},
    location: {href: 'https://x.com/compose/articles/test'},
    sleep: async (milliseconds) => {
      now += milliseconds;
      if (!injected && now >= 1500) {
        injected = true;
        const mediaIndex = blocks.findIndex((block) => block.key === 'media-5');
        const [media] = blocks.splice(mediaIndex, 1);
        blocks.splice(blocks.findIndex((block) => block.key === 'after-5'), 0, textBlock('late-marker', placements[5].marker));
        blocks.push(media);
      }
    },
    draftStateNode: () => node,
    editorElement: () => ({textContent: blocks.filter((block) => block.getType() !== 'atomic').map((block) => block.getText()).join('')}),
    atomicBlockKeys: (current) => [...current.getBlockMap()].filter(([, block]) => block.getType() === 'atomic').map(([key]) => key),
    serverMediaIds: (_current, block) => block.getType() === 'atomic' ? [block.mediaId] : [],
    uploadedMedia: (_current, block) => block.getType() === 'atomic' && Boolean(block.mediaId),
    mediaBlockForId: (current, mediaId) => [...current.getBlockMap()].find(([, block]) => block.mediaId === String(mediaId))?.[0] || null,
    markerLocation,
    relocateMediaBlock(_draftNode, marker, mediaKey) {
      const location = markerLocation(content, marker);
      if (!location) return false;
      const markerIndex = blocks.findIndex((block) => block.key === location.blockKey);
      const mediaIndex = blocks.findIndex((block) => block.key === mediaKey);
      const [media] = blocks.splice(mediaIndex, 1);
      const updatedMarkerIndex = blocks.findIndex((block) => block.key === location.blockKey);
      blocks.splice(updatedMarkerIndex, 1);
      blocks.splice(Math.min(markerIndex, blocks.length), 0, media);
      calls.relocations.push({marker, mediaId: media.mediaId});
      return true;
    }
  };
  runInNewContext(settlementSource + '\nthis.settle = settleImportedMedia; this.confirm = confirmMediaPlacement;', context);
  return {calls, placements, context, settle: context.settle, confirm: context.confirm, blocks, now: () => now};
}

test('final media settlement repairs a delayed marker and waits for a stable editor state', async () => {
  const harness = settlementHarness();
  const result = await harness.settle(harness.placements);
  assert.deepEqual({...result}, {ok: true, mediaCount: 6});
  assert.deepEqual(harness.calls.relocations, [{marker: 'XABIMG5', mediaId: '209946248474696905'}]);
  assert.ok(harness.now() >= 7500, `settlement returned after only ${harness.now()}ms`);
  assert.deepEqual(harness.blocks.filter((block) => block.getType() === 'atomic').map((block) => block.mediaId), harness.placements.map(({mediaId}) => mediaId));
  assert.equal(harness.blocks.some((block) => block.getText?.().includes('XABIMG')), false);
});

test('final media settlement rejects missing upload identities without throwing', async () => {
  const harness = settlementHarness();
  const result = await harness.settle([{marker: 'XABIMG0', mediaId: null}]);
  assert.equal(result.ok, false);
  assert.match(result.error, /媒体编号/);
  assert.equal(harness.calls.relocations.length, 0);
});

test('per-image confirmation repairs a late marker while other uploaded images remain present', async () => {
  const h = settlementHarness();
  const last = h.placements.at(-1);
  const result = await h.confirm(last.marker, last.mediaId);
  assert.equal(result.ok, true);
  assert.equal(result.mediaId, last.mediaId);
  assert.equal(h.calls.relocations.length, 1);
  assert.ok(h.now() >= 3500);
  assert.equal(h.blocks.filter(block => block.getType() === 'atomic').length, 6);
});

test('per-image confirmation waits for delayed DOM rendering instead of immediately failing', async () => {
  const h = settlementHarness();
  const last = h.placements.at(-1);
  h.context.editorElement = () => ({textContent: h.now() < 3000 ? last.marker : ''});
  const result = await h.confirm(last.marker, last.mediaId);
  assert.equal(result.ok, true);
  assert.ok(h.now() >= 5000);
});

test('per-image confirmation timeout reports the existing media identity without re-uploading', async () => {
  const h = settlementHarness();
  h.context.editorElement = () => ({textContent: 'XABIMG5'});
  const result = await h.confirm('XABIMG5', h.placements[5].mediaId, 300);
  assert.equal(result.ok, false);
  assert.equal(result.mediaId, h.placements[5].mediaId);
  assert.match(result.error, /不会重复上传/);
});

function replaceBodyHarness(nativeResult = 'handled') {
  const calls = {native: [], dispatched: [], changed: []};
  const html = '<p>Replacement body</p>';
  const plain = 'Replacement body';
  const first = {getKey: () => 'first', getLength: () => 5};
  const last = {getKey: () => 'last', getLength: () => 12};
  class State {
    constructor(text = 'Existing body', selection = {}) { this.text = text; this.selection = selection; }
    getCurrentContent() { return {getBlockMap: () => ({first: () => first, last: () => last}), getPlainText: () => this.text}; }
    getSelection() { return {...this.selection, merge: values => ({...this.selection, ...values})}; }
    static forceSelection(state, selection) { return new State(state.text, selection); }
  }
  const node = {props: {editorState: new State(), onChange(state) {
    calls.changed.push(state);
    node.props.editorState = state;
  }}};
  if (nativeResult !== undefined) node.props.handlePastedText = (text, markup, selected) => {
    calls.native.push({text, markup, selected});
    if (nativeResult === 'handled') node.props.editorState = new State(text, selected.selection);
    return nativeResult;
  };
  const editor = {focus() {}, dispatchEvent(event) {
    calls.dispatched.push(event);
    node.props.editorState = new State(event.clipboardData.values.get('text/plain'));
  }};
  const context = {
    editorElement: () => editor,
    draftStateNode: () => node,
    sleep: async () => {},
    DOMParser: class {parseFromString() { return {body: {textContent: plain}}; }},
    DataTransfer: class {values = new Map(); setData(type, value) { this.values.set(type, value); }},
    ClipboardEvent: class {constructor(type, options) { this.type = type; Object.assign(this, options); }}
  };
  runInNewContext(source.slice(source.indexOf('  async function replaceBody('), source.indexOf('  function post(')) + '\nthis.replace = replaceBody;', context);
  return {calls, node, html, plain, replace: context.replace};
}

test('replaceBody uses native handlePastedText with an explicit whole-document selected state', async () => {
  const harness = replaceBodyHarness();
  await harness.replace(harness.html);
  assert.equal(harness.calls.native.length, 1);
  const call = harness.calls.native[0];
  assert.equal(call.text, harness.plain);
  assert.equal(call.markup, harness.html);
  assert.deepEqual({...call.selected.selection}, {
    anchorKey: 'first', anchorOffset: 0, focusKey: 'last', focusOffset: 12,
    isBackward: false, hasFocus: true
  });
  assert.equal(harness.calls.dispatched.length, 0);
  assert.equal(harness.node.props.editorState.getCurrentContent().getPlainText(), harness.plain);
});
test('replaceBody falls back to synthetic paste when the native handler returns not-handled', async () => {
  const harness = replaceBodyHarness('not-handled');
  await harness.replace(harness.html);
  assert.equal(harness.calls.native.length, 1);
  assert.equal(harness.calls.dispatched.length, 1);
  assert.equal(harness.calls.dispatched[0].clipboardData.values.get('text/html'), harness.html);
  assert.equal(harness.node.props.editorState.getCurrentContent().getPlainText(), harness.plain);
});
function articleOwnerTree() {
  const tree = currentTree();
  const ownerProps = {editorState: {revision: 'article-owner'}, onChange() {}, onAddMediaFiles() {}};
  const innerProps = {editorState: {revision: 'inner-editor'}, onChange() {}};
  tree.currentParent.memoizedProps = ownerProps;
  const inner = attach(tree.currentParent, {stateNode: {props: innerProps}});
  attach(inner, tree.currentHost);
  const decoy = {return: tree.currentRoot};
  decoy.sibling = tree.currentParent;
  tree.currentRoot.child = decoy;
  tree.staleParent.memoizedProps = {editorState: {revision: 'stale-owner'}, onChange() {}, onAddMediaFiles() {}};
  // React can reuse committed children while their return links still point at alternates.
  tree.currentHost.return = tree.staleParent;
  inner.return = tree.staleParent;
  return {...tree, ownerProps, innerProps, inner};
}

test('committed ancestor path is recovered by DFS even when return links point to stale alternates', () => {
  const tree = articleOwnerTree();
  const path = bridge(tree.editor).fiberForEditor(true);
  assert.ok(Array.isArray(path));
  assert.equal(path.length, 4);
  assert.equal(path[0], tree.currentHost);
  assert.equal(path[1], tree.inner);
  assert.equal(path[2], tree.currentParent);
  assert.equal(path[3], tree.currentRoot);
});
test('authoritative article owner editor state takes priority over the inner Draft editor state', () => {
  const tree = articleOwnerTree();
  tree.currentHost.return = tree.inner;
  tree.inner.return = tree.currentParent;
  const node = bridge(tree.editor).draftStateNode();
  assert.equal(node?.props, tree.ownerProps);
});
test('authoritative article owner resolution uses committed ancestry when return links are stale', () => {
  const tree = articleOwnerTree();
  const api = bridge(tree.editor);
  assert.equal(api.draftStateNode()?.props, tree.ownerProps);
});
