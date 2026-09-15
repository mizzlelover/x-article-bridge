import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../src/main-world.js', import.meta.url), 'utf8');
const context = {};
runInNewContext(source.slice(source.indexOf('  function uploadedMedia('), source.indexOf('  async function waitForNewAtomic')) + '\nthis.check=uploadedMedia;', context);
const block = {getType:()=> 'atomic', getCharacterList:()=> [{getEntity:()=> 'key'}]};
const content = (data, type = 'MEDIA') => ({getEntity:()=> ({getType:()=>type,getData:()=>data})});

test('an atomic placeholder or blob preview is not a completed upload', () => {
  assert.equal(context.check(content({}),block),false);
  assert.equal(context.check(content({url:'blob:preview',width:1672}),block),false);
});
test('a MEDIA entity with a server media ID is eligible for placement', () => {
  assert.equal(context.check(content({mediaItems:[{media_id:'2099462484746969088'}]}),block),true);
  assert.equal(context.check(content({media_id:'2099462484746969088'},'OTHER'),block),false);
});
