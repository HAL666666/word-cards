/* ことばアルバム — 純粋ロジック（DOMなし）。ブラウザでは window.WC、node では module.exports。
   カードの検証・正規化、cards.json の取り込みマージ、おぼえた度（かんたん間隔反復）、クイズ出題。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LANGS = ['en', 'ja', 'zh'];
  const DAY = 86400000;
  // 箱ごとの次回までの日数（0=すぐ, 6=ほぼおぼえた）
  const INTERVALS = [0, 1, 2, 4, 7, 14, 30];
  const MAX_BOX = INTERVALS.length - 1;

  const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
  const slug = (s) => str(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  function makeId(en, existing) {
    const base = slug(en) || 'card';
    const has = (id) => (existing instanceof Set ? existing.has(id) : Array.isArray(existing) ? existing.includes(id) : false);
    if (!has(base)) return base;
    for (let i = 2; i < 1000; i++) if (!has(base + '-' + i)) return base + '-' + i;
    return base + '-' + Date.now().toString(36);
  }

  // 画像・音声の参照として許すもの：相対パス / http(s) / data:image|audio / idb:<id>（端末内）
  function safeRef(v, kind) {
    const s = str(v, 3_000_000);
    if (!s) return '';
    if (/^idb:[\w.-]+$/.test(s)) return s;
    if (s.startsWith('data:')) return new RegExp('^data:' + kind + '/[\\w.+-]+;base64,').test(s) ? s : '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return ''; // javascript: などは拒否
    if (s.includes('..')) return '';
    return s.replace(/^\.\//, '');
  }

  function isYouTubeUrl(u) {
    return /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(str(u, 500));
  }

  function normalizeVideo(v) {
    if (!v || typeof v !== 'object') return null;
    const id = str(v.id, 80) || slug(v.title) || null;
    if (!id) return null;
    const url = str(v.url, 500);
    return {
      id, title: str(v.title, 120) || id, date: /^\d{4}-\d{2}-\d{2}$/.test(str(v.date)) ? str(v.date) : '',
      place: str(v.place, 120), url: /^https?:\/\//i.test(url) ? url : '', emoji: str(v.emoji, 8),
      rev: Number.isFinite(+v.rev) ? +v.rev : 0,
    };
  }

  function validateCard(c) {
    const errors = [];
    if (!c || typeof c !== 'object') return ['カードの形がへんです'];
    if (!str(c.en)) errors.push('えいご（en）がありません');
    if (c.audio != null && typeof c.audio !== 'object') errors.push('audio は {en,ja,zh} の形にしてください');
    return errors;
  }

  /* also：同じことばが出てくる ほかの Short（[{video, at}]）。メインの video と重複は除く */
  function normalizeAlso(list, mainVideo) {
    if (!Array.isArray(list)) return [];
    const seen = new Set([mainVideo || '']); const out = [];
    for (const a of list) {
      const video = str(a && (typeof a === 'string' ? a : a.video), 80);
      if (!video || seen.has(video)) continue;
      seen.add(video);
      const at = a && typeof a === 'object' && a.at !== '' && a.at != null && Number.isFinite(+a.at) ? +a.at : null;
      out.push({ video, at });
      if (out.length >= 20) break;
    }
    return out;
  }

  function normalizeCard(c, opts = {}) {
    const audio = {};
    for (const l of LANGS) { const a = safeRef(c.audio && c.audio[l], 'audio'); if (a) audio[l] = a; }
    const out = {
      id: str(c.id, 80) || makeId(c.en, opts.existingIds),
      video: str(c.video, 80),
      en: str(c.en, 120), kana: str(c.kana, 120), ja: str(c.ja, 120),
      zh: str(c.zh, 120), pinyin: str(c.pinyin, 120),
      image: safeRef(c.image, 'image'), emoji: str(c.emoji, 8),
      audio, note: str(c.note, 300),
      at: Number.isFinite(+c.at) && c.at !== '' && c.at != null ? +c.at : null,
      also: normalizeAlso(c.also, str(c.video, 80)),
      rev: Number.isFinite(+c.rev) ? +c.rev : 0,
      source: opts.source || str(c.source, 20) || 'user',
      edited: !!c.edited, deleted: !!c.deleted,
      updatedAt: Number.isFinite(+c.updatedAt) ? +c.updatedAt : (opts.now || 0),
    };
    return out;
  }

  /* cards.json / バックアップ / 配列 を読み取り、{videos, cards, progress, errors} を返す */
  function parseCardsFile(json) {
    let data = json;
    if (typeof json === 'string') {
      try { data = JSON.parse(json); } catch (e) { return { videos: [], cards: [], progress: [], errors: ['JSONとして読めません'] }; }
    }
    if (Array.isArray(data)) data = { cards: data };
    if (!data || typeof data !== 'object' || !Array.isArray(data.cards)) {
      return { videos: [], cards: [], progress: [], errors: ['cards の一覧が見つかりません'] };
    }
    const errors = [];
    const ids = new Set();
    const cards = [];
    data.cards.forEach((c, i) => {
      const e = validateCard(c);
      if (e.length) { errors.push(`${i + 1}まいめ: ${e.join('、')}`); return; }
      const n = normalizeCard(c, { existingIds: ids, source: c.source });
      if (ids.has(n.id)) { errors.push(`${i + 1}まいめ: id「${n.id}」がかぶっています`); return; }
      ids.add(n.id); cards.push(n);
    });
    const videos = (Array.isArray(data.videos) ? data.videos : []).map(normalizeVideo).filter(Boolean);
    const progress = (Array.isArray(data.progress) ? data.progress : []).filter((p) => p && ids.has(p.id)).map(normalizeProgress);
    return { videos, cards, progress, errors, kind: data.format === 'word-cards-backup' ? 'backup' : 'cards' };
  }

  /* 取り込みマージ。local: 端末のカード一覧, incoming: 新しいカード一覧。
     mode 'repo' : リポジトリの cards.json。rev が上がったものだけ更新。端末で直した/消したカードは触らない。
     mode 'file' : ファイル取り込み。同じ id は updatedAt が新しい方、なければ追加。 */
  function mergeCards(local, incoming, mode = 'repo', now = Date.now()) {
    const byId = new Map(local.map((c) => [c.id, c]));
    const put = []; const stats = { added: 0, updated: 0, kept: 0, same: 0 };
    for (const inc of incoming) {
      const cur = byId.get(inc.id);
      if (mode === 'repo') {
        const next = { ...inc, source: 'repo', edited: false, deleted: false, updatedAt: now };
        if (!cur) { put.push(next); stats.added++; continue; }
        if (cur.deleted || cur.edited) { stats.kept++; continue; }
        if ((inc.rev || 0) > (cur.rev || 0)) { put.push(next); stats.updated++; } else stats.same++;
      } else {
        if (!cur) { put.push({ ...inc, updatedAt: inc.updatedAt || now }); stats.added++; continue; }
        if ((inc.updatedAt || 0) > (cur.updatedAt || 0) || (inc.rev || 0) > (cur.rev || 0)) {
          put.push({ ...inc, edited: inc.source === 'repo' ? inc.edited : true, updatedAt: inc.updatedAt || now }); stats.updated++;
        } else stats.same++;
      }
    }
    return { put, stats };
  }

  function mergeVideos(local, incoming, mode = 'repo') {
    const byId = new Map(local.map((v) => [v.id, v]));
    const put = [];
    for (const v of incoming) {
      const cur = byId.get(v.id);
      if (!cur) put.push(v);
      else if (cur.edited) continue;
      else if (mode === 'file' || (v.rev || 0) >= (cur.rev || 0)) {
        if (JSON.stringify({ ...cur, edited: undefined }) !== JSON.stringify({ ...v, edited: undefined })) put.push({ ...v, edited: mode === 'file' ? !!v.edited : false });
      }
    }
    return put;
  }

  /* ---- おぼえた度（Leitner式のかんたん版） ---- */
  function normalizeProgress(p) {
    return {
      id: str(p.id, 80), box: Math.max(0, Math.min(MAX_BOX, p.box | 0)),
      due: +p.due || 0, seen: p.seen | 0, known: p.known | 0, again: p.again | 0, last: +p.last || 0,
      quizRight: p.quizRight | 0, quizWrong: p.quizWrong | 0,
    };
  }
  function newProgress(id) { return normalizeProgress({ id }); }

  function grade(p, result, now = Date.now()) {
    const q = { ...(p || {}) };
    const n = normalizeProgress(q.id ? q : { ...q, id: q.id || '' });
    n.seen++; n.last = now;
    if (result === 'known') { n.known++; n.box = Math.min(MAX_BOX, n.box + 1); n.due = now + INTERVALS[n.box] * DAY; }
    else { n.again++; n.box = 0; n.due = now; }
    return n;
  }

  function isDue(p, now = Date.now()) { return !p || !p.seen || p.due <= now; }

  /* めくるモードの順番：期限がきた（よわい順）→ まだ見てない → （all のとき）期限前 */
  function sessionOrder(cards, progMap, now = Date.now(), all = false) {
    const get = (c) => progMap.get ? progMap.get(c.id) : progMap[c.id];
    const due = [], fresh = [], later = [];
    for (const c of cards) {
      const p = get(c);
      if (!p || !p.seen) fresh.push(c);
      else if (p.due <= now) due.push(c);
      else later.push(c);
    }
    due.sort((a, b) => (get(a).box - get(b).box) || (get(a).due - get(b).due));
    later.sort((a, b) => get(a).due - get(b).due);
    return all ? [...due, ...fresh, ...later] : [...due, ...fresh];
  }

  function stars(p) { return p ? Math.min(3, Math.floor((p.box + 1) / 2)) : 0; } // 0〜3こ

  /* ---- クイズ ---- */
  function rng32(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function shuffle(arr, rand = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const key = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

  function makeQuestion(target, pool, rand = Math.random, n = 3) {
    const seen = new Set([key(target.en)]);
    const others = [];
    for (const c of shuffle(pool, rand)) {
      if (c.id === target.id || seen.has(key(c.en))) continue;
      seen.add(key(c.en)); others.push(c);
      if (others.length >= n - 1) break;
    }
    const choices = shuffle([target, ...others], rand).map((c) => ({ id: c.id, en: c.en }));
    return { id: target.id, answer: target.en, choices };
  }

  /* 1ラウンド分の問題。よわいカードを多めに。カードが length より少なければ重複なしで回す */
  function makeRound(cards, progMap, length = 5, rand = Math.random) {
    const usable = cards.filter((c) => c.en && !c.deleted);
    if (usable.length < 2) return [];
    const get = (c) => (progMap.get ? progMap.get(c.id) : progMap[c.id]);
    const weight = (c) => { const p = get(c); return p ? MAX_BOX + 1 - p.box : MAX_BOX + 2; };
    const ordered = shuffle(usable, rand).sort((a, b) => weight(b) - weight(a));
    const picks = [];
    for (let i = 0; i < length; i++) {
      // 前の問題とおなじカードは続けない
      let c = ordered[i % ordered.length];
      if (picks.length && picks[picks.length - 1].id === c.id && ordered.length > 1) c = ordered[(i + 1) % ordered.length];
      picks.push(makeQuestion(c, usable, rand));
    }
    return picks;
  }

  function roundStars(firstTryRight, total) {
    if (!total) return 0;
    const r = firstTryRight / total;
    return r >= 0.99 ? 3 : r >= 0.6 ? 2 : r > 0 ? 1 : 0;
  }

  /* ---- 書き出し ---- */
  function buildBackup({ cards, videos, progress, settings, now = Date.now() }) {
    return {
      format: 'word-cards-backup', version: 1, exportedAt: new Date(now).toISOString(),
      videos, cards, progress, settings,
    };
  }

  /* リポジトリ用 cards.json の形（端末のみの項目をはずす） */
  function toRepoCard(c) {
    const o = { id: c.id, video: c.video, en: c.en, kana: c.kana, ja: c.ja, zh: c.zh, pinyin: c.pinyin, image: c.image, audio: c.audio, note: c.note, rev: c.rev || 1 };
    if (c.at != null) o.at = c.at;
    if (c.also && c.also.length) o.also = c.also.map((a) => (a.at != null ? { video: a.video, at: a.at } : { video: a.video }));
    if (c.emoji) o.emoji = c.emoji;
    for (const k of Object.keys(o)) if (o[k] === '' || o[k] == null || (typeof o[k] === 'object' && !Object.keys(o[k]).length)) delete o[k];
    return o;
  }

  function fmtDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? `${+m[1]}/${+m[2]}/${+m[3]}` : '';
  }

  return {
    LANGS, INTERVALS, MAX_BOX, DAY, slug, makeId, safeRef, isYouTubeUrl, normalizeVideo, validateCard, normalizeCard, normalizeAlso,
    parseCardsFile, mergeCards, mergeVideos, normalizeProgress, newProgress, grade, isDue, sessionOrder, stars,
    rng32, shuffle, makeQuestion, makeRound, roundStars, buildBackup, toRepoCard, fmtDate,
  };
});
