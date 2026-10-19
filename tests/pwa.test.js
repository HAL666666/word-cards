// PWA の基本チェック：SW の SHELL が全部あるか・manifest・アイコン・DBの追加型マイグレーション
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('sw.js: SHELL のファイルが全部ある・キャッシュ名に版番号', () => {
  const sw = read('sw.js');
  assert.match(sw, /const CACHE = 'wordcards-shell-v\d+'/);
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  for (const f of shell) if (f !== './') assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  // index.html が読むスクリプト・CSS は SHELL に入っている
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) assert.ok(shell.includes('./' + m[1]), m[1] + ' が SHELL にない');
});

test('manifest: 必要な項目とアイコン', () => {
  const m = JSON.parse(read('manifest.json'));
  for (const k of ['name', 'short_name', 'start_url', 'display', 'icons']) assert.ok(m[k], k);
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, i.src)), i.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('db.js: ストアは contains チェックつきで足すだけ（deleteObjectStore しない）', () => {
  const db = read('js/db.js');
  assert.doesNotMatch(db, /deleteObjectStore/);
  const creates = [...db.matchAll(/createObjectStore\('(\w+)'/g)].map((m) => m[1]);
  for (const s of creates) assert.match(db, new RegExp(`contains\\('${s}'\\)`), s);
  assert.deepEqual(creates.sort(), ['cards', 'media', 'meta', 'progress', 'videos']);
});

test('app.js: storage.persist を呼ぶ・SW 登録', () => {
  const app = read('js/app.js');
  assert.match(app, /navigator\.storage\.persist\(\)/);
  assert.match(app, /serviceWorker\.register\('sw\.js'\)/);
});
