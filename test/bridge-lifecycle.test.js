import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const mainSource = readFileSync(new URL('../src/main-world.js', import.meta.url), 'utf8');
const mediaSource = readFileSync(new URL('../src/media.js', import.meta.url), 'utf8');
const ensureSource = mediaSource.slice(mediaSource.indexOf('async function ensureMainBridge('), mediaSource.indexOf('async function captureNativeUpload('));

test('an old or absent page bridge is restored before import proceeds', async () => {
  let probes = 0;
  let restored = 0;
  const ctx = {
    XAB_BRIDGE_VERSION: '0.1.16',
    bridgeRequest: async () => ++probes === 1 ? {bridgeVersion: '0.1.14'} : {bridgeVersion: '0.1.16', capabilities: ['confirm-media-placement'], ready: true},
    chrome: {runtime: {sendMessage: async message => {assert.equal(message.type, 'ensureMainBridge'); restored += 1; return {ok: true};}}}
  };
  runInNewContext(ensureSource + '\nthis.ensure = ensureMainBridge;', ctx);
  await ctx.ensure();
  assert.equal(probes, 2);
  assert.equal(restored, 1);
});

test('a compatible page bridge does not need reinstallation', async () => {
  const ctx = {XAB_BRIDGE_VERSION: '0.1.16', bridgeRequest: async () => ({bridgeVersion: '0.1.16', capabilities: ['confirm-media-placement'], ready: true})};
  runInNewContext(ensureSource + '\nthis.ensure = ensureMainBridge;', ctx);
  assert.equal((await ctx.ensure()).ready, true);
});

test('failed bridge restoration stops before any upload can start', async () => {
  const ctx = {XAB_BRIDGE_VERSION: '0.1.16', bridgeRequest: async () => null, chrome: {runtime: {sendMessage: async () => ({ok: false, error: 'restoration rejected'})}}};
  runInNewContext(ensureSource + '\nthis.ensure = ensureMainBridge;', ctx);
  await assert.rejects(ctx.ensure(), /restoration rejected/);
});

test('background bridge recovery targets only the requesting X Article tab', async () => {
  const source = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
  let listener;
  let request;
  const ctx = {chrome: {runtime: {onInstalled: {addListener() {}}, onMessage: {addListener: fn => {listener = fn;}}}, scripting: {executeScript: async args => {request = args;}}}};
  runInNewContext(source, ctx);
  const response = await new Promise(resolve => listener({type: 'ensureMainBridge'}, {tab: {id: 42, url: 'https://x.com/compose/articles/edit/test'}}, resolve));
  assert.equal(response.ok, true);
  assert.equal(request.target.tabId, 42);
  assert.equal(request.world, 'MAIN');
  request = null;
  listener({type: 'ensureMainBridge'}, {tab: {id: 43, url: 'https://example.com/'}}, result => assert.equal(result.ok, false));
  assert.equal(request, null);
});

test('a legacy bridge install flag cannot block the current bridge from installing', () => {
  const handlers = [];
  const context = {window: {__xabMainBridgeInstalled: true, addEventListener: (...args) => handlers.push(args)}};
  runInNewContext(mainSource, context);
  assert.equal(handlers.length, 1);
  assert.equal(context.window.__xabMainBridgeVersion, '0.1.16');
  runInNewContext(mainSource, context);
  assert.equal(handlers.length, 1, 'the same bridge version must not add duplicate listeners');
});

test('the installed bridge advertises confirmation capabilities in its handshake', () => {
  let listener;
  const replies = [];
  const context = {window: {addEventListener: (_event, callback) => {listener = callback;}, postMessage: message => replies.push(message)}, document: {querySelectorAll: () => []}};
  runInNewContext(mainSource, context);
  listener({source: context.window, data: {source: 'xab-bridge-v2', kind: 'ready?', requestId: 'probe'}});
  assert.equal(replies.length, 1);
  assert.equal(replies[0].bridgeVersion, '0.1.16');
  assert.ok(replies[0].capabilities.includes('confirm-media-placement'));
});
