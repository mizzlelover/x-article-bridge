import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const context = { File, fetch: async () => { throw new Error('Local images must not use fetch'); } };
runInNewContext(source.slice(source.indexOf('function isLocalAsset'), source.indexOf('async function importArticle')) + '\nthis.api={assetFile,matchLocalAsset};', context);

test('relative MD image resolves to the selected local file, without network', async () => {
  const file = new File(['image bytes'], '图.png', { type: 'image/png' });
  assert.equal(await context.api.assetFile({source:'./图.png'}, [file]), file);
  await assert.rejects(context.api.assetFile({source:'missing.png'}, [file]), /缺少图片/);
});

test('directory matching prefers the referenced path and rejects ambiguous names', () => {
  const one = {name:'a.png',webkitRelativePath:'root/one/a.png'};
  const two = {name:'a.png',webkitRelativePath:'root/two/a.png'};
  assert.equal(context.api.matchLocalAsset('two/a.png', [one,two]), two);
  assert.throws(() => context.api.matchLocalAsset('a.png', [one,two]), /不唯一|重名/);
});

test('HTTP success with an HTML body is not accepted as an image', async () => {
  context.fetch = async () => new Response('<html>not an image</html>', {headers:{'content-type':'text/html'}});
  await assert.rejects(context.api.assetFile({source:'https://example.com/a.png',name:'a.png'}), /不是图片/);
});
