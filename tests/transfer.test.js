// 引っ越し用 書き出し/読み込み（js/transfer.js）の形チェック。node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/transfer.js');

const good = () => ({ app: 'kotoba-album', version: 2, full: true, exportedAt: '2026-10-20T00:00:00Z', data: {
  cards: [{ id: 'whale-shark', en: 'whale shark', image: 'idb:img-1' }], videos: [{ id: 'v1' }], progress: [{ id: 'whale-shark', box: 2 }],
  media: [{ id: 'img-1', blob: { __blob: 'data:image/jpeg;base64,/9j/' } }], meta: [{ key: 'settings', value: { rate: 0.9 } }] } });

test('ファイル名：アプリ名・スキーマ版・日付', () => {
  assert.equal(T.fileName(new Date(2026, 9, 20)), 'kotoba-album-all-v2-2026-10-20.json');
});
test('正しいファイルは OK', () => { assert.deepEqual(T.validate(good()), { kind: 'full', errors: [] }); });
test('他のアプリ・版ちがい・壊れたものは はじく', () => {
  assert.match(T.validate({ ...good(), app: 'lifelog' }).errors[0], /このアプリのファイルではありません/);
  assert.match(T.validate({ ...good(), version: 9 }).errors[0], /新しすぎる/);
  assert.match(T.validate({ ...good(), version: 'x' }).errors[0], /バージョン/);
  assert.ok(T.validate(null).errors.length);
  assert.ok(T.validate([]).errors.length);
  const g = good(); g.data.media[0].blob = 'nope'; assert.ok(T.validate(g).errors.length);
  const h = good(); h.data.cards = {}; assert.ok(T.validate(h).errors.length);
  const k = good(); k.data.cards.push({ en: 'no id' }); assert.ok(T.validate(k).errors.length);
});
test('以前の word-cards-backup は legacy（統合で読む）', () => {
  assert.equal(T.validate({ format: 'word-cards-backup', version: 1, cards: [] }).kind, 'legacy');
});
test('まるごとファイルは 古い取り込み（parseCardsFile）では何もしない', () => {
  const WC = require('../js/core.js');
  assert.equal(WC.parseCardsFile(JSON.stringify(good())).cards.length, 0);
});
test('sw.js と index.html に transfer.js', () => {
  const fs = require('fs'); const path = require('path');
  assert.match(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), /'\.\/js\/transfer\.js'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'), /js\/transfer\.js/);
});
