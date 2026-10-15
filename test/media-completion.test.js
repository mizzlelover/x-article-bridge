import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../src/main-world.js', import.meta.url), 'utf8');
const context = {};
const start = source.includes('  function serverMediaIds(')
  ? source.indexOf('  function serverMediaIds(')
  : source.indexOf('  function uploadedMedia(');
const blockHelpers = source.slice(source.indexOf('  function atomicBlockKeys('), source.indexOf('  function orderBlocks('));
runInNewContext(blockHelpers + source.slice(start, source.indexOf('  async function waitForNewAtomic')) + `
this.check = uploadedMedia;
this.serverIds = typeof serverMediaIds === 'function' ? serverMediaIds : undefined;
this.findNew = typeof findUploadedMedia === 'function' ? findUploadedMedia : undefined;
`, context);
const block = {getType:()=> 'atomic', getCharacterList:()=> [{getEntity:()=> 'key'}]};
const content = (data, type = 'MEDIA') => ({getEntity:()=> ({getType:()=>type,getData:()=>data})});
const serverId = (index) => String(2099462484746969088n + BigInt(index));
const snapshot = (items) => {
  const blocks = new Map(items.map(([key]) => [key, {
    getType: () => 'atomic',
    getCharacterList: () => [{getEntity: () => key}]
  }]));
  const entities = new Map(items.map(([key, data]) => [key, {
    getType: () => 'MEDIA', getData: () => data
  }]));
  return {getBlockMap: () => blocks, getEntity: key => entities.get(key)};
};

test('an atomic placeholder or blob preview is not a completed upload', () => {
  assert.equal(context.check(content({}),block),false);
  assert.equal(context.check(content({url:'blob:preview',width:1672}),block),false);
});
test('a MEDIA entity with a server media ID is eligible for placement', () => {
  assert.equal(context.check(content({mediaItems:[{media_id:serverId(0)}]}),block),true);
  assert.equal(context.check(content({media_id:serverId(0)},'OTHER'),block),false);
});
test('serverMediaIds extracts nested server identities, rejecting previews and unrelated entities', () => {
  assert.equal(typeof context.serverIds, 'function');
  const data = {mediaItems: [
    {media_id: serverId(0)},
    {mediaIdString: serverId(1)},
    {media_key: `3_${serverId(2)}`},
    {url: 'blob:preview', id: serverId(3), media_id: '1234'}
  ]};
  assert.deepEqual(Array.from(context.serverIds(content(data), block)), [serverId(0), serverId(1), `3_${serverId(2)}`]);
  assert.deepEqual(Array.from(context.serverIds(content(data, 'OTHER'), block)), []);
  assert.deepEqual(Array.from(context.serverIds(content(data), {...block, getType: () => 'unstyled'})), []);
});
test('a reused block key with a new server media ID completes an upload', () => {
  assert.equal(typeof context.findNew, 'function');
  const after = snapshot([['reused', {mediaItems: [{media_id: serverId(1)}]}]]);
  assert.equal(context.findNew(after, new Set([serverId(0)])), 'reused');
});
test('a new block key containing only an old server media ID is ignored', () => {
  assert.equal(typeof context.findNew, 'function');
  const after = snapshot([
    ['replacement-key', {media_id: serverId(0)}],
    ['pending', {url: 'blob:preview'}],
    ['actual-upload', {media_id: serverId(1)}]
  ]);
  assert.equal(context.findNew(after, new Set([serverId(0)])), 'actual-upload');
  assert.ok(!context.findNew(after, new Set([serverId(0), serverId(1)])));
});
for (const count of [6, 25]) {
  test(`${count} sequential uploads keep a server identity baseline even when block keys are recycled`, () => {
    assert.equal(typeof context.findNew, 'function');
    assert.equal(typeof context.serverIds, 'function');
    let current = snapshot([['reused', {url: 'blob:preview'}]]);
    const completed = [];
    for (let index = 0; index < count; index += 1) {
      const before = new Set([...current.getBlockMap().values()].flatMap(item => Array.from(context.serverIds(current, item))));
      current = snapshot([
        ...completed.map((id, position) => [`existing-${position}-${index}`, {media_id: id}]),
        ['reused', {media_id: serverId(index)}]
      ]);
      assert.equal(context.findNew(current, before), 'reused', `upload ${index + 1}`);
      completed.push(serverId(index));
      assert.equal(new Set(completed).size, index + 1);
    }
  });
}
