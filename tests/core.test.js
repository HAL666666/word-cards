// node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WC = require('../js/core.js');
const ROOT = path.join(__dirname, '..');

test('cards.json は正しい形で、画像・音声ファイルが全部ある', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf8'));
  assert.equal(raw.format, 'word-cards');
  const r = WC.parseCardsFile(raw);
  assert.deepEqual(r.errors, []);
  assert.equal(r.cards.length, 37);
  assert.equal(r.videos.length, 36);
  const vids = new Set(r.videos.map((v) => v.id));
  for (const c of r.cards) {
    assert.ok(vids.has(c.video), `${c.id}: video ${c.video} が videos にない`);
    assert.ok(c.image && fs.existsSync(path.join(ROOT, c.image)), `${c.id}: image ${c.image}`);
    for (const l of WC.LANGS) {
      assert.ok(c[l], `${c.id}: ${l} が空`);
      assert.ok(c.audio[l] && fs.existsSync(path.join(ROOT, c.audio[l])), `${c.id}: audio.${l}`);
      assert.ok(fs.statSync(path.join(ROOT, c.audio[l])).size > 2000, `${c.id}: audio.${l} が小さすぎ`);
    }
    assert.ok(c.kana && /^[\u3040-\u309f\u30fc\s！!？?]+$/.test(c.kana), `${c.id}: kana はひらがな`);
    assert.ok(c.pinyin, `${c.id}: pinyin`);
  }
  assert.deepEqual(r.cards.slice(0, 3).map((c) => c.en), ['whale shark', 'penguin', "It's yummy!"]);
  assert.equal(new Set(r.cards.map((c) => c.id)).size, 37);
  for (const v of r.videos) {
    assert.equal(v.url, '', `${v.id}: まだ公開していないので url は空`);
    assert.ok(!/itabashi|toda|warabi|板橋|戸田|蕨/i.test(JSON.stringify(v)), `${v.id}: 地名`);
  }
  const ws = r.cards.find((c) => c.id === 'whale-shark');
  assert.ok(ws.rev >= 2 && /クジラ/.test(ws.note) && /サメ/.test(ws.note), 'whale shark の分解');
  assert.equal(r.videos.find((v) => v.id === ws.video).date, '2026-08-23');
  assert.equal(r.videos.find((v) => v.id === r.cards.find((c) => c.id === 'penguin').video).date, '2026-08-25');
});

test('parseCardsFile: 配列・バックアップ・こわれたJSON', () => {
  assert.equal(WC.parseCardsFile('{oops').errors.length, 1);
  const a = WC.parseCardsFile([{ en: 'honey', ja: 'はちみつ' }, { ja: 'no english' }, { id: 'honey', en: 'dup' }]);
  assert.equal(a.cards.length, 1);
  assert.equal(a.cards[0].id, 'honey');
  assert.equal(a.errors.length, 2);
  const b = WC.parseCardsFile({ format: 'word-cards-backup', cards: [{ id: 'x', en: 'x' }], progress: [{ id: 'x', box: 3 }, { id: 'zzz', box: 1 }] });
  assert.equal(b.kind, 'backup');
  assert.equal(b.progress.length, 1);
});

test('safeRef: あぶない参照は捨てる', () => {
  assert.equal(WC.safeRef('javascript:alert(1)', 'image'), '');
  assert.equal(WC.safeRef('../../etc/passwd', 'image'), '');
  assert.equal(WC.safeRef('data:text/html;base64,AAAA', 'image'), '');
  assert.equal(WC.safeRef('data:image/jpeg;base64,AAAA', 'image'), 'data:image/jpeg;base64,AAAA');
  assert.equal(WC.safeRef('./media/img/a.jpg', 'image'), 'media/img/a.jpg');
  assert.equal(WC.safeRef('idb:img-a-1', 'image'), 'idb:img-a-1');
  assert.equal(WC.safeRef('https://x.example/a.mp3', 'audio'), 'https://x.example/a.mp3');
});

test('makeId: 英語からidを作り、かぶりを避ける', () => {
  assert.equal(WC.makeId("It's yummy!", []), 'it-s-yummy');
  assert.equal(WC.makeId('Honey', new Set(['honey'])), 'honey-2');
  assert.equal(WC.makeId('ありがとう', []), 'card');
});

test('mergeCards repo: 追加・rev更新・端末で直した/消したカードは守る', () => {
  const inc = WC.parseCardsFile([{ id: 'a', en: 'a', rev: 2 }, { id: 'b', en: 'b', rev: 1 }, { id: 'c', en: 'c', rev: 5 }, { id: 'd', en: 'd', rev: 9 }, { id: 'e', en: 'e', rev: 1 }]).cards;
  const local = [
    { id: 'a', en: 'a', rev: 1, source: 'repo' },
    { id: 'b', en: 'b', rev: 1, source: 'repo' },
    { id: 'c', en: 'mine', rev: 1, source: 'repo', edited: true },
    { id: 'd', en: 'd', rev: 1, source: 'repo', deleted: true },
  ];
  const { put, stats } = WC.mergeCards(local, inc, 'repo', 1000);
  assert.deepEqual(stats, { added: 1, updated: 1, kept: 2, same: 1 });
  assert.deepEqual(put.map((c) => c.id).sort(), ['a', 'e']);
  assert.ok(put.every((c) => c.source === 'repo' && !c.edited));
});

test('mergeCards file: 新しい方が勝つ', () => {
  const local = [{ id: 'a', en: 'old', updatedAt: 100 }, { id: 'b', en: 'keep', updatedAt: 500 }];
  const inc = [{ id: 'a', en: 'new', updatedAt: 200 }, { id: 'b', en: 'older', updatedAt: 300 }, { id: 'c', en: 'c' }];
  const { put, stats } = WC.mergeCards(local, inc, 'file', 999);
  assert.deepEqual(stats, { added: 1, updated: 1, kept: 0, same: 1 });
  assert.equal(put.find((c) => c.id === 'a').en, 'new');
});

test('mergeVideos: 端末で直したビデオは上書きしない', () => {
  const put = WC.mergeVideos([{ id: 'v', title: 'mine', edited: true }, { id: 'w', title: 'old' }], [{ id: 'v', title: 'repo' }, { id: 'w', title: 'new' }, { id: 'x', title: 'x' }], 'repo');
  assert.deepEqual(put.map((v) => v.id), ['w', 'x']);
});

test('grade: おぼえた で箱が上がり、もういちど で0にもどる', () => {
  const now = 1_000_000_000_000;
  let p = WC.newProgress('a');
  p = WC.grade(p, 'known', now);
  assert.equal(p.box, 1); assert.equal(p.due, now + WC.DAY);
  p = WC.grade(p, 'known', now);
  assert.equal(p.box, 2); assert.equal(p.due, now + 2 * WC.DAY);
  for (let i = 0; i < 10; i++) p = WC.grade(p, 'known', now);
  assert.equal(p.box, WC.MAX_BOX);
  p = WC.grade(p, 'again', now);
  assert.equal(p.box, 0); assert.equal(p.due, now); assert.equal(p.again, 1); assert.equal(p.seen, 13);
});

test('sessionOrder: 期限きた(よわい順)→はじめて→(all)期限前', () => {
  const now = 10 * WC.DAY;
  const cards = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const prog = new Map([
    ['a', { id: 'a', seen: 3, box: 3, due: now - 1 }],
    ['b', { id: 'b', seen: 1, box: 0, due: now - 5 }],
    ['d', { id: 'd', seen: 2, box: 2, due: now + WC.DAY }],
  ]);
  assert.deepEqual(WC.sessionOrder(cards, prog, now).map((c) => c.id), ['b', 'a', 'c']);
  assert.deepEqual(WC.sessionOrder(cards, prog, now, true).map((c) => c.id), ['b', 'a', 'c', 'd']);
});

test('makeQuestion: 3択・正解が1つ・英語がかぶらない', () => {
  const cards = WC.parseCardsFile(JSON.parse(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf8'))).cards
    .concat([{ id: 'dup', en: 'Penguin' }, { id: 'cat', en: 'cat' }]);
  const rand = WC.rng32(42);
  for (let k = 0; k < 200; k++) {
    const t = cards[k % cards.length];
    const q = WC.makeQuestion(t, cards, rand);
    assert.equal(q.choices.length, 3);
    assert.equal(q.choices.filter((c) => c.id === t.id).length, 1);
    const keys = q.choices.map((c) => c.en.toLowerCase().replace(/[^a-z0-9]/g, ''));
    assert.equal(new Set(keys).size, 3);
  }
});

test('makeRound: 長さ・連続しない・2まいでもOK・1まいは無理', () => {
  const cards = [{ id: 'a', en: 'a' }, { id: 'b', en: 'b' }, { id: 'c', en: 'c' }];
  const r = WC.makeRound(cards, new Map(), 5, WC.rng32(7));
  assert.equal(r.length, 5);
  for (let i = 1; i < r.length; i++) assert.notEqual(r[i].id, r[i - 1].id);
  assert.equal(WC.makeRound(cards.slice(0, 2), new Map(), 4, WC.rng32(1))[0].choices.length, 2);
  assert.equal(WC.makeRound(cards.slice(0, 1), new Map(), 4).length, 0);
});

test('roundStars / stars', () => {
  assert.equal(WC.roundStars(5, 5), 3); assert.equal(WC.roundStars(3, 5), 2); assert.equal(WC.roundStars(1, 5), 1); assert.equal(WC.roundStars(0, 5), 0);
  assert.equal(WC.stars(null), 0); assert.equal(WC.stars({ box: 1 }), 1); assert.equal(WC.stars({ box: 6 }), 3);
});

test('toRepoCard: 端末だけの項目をはずす', () => {
  const o = WC.toRepoCard({ id: 'a', en: 'a', ja: '', audio: {}, source: 'user', edited: true, updatedAt: 5, image: 'media/img/a.jpg' });
  assert.deepEqual(o, { id: 'a', en: 'a', image: 'media/img/a.jpg', rev: 1 });
});

test('also：ほかの Short へのリンク（正規化・cards.json の整合）', () => {
  const n = WC.normalizeCard({ en: 'x', video: 'a', also: [{ video: 'b', at: '12.5' }, { video: 'a', at: 1 }, { video: 'b' }, 'c', { at: 3 }, null] });
  assert.deepEqual(n.also, [{ video: 'b', at: 12.5 }, { video: 'c', at: null }]);
  assert.deepEqual(WC.normalizeCard({ en: 'x' }).also, []);
  assert.deepEqual(WC.toRepoCard({ ...n, rev: 1 }).also, [{ video: 'b', at: 12.5 }, { video: 'c' }]);
  assert.equal('also' in WC.toRepoCard(WC.normalizeCard({ en: 'y' })), false);
  const r = WC.parseCardsFile(JSON.parse(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf8')));
  const vids = new Set(r.videos.map((v) => v.id));
  for (const c of r.cards) for (const a of c.also) {
    assert.ok(vids.has(a.video), `${c.id}: also ${a.video} が videos にない`);
    assert.notEqual(a.video, c.video, `${c.id}: also にメインと同じ video`);
  }
  const y = r.cards.find((c) => c.id === 'its-yummy');
  assert.equal(y.video, 's03-choco-banana');
  assert.equal(y.at, 46.2);
  assert.ok(y.rev >= 4, 'its-yummy は rev を上げて端末にも反映');
  assert.ok(y.also.some((a) => a.video === 's20-egg-icecream'), 'its-yummy は #20 にも出てくる');
});
