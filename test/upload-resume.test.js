import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const stateSource = readFileSync(new URL('../src/import-state.js', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const loopSource = contentSource.slice(contentSource.indexOf('async function uploadRemainingImages('), contentSource.indexOf('async function finishImportedSession('));

function harness({knownId = null, confirmationOk = true, uploadError = null} = {}) {
  const calls = {uploads: 0, selections: 0, confirmations: []};
  let markerVisible = true;
  const context = {
    location: {href: 'https://x.com/compose/articles/test'},
    importGate: {assert() {}},
    setStatus() {},
    selectMarker() { calls.selections += 1; return true; },
    findMarker() { return markerVisible ? {} : null; },
    async uploadFile() {
      calls.uploads += 1;
      if (uploadError) throw uploadError;
      return {ok: true, mediaId: '2110601778198945792'};
    },
    async bridgeRequest(kind, payload) {
      calls.confirmations.push({kind, payload});
      markerVisible = !confirmationOk;
      return {ok: confirmationOk, error: confirmationOk ? null : '图片已上传，位置尚未稳定'};
    }
  };
  runInNewContext(stateSource + '\n' + loopSource + '\nthis.api = {createImportRetryState, uploadRemainingImages};', context);
  const session = context.api.createImportRetryState({
    articleUrl: context.location.href, root: {isConnected: true}, fileName: 'article.md',
    parsed: {assets: [{name: 'image.png', marker: 'XABIMG0'}]}, images: [{}]
  });
  session.mediaIds[0] = knownId;
  return {calls, session, run: () => context.api.uploadRemainingImages(session, {})};
}

test('an uploaded image waits for placement confirmation while the DOM still shows its marker', async () => {
  const h = harness();
  await h.run();
  assert.equal(h.calls.uploads, 1);
  assert.equal(h.calls.confirmations[0].kind, 'confirm-media-placement');
  assert.equal(h.calls.confirmations[0].payload.mediaId, '2110601778198945792');
  assert.equal(h.session.completedCount, 1);
});

test('retrying an uploaded image confirms its position without sending its file again', async () => {
  const h = harness({knownId: '2110601778198945792'});
  await h.run();
  assert.equal(h.calls.uploads, 0);
  assert.equal(h.calls.selections, 0);
  assert.equal(h.calls.confirmations.length, 1);
  assert.equal(h.session.completedCount, 1);
});

test('placement timeout retains the server identity for the next retry', async () => {
  const h = harness({confirmationOk: false});
  await assert.rejects(h.run(), /位置尚未稳定/);
  assert.equal(h.session.mediaIds[0], '2110601778198945792');
  assert.equal(h.session.nextIndex, 0);
  assert.equal(h.session.failedIndex, 0);
});

test('an upload with a known server identity preserves it even if initial relocation fails', async () => {
  const error = Object.assign(new Error('位置回写尚未完成'), {mediaId: '2110601778198945792'});
  const h = harness({uploadError: error});
  await assert.rejects(h.run(), /位置回写/);
  assert.equal(h.session.mediaIds[0], error.mediaId);
});
