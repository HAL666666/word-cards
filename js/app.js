/* ことばアルバム — 画面とうごき */
(function () {
  'use strict';
  const APP_VERSION = '1.2.0';
  const MEDIA_CACHE = 'wordcards-media-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const DEFAULTS = {
    show: { ja: true, zh: true, pinyin: true, kana: true },
    rate: 0.9, autoplay: true, sfx: true, quizLen: 5, syncUrl: 'cards.json',
  };
  const S = { cards: [], all: [], videos: new Map(), prog: new Map(), settings: structuredClone(DEFAULTS), urls: new Map() };

  /* ---------- データ読み込み ---------- */
  async function loadAll() {
    const [cards, videos, prog, st] = await Promise.all([DB.all('cards'), DB.all('videos'), DB.all('progress'), DB.getMeta('settings', null)]);
    S.all = cards;
    S.cards = cards.filter((c) => !c.deleted).sort(byVideoThenOrder);
    S.videos = new Map(videos.map((v) => [v.id, v]));
    S.prog = new Map(prog.map((p) => [p.id, p]));
    if (st) S.settings = { ...structuredClone(DEFAULTS), ...st, show: { ...DEFAULTS.show, ...(st.show || {}) } };
    // 端末内の写真（idb:）を表示用URLに
    for (const c of S.cards) if (c.image && c.image.startsWith('idb:') && !S.urls.has(c.image)) {
      const m = await DB.get('media', c.image.slice(4));
      if (m && m.blob) S.urls.set(c.image, URL.createObjectURL(m.blob));
    }
  }
  function byVideoThenOrder(a, b) {
    const va = S.videos.get(a.video), vb = S.videos.get(b.video);
    const da = (va && va.date) || '', dbb = (vb && vb.date) || '';
    if (da !== dbb) return da < dbb ? 1 : -1;
    if ((a.at ?? 1e9) !== (b.at ?? 1e9)) return (a.at ?? 1e9) - (b.at ?? 1e9);
    return (a.order || 0) - (b.order || 0);
  }
  const src = (ref) => (!ref ? '' : ref.startsWith('idb:') ? (S.urls.get(ref) || '') : ref);
  const saveSettings = () => DB.setMeta('settings', S.settings);

  function picHTML(c, cls = '') {
    const u = src(c.image);
    if (u) return `<div class="pic ${cls}"><img src="${esc(u)}" alt="${esc(c.en)}" draggable="false" loading="lazy"></div>`;
    const hue = [...(c.en || 'a')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
    return `<div class="pic ${cls} ph" style="--h:${hue}"><span>${esc(c.emoji || (c.en || '?').slice(0, 1).toUpperCase())}</span></div>`;
  }

  /* ---------- 小物 ---------- */
  let toastT = 0;
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
  }
  function burst(emojis = ['⭐', '🎉', '✨', '💖', '🌈']) {
    const b = $('#burst'); b.innerHTML = '';
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('span');
      s.textContent = emojis[i % emojis.length];
      s.style.setProperty('--x', (Math.random() * 2 - 1) * 160 + 'px');
      s.style.setProperty('--y', -(80 + Math.random() * 260) + 'px');
      s.style.setProperty('--r', (Math.random() * 2 - 1) * 200 + 'deg');
      s.style.animationDelay = Math.random() * 0.12 + 's';
      b.appendChild(s);
    }
    b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
  }
  const sfx = (k) => { if (S.settings.sfx) Speech.sfx[k](); };
  const say = (c, lang) => Speech.say(c, lang, S.settings.rate);
  function ytAt(url, at) {
    if (!url) return '';
    if (at == null) return url;
    try { const u = new URL(url); u.searchParams.set('t', Math.floor(at) + 's'); return u.href; } catch (e) { return url; }
  }
  const langOn = (l) => l === 'en' || !!S.settings.show[l];
  const FLAG = { en: '🇺🇸', ja: '🇯🇵', zh: '🇹🇼' };
  const LNAME = { en: 'えいご', ja: 'にほんご', zh: 'ちゅうごくご' };

  /* 長おしボタン（おとな用）：0.8秒おしつづけると開く */
  function bindHold(root) {
    $$('.hold', root).forEach((b) => {
      let t = 0;
      const start = (e) => { e.preventDefault(); b.classList.add('holding'); t = setTimeout(() => { b.classList.remove('holding'); location.hash = b.dataset.href; }, 800); };
      const end = () => { clearTimeout(t); b.classList.remove('holding'); };
      b.addEventListener('pointerdown', start);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, end));
      b.addEventListener('click', (e) => { e.preventDefault(); if (!b.classList.contains('holding')) toast('おとなの人は ながおし してね'); });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  /* ---------- ルーター ---------- */
  const VIEWS = ['home', 'list', 'card', 'flash', 'quiz', 'edit', 'settings'];
  const TITLES = { home: 'ことばアルバム', list: 'カード', card: 'カード', flash: 'めくる', quiz: 'クイズ', edit: 'カードをつくる', settings: 'おとなメニュー' };
  let route = { view: 'home', arg: '' };
  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    const [view, ...rest] = h.split('/');
    return { view: VIEWS.includes(view) ? view : 'home', arg: rest.join('/') };
  }
  function parentOf(r) {
    if (r.view === 'card') return '#list';
    if (r.view === 'edit') return r.arg && r.arg !== 'new' ? '#card/' + r.arg : '#settings';
    return '#home';
  }
  async function render() {
    Speech.stop();
    route = parseHash();
    VIEWS.forEach((v) => { $('#v-' + v).hidden = v !== route.view; });
    $('#back').hidden = route.view === 'home';
    $('#title').textContent = TITLES[route.view];
    $('#bar-right').innerHTML = '';
    document.body.dataset.view = route.view;
    await ({ home: renderHome, list: renderList, card: renderCard, flash: renderFlash, quiz: renderQuiz, edit: renderEdit, settings: renderSettings })[route.view](route.arg);
    window.scrollTo(0, 0);
  }

  /* ---------- ホーム ---------- */
  function renderHome() {
    const now = Date.now();
    const due = WC.sessionOrder(S.cards, S.prog, now).length;
    const known = S.cards.filter((c) => (S.prog.get(c.id) || {}).box >= 3).length;
    const latest = [...S.videos.values()].filter((v) => S.cards.some((c) => c.video === v.id)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    $('#v-home').innerHTML = `
      <div class="hero">
        <img class="logo" src="icons/icon-192.png" alt="">
        <div><h2>ことばアルバム</h2><p>ビデオで みた ことばを おぼえよう！</p></div>
      </div>
      <nav class="tiles">
        <a class="tile t-flash" href="#flash"><span class="em">🃏</span><b>めくる</b>${due ? `<em class="badge">${due}</em>` : ''}</a>
        <a class="tile t-quiz" href="#quiz"><span class="em">⭐</span><b>クイズ</b></a>
        <a class="tile t-list wide" href="#list"><span class="em">🖼️</span><b>カード を みる</b><small>${S.cards.length} まい</small></a>
      </nav>
      <div class="meter" aria-label="おぼえた数"><span>おぼえた</span><div class="bar"><i style="width:${S.cards.length ? (known / S.cards.length) * 100 : 0}%"></i></div><b>${known}/${S.cards.length}</b></div>
      ${latest ? `<a class="latest" href="#list"><span>${esc(latest.emoji || '🎬')}</span><div><small>あたらしい ビデオ</small><b>${esc(latest.title)}</b></div></a>` : ''}
      <button class="hold grown" data-href="#settings"><span class="ring"></span>🔒 おとな <small>（ながおし）</small></button>`;
    bindHold($('#v-home'));
  }

  /* ---------- カード一覧（ビデオごと） ---------- */
  function groups() {
    const map = new Map();
    for (const c of S.cards) { const k = S.videos.has(c.video) ? c.video : ''; if (!map.has(k)) map.set(k, []); map.get(k).push(c); }
    return [...map.entries()].sort(([a], [b]) => {
      if (!a) return 1; if (!b) return -1;
      return ((S.videos.get(a).date || '') < (S.videos.get(b).date || '')) ? 1 : -1;
    });
  }
  function renderList() {
    if (!S.cards.length) {
      $('#v-list').innerHTML = `<div class="empty"><div class="em">📭</div><p>まだ カードが ないよ</p><a class="btn primary" href="#settings">おとなメニューへ</a></div>`;
      return;
    }
    $('#v-list').innerHTML = groups().map(([vid, cards]) => {
      const v = S.videos.get(vid);
      const head = v
        ? `<header class="vhead"><span class="vem">${esc(v.emoji || '🎬')}</span><div><b>${esc(v.title)}</b><small>${esc([WC.fmtDate(v.date), v.place].filter(Boolean).join(' ・ '))}</small></div></header>`
        : `<header class="vhead"><span class="vem">📒</span><div><b>そのほか</b></div></header>`;
      const q = encodeURIComponent(vid || '-');
      return `<section class="vgroup">${head}
        <div class="vbtns"><a class="pill" href="#flash/${q}">🃏 めくる</a><a class="pill" href="#quiz/${q}">⭐ クイズ</a>${v && v.url ? `<a class="pill yt" href="${esc(v.url)}" target="_blank" rel="noopener">▶ ビデオ</a>` : ''}</div>
        <div class="grid">${cards.map((c) => `<a class="ctile" href="#card/${encodeURIComponent(c.id)}">${picHTML(c)}<b>${esc(c.en)}</b>${starHTML(c)}</a>`).join('')}</div>
      </section>`;
    }).join('');
  }
  function starHTML(c) {
    const n = WC.stars(S.prog.get(c.id));
    return `<span class="stars" aria-label="ほし${n}こ">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
  }

  /* ---------- カード1まい ---------- */
  function sayBtn(c, lang, big = false) {
    if (!langOn(lang)) return '';
    const text = lang === 'en' ? c.en : c[lang];
    if (!text) return '';
    const sub = lang === 'zh' && S.settings.show.pinyin && c.pinyin ? `<small class="py">${esc(c.pinyin)}</small>` : lang === 'en' && S.settings.show.kana && c.kana ? `<small class="kana">${esc(c.kana)}</small>` : '';
    return `<button class="say l-${lang} ${big ? 'big' : ''}" data-lang="${lang}" aria-label="${LNAME[lang]}で きく"><span class="flag">${FLAG[lang]}</span><span class="t"><b>${esc(text)}</b>${sub}</span><span class="spk">🔊</span></button>`;
  }
  function bindSay(root, c) {
    $$('.say', root).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation(); b.classList.add('ping'); setTimeout(() => b.classList.remove('ping'), 500);
      say(c, b.dataset.lang);
    }));
  }
  function renderCard(id) {
    const c = S.cards.find((x) => x.id === id);
    if (!c) { location.replace('#list'); return; }
    const v = S.videos.get(c.video);
    $('#title').textContent = c.en;
    $('#v-card').innerHTML = `
      ${picHTML(c, 'hero-pic')}
      <div class="says">${sayBtn(c, 'en', true)}${sayBtn(c, 'ja')}${sayBtn(c, 'zh')}</div>
      ${c.note ? `<button class="note" id="note-say">💬 ${esc(c.note)}</button>` : ''}
      ${v ? `<div class="from"><span>${esc(v.emoji || '🎬')}</span><div><small>この ビデオで みたよ</small><b>${esc(v.title)}</b><small>${esc(WC.fmtDate(v.date))}</small></div>${v.url ? `<a class="pill yt" href="${esc(ytAt(v.url, c.at))}" target="_blank" rel="noopener">▶ みる</a>` : ''}</div>` : ''}
      <div class="row center"><a class="btn" href="#flash/${encodeURIComponent(c.video || '-')}">🃏 めくる</a><button class="hold btn ghost" data-href="#edit/${encodeURIComponent(c.id)}"><span class="ring"></span>✏️ なおす</button></div>`;
    bindSay($('#v-card'), c);
    bindHold($('#v-card'));
    const n = $('#note-say'); if (n) n.addEventListener('click', () => { Speech.stop(); const t = c.note.replace(/\s*Short\s*#\d+[\s\S]*$/, '') || c.note; Speech.tts(t, /[\u3040-\u30ff\u3400-\u9fff]/.test(t) ? 'ja' : 'en', S.settings.rate); });
    if (S.settings.autoplay) say(c, 'en');
  }

  /* ---------- めくる（フラッシュカード） ---------- */
  const F = { queue: [], i: 0, flipped: false, done: 0, vid: '', all: false };
  function cardsFor(vid) { return !vid ? S.cards : S.cards.filter((c) => (vid === '-' ? !S.videos.has(c.video) : c.video === vid)); }
  function renderFlash(vid, all = false) {
    F.vid = vid || ''; F.all = all;
    F.queue = WC.sessionOrder(cardsFor(F.vid), S.prog, Date.now(), all);
    F.i = 0; F.done = 0; F.flipped = false;
    if (!F.queue.length) {
      const has = cardsFor(F.vid).length;
      $('#v-flash').innerHTML = `<div class="empty"><div class="em">${has ? '🎉' : '📭'}</div><p>${has ? 'きょうの カードは ぜんぶ おわり！' : 'まだ カードが ないよ'}</p>${has ? '<button class="btn primary big" id="f-all">🃏 ぜんぶ めくる</button>' : ''}<a class="btn" href="#home">🏠 ホーム</a></div>`;
      const b = $('#f-all'); if (b) b.onclick = () => renderFlash(F.vid, true);
      return;
    }
    flashCard();
  }
  function flashCard() {
    const c = F.queue[F.i];
    if (!c) return flashDone();
    const total = F.queue.length;
    const back = ['ja', 'zh'].filter(langOn).map((l) => c[l] ? `<div class="bl l-${l}"><span class="flag">${FLAG[l]}</span><b>${esc(c[l])}</b>${l === 'zh' && S.settings.show.pinyin && c.pinyin ? `<small>${esc(c.pinyin)}</small>` : ''}</div>` : '').join('');
    $('#v-flash').innerHTML = `
      <div class="fprog"><div class="bar"><i style="width:${(F.i / total) * 100}%"></i></div><span>${F.i + 1}/${total}</span></div>
      <div class="flip" id="flip" role="button" aria-label="タップで うらがえす">
        <div class="face front">${picHTML(c)}<div class="fw">${esc(c.en)}</div>${S.settings.show.kana && c.kana ? `<div class="fk">${esc(c.kana)}</div>` : ''}</div>
        <div class="face back">${picHTML(c, 'sm')}<div class="fw sm">${esc(c.en)}</div>${back || '<p class="fine">（せってい で ことばが オフ）</p>'}</div>
      </div>
      <p class="hint">👆 タップで くるっ</p>
      <div class="sp3">${['en', 'ja', 'zh'].filter((l) => langOn(l) && (l === 'en' ? c.en : c[l])).map((l) => `<button class="sp" data-lang="${l}" aria-label="${LNAME[l]}で きく"><span>${FLAG[l]}</span><small>${LNAME[l]}</small></button>`).join('')}</div>
      <div class="grade">
        <button class="g-again" id="g-again"><span>🔁</span><b>もういちど</b></button>
        <button class="g-known" id="g-known"><span>⭕</span><b>おぼえた！</b></button>
      </div>`;
    const flip = $('#flip');
    flip.addEventListener('click', () => {
      F.flipped = !F.flipped; flip.classList.toggle('on', F.flipped); sfx('flip');
      if (F.flipped && S.settings.autoplay) { const l = ['ja', 'zh'].find((x) => langOn(x) && c[x]); if (l) say(c, l); }
    });
    $$('.sp', $('#v-flash')).forEach((b) => b.addEventListener('click', () => { b.classList.add('ping'); setTimeout(() => b.classList.remove('ping'), 500); say(c, b.dataset.lang); }));
    $('#g-known').onclick = () => gradeFlash(c, 'known');
    $('#g-again').onclick = () => gradeFlash(c, 'again');
    if (S.settings.autoplay) say(c, 'en');
  }
  async function gradeFlash(c, result) {
    const p = WC.grade(S.prog.get(c.id) || WC.newProgress(c.id), result);
    p.id = c.id; S.prog.set(c.id, p); DB.put('progress', p);
    if (result === 'known') { sfx('yay'); burst(['⭕', '⭐', '✨']); F.done++; }
    else {
      sfx('flip');
      // あとでもう一回（3まい後ろへ）
      const at = Math.min(F.queue.length, F.i + 3);
      F.queue.splice(at, 0, c);
    }
    const card = $('#flip'); card.classList.add(result === 'known' ? 'fly-r' : 'fly-l');
    await new Promise((r) => setTimeout(r, 260));
    F.i++; F.flipped = false; flashCard();
  }
  function flashDone() {
    sfx('fanfare'); burst();
    $('#v-flash').innerHTML = `<div class="empty done"><div class="em">🎉</div><p class="big">よくできました！</p><p>おぼえた ⭕ ${F.done}まい</p>
      <a class="btn primary big" href="#quiz${F.vid ? '/' + encodeURIComponent(F.vid) : ''}">⭐ クイズ に ちょうせん</a>
      <button class="btn" id="f-again">🃏 もういちど ぜんぶ</button><a class="btn" href="#home">🏠 ホーム</a></div>`;
    $('#f-again').onclick = () => renderFlash(F.vid, true);
  }

  /* ---------- クイズ ---------- */
  const Q = { round: [], i: 0, right: 0, tries: 0, vid: '' };
  function renderQuiz(vid) {
    Q.vid = vid || '';
    let pool = cardsFor(Q.vid);
    if (pool.length < 3 && S.cards.length >= 3) pool = S.cards; // 1ビデオに少ないときは全部から
    Q.round = WC.makeRound(pool, S.prog, S.settings.quizLen);
    Q.pool = pool; Q.i = 0; Q.right = 0;
    if (!Q.round.length) {
      $('#v-quiz').innerHTML = `<div class="empty"><div class="em">🙈</div><p>カードが 2まい いじょう あると クイズが できるよ</p><a class="btn" href="#home">🏠 ホーム</a></div>`;
      return;
    }
    quizQ();
  }
  function quizQ() {
    const q = Q.round[Q.i];
    if (!q) return quizDone();
    const c = S.cards.find((x) => x.id === q.id);
    Q.tries = 0;
    $('#v-quiz').innerHTML = `
      <div class="qdots">${Q.round.map((_, k) => `<i class="${k < Q.i ? 'ok' : k === Q.i ? 'now' : ''}"></i>`).join('')}</div>
      ${picHTML(c, 'qpic')}
      <p class="qask">これは えいごで なあに？</p>
      <div class="choices">${q.choices.map((ch, k) => `<div class="crow"><button class="choice c${k}" data-id="${esc(ch.id)}">${esc(ch.en)}</button><button class="hear" data-id="${esc(ch.id)}" aria-label="きく">🔊</button></div>`).join('')}</div>
      <div class="qok" id="qok" hidden></div>`;
    $$('.hear', $('#v-quiz')).forEach((b) => b.addEventListener('click', () => { const cc = Q.pool.find((x) => x.id === b.dataset.id) || S.cards.find((x) => x.id === b.dataset.id); if (cc) say(cc, 'en'); }));
    $$('.choice', $('#v-quiz')).forEach((b) => b.addEventListener('click', () => answer(b, q, c)));
  }
  async function answer(b, q, c) {
    if (b.disabled || $('#v-quiz').classList.contains('lock')) return;
    Q.tries++;
    const p = S.prog.get(c.id) || WC.newProgress(c.id);
    if (b.dataset.id === q.id) {
      $('#v-quiz').classList.add('lock');
      b.classList.add('right');
      if (Q.tries === 1) { Q.right++; p.quizRight = (p.quizRight | 0) + 1; } 
      S.prog.set(c.id, p); DB.put('progress', p);
      sfx('yay'); burst();
      const ok = $('#qok'); ok.hidden = false; ok.innerHTML = `<span>⭕</span><b>せいかい！</b><small>${esc(c.en)}</small>`;
      await say(c, 'en');
      await new Promise((r) => setTimeout(r, 700));
      $('#v-quiz').classList.remove('lock');
      Q.i++; quizQ();
    } else {
      b.disabled = true; b.classList.add('wrong'); sfx('oops');
      if (Q.tries === 1) { p.quizWrong = (p.quizWrong | 0) + 1; S.prog.set(c.id, p); DB.put('progress', p); }
    }
  }
  function quizDone() {
    const n = WC.roundStars(Q.right, Q.round.length);
    sfx('fanfare'); burst(['⭐', '🌟', '🎉', '💯']);
    $('#v-quiz').innerHTML = `<div class="empty done"><div class="bigstars">${'<span>⭐</span>'.repeat(n)}${'<span class="off">⭐</span>'.repeat(3 - n)}</div>
      <p class="big">${n === 3 ? 'パーフェクト！' : n === 2 ? 'すごい！' : 'がんばったね！'}</p><p>${Q.round.length}もん中 ${Q.right}もん いっぱつ せいかい</p>
      <button class="btn primary big" id="q-again">⭐ もういっかい</button><a class="btn" href="#home">🏠 ホーム</a></div>`;
    $('#q-again').onclick = () => renderQuiz(Q.vid);
  }

  /* ---------- つくる・なおす ---------- */
  let pendingImage = null; // {blob, url}
  function renderEdit(id) {
    const isNew = !id || id === 'new';
    const c = isNew ? { en: '', video: (new URLSearchParams(location.search).get('video')) || '' } : S.cards.find((x) => x.id === id);
    if (!c) { location.replace('#list'); return; }
    pendingImage = null;
    $('#title').textContent = isNew ? 'カードをつくる' : 'カードをなおす';
    const vids = [...S.videos.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    const lastVid = c.video || (vids[0] && vids[0].id) || '';
    $('#v-edit').innerHTML = `
      <form id="ef" class="form" autocomplete="off">
        <div class="photo">${picHTML(c, 'edit-pic')}
          <div class="row"><label class="btn">📷 カメラ<input type="file" accept="image/*" capture="environment" hidden data-pic></label>
          <label class="btn">🖼️ アルバム<input type="file" accept="image/*" hidden data-pic></label></div>
          <p class="fine">家族いがいの人の顔や、住所などが写らない写真にしてね。</p></div>
        <label><span>えいご <em>*</em></span><input name="en" required value="${esc(c.en)}" placeholder="honey" enterkeyhint="next"></label>
        <label>えいごの よみかた（ひらがな）<input name="kana" value="${esc(c.kana || '')}" placeholder="はにー"></label>
        <label>にほんご<input name="ja" value="${esc(c.ja || '')}" placeholder="はちみつ"></label>
        <label>ちゅうごくご（繁體字）<input name="zh" value="${esc(c.zh || '')}" placeholder="蜂蜜"></label>
        <label>ピンイン<input name="pinyin" value="${esc(c.pinyin || '')}" placeholder="fēng mì"></label>
        <label>ひとこと（例文など）<input name="note" value="${esc(c.note || '')}" placeholder="I like honey!"></label>
        <fieldset><legend>🎬 どの ビデオ？</legend>
          <select name="video" id="ef-video">${vids.map((v) => `<option value="${esc(v.id)}" ${v.id === lastVid ? 'selected' : ''}>${esc(v.title)}</option>`).join('')}
            <option value="__new" ${!vids.length ? 'selected' : ''}>＋ あたらしい ビデオ</option><option value="" ${isNew ? '' : !c.video ? 'selected' : ''}>（ビデオなし）</option></select>
          <div id="ef-vfields">
            <label>タイトル<input name="vtitle"></label>
            <div class="row2"><label>日付<input type="date" name="vdate"></label><label>何秒目<input type="number" name="at" min="0" step="0.1" inputmode="decimal" value="${c.at != null ? esc(c.at) : ''}"></label></div>
            <label>YouTube の URL（なくてもOK）<input type="url" name="vurl" placeholder="https://youtube.com/shorts/..." inputmode="url"></label>
          </div>
        </fieldset>
        <div class="row center"><button type="button" class="btn" id="ef-test">🔊 きいてみる</button></div>
        <button class="btn primary big" type="submit">💾 ほぞん</button>
        ${isNew ? '' : '<button type="button" class="btn danger" id="ef-del">🗑️ この カードを けす</button>'}
      </form>`;
    const f = $('#ef');
    const fillVideo = () => {
      const v = S.videos.get(f.video.value);
      $('#ef-vfields').hidden = f.video.value === '';
      f.vtitle.value = v ? v.title : ''; f.vdate.value = v ? v.date : new Date().toISOString().slice(0, 10); f.vurl.value = v ? v.url : '';
    };
    f.video.addEventListener('change', fillVideo); fillVideo();
    $$('[data-pic]', f).forEach((inp) => inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      try {
        const blob = await resizeImage(file, 720);
        if (pendingImage) URL.revokeObjectURL(pendingImage.url);
        pendingImage = { blob, url: URL.createObjectURL(blob) };
        $('.edit-pic', f).outerHTML = `<div class="pic edit-pic"><img src="${pendingImage.url}" alt=""></div>`;
      } catch (e) { toast('写真を よみこめませんでした'); }
    }));
    $('#ef-test').onclick = async () => {
      const tmp = { en: f.en.value.trim(), ja: f.ja.value.trim(), zh: f.zh.value.trim(), audio: {} };
      if (!tmp.en) return toast('えいごを いれてね');
      for (const l of ['en', 'ja', 'zh']) if (tmp[l] && langOn(l)) await Speech.tts(tmp[l], l, S.settings.rate);
    };
    f.addEventListener('submit', async (e) => { e.preventDefault(); await saveCard(c, isNew, f); });
    const del = $('#ef-del'); if (del) del.onclick = () => deleteCard(c);
  }

  async function resizeImage(file, max) {
    const bmp = await (window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null) : null)
      || await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const w = bmp.width, h = bmp.height;
    // 正方形にちかい形でトリミング（中央）
    const side = Math.min(w, h), sx = (w - side) / 2, sy = (h - side) / 2;
    const out = Math.min(max, side);
    const cv = document.createElement('canvas'); cv.width = cv.height = out;
    cv.getContext('2d').drawImage(bmp, sx, sy, side, side, 0, 0, out, out);
    return new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85)); // canvas 経由なので位置情報(EXIF)は消える
  }

  async function saveCard(old, isNew, f) {
    const en = f.en.value.trim();
    if (!en) return toast('えいごを いれてね');
    const now = Date.now();
    // ビデオ
    let vid = f.video.value;
    if (vid === '__new' || (vid && S.videos.has(vid))) {
      const title = f.vtitle.value.trim();
      if (vid === '__new') {
        if (!title) return toast('ビデオの タイトルを いれてね');
        vid = WC.makeId(title, new Set(S.videos.keys())) || 'video-' + now.toString(36);
        if (!/[a-z0-9]/.test(vid) || vid === 'card') vid = 'video-' + now.toString(36);
      }
      const prev = S.videos.get(vid) || {};
      const v = WC.normalizeVideo({ ...prev, id: vid, title: title || prev.title, date: f.vdate.value, url: f.vurl.value.trim(), emoji: prev.emoji || '🎬' });
      if (JSON.stringify({ ...prev, edited: undefined }) !== JSON.stringify({ ...v, edited: undefined })) { v.edited = true; await DB.put('videos', v); S.videos.set(vid, v); }
    }
    const base = isNew ? {} : old;
    const ids = new Set(S.all.map((x) => x.id));
    const card = WC.normalizeCard({
      ...base,
      id: isNew ? WC.makeId(en, ids) : old.id,
      en, kana: f.kana.value, ja: f.ja.value, zh: f.zh.value, pinyin: f.pinyin.value, note: f.note.value,
      video: vid, at: f.at.value === '' ? null : +f.at.value,
    }, { source: isNew ? 'user' : old.source, now });
    card.updatedAt = now; card.order = isNew ? now : (old.order || 0);
    // 文字をかえた言語の mp3 は使わない（端末の声で読む）
    if (!isNew) for (const l of ['en', 'ja', 'zh']) if ((old[l] || '') !== (card[l] || '')) delete card.audio[l];
    if (!isNew && old.source === 'repo') card.edited = true;
    if (pendingImage) {
      const mid = 'img-' + card.id + '-' + now.toString(36);
      await DB.put('media', { id: mid, blob: pendingImage.blob, type: 'image/jpeg', at: now });
      if (old && old.image && old.image.startsWith('idb:')) DB.del('media', old.image.slice(4));
      card.image = 'idb:' + mid; S.urls.set(card.image, pendingImage.url); pendingImage = null;
    }
    await DB.put('cards', card);
    await loadAll();
    toast(isNew ? 'カードが できたよ！' : 'なおしたよ！');
    location.hash = '#card/' + encodeURIComponent(card.id);
  }

  async function deleteCard(c) {
    if (!confirm(`「${c.en}」を けしますか？`)) return;
    if (c.source === 'repo') await DB.put('cards', { ...c, deleted: true, updatedAt: Date.now() }); // 同期でまた出てこないように
    else { await DB.del('cards', c.id); if (c.image && c.image.startsWith('idb:')) await DB.del('media', c.image.slice(4)); }
    await DB.del('progress', c.id);
    await loadAll(); toast('けしました'); location.hash = '#list';
  }

  /* ---------- 同期（リポジトリの cards.json） ---------- */
  function rebase(ref, jsonUrl) {
    if (!ref || ref.startsWith('idb:') || ref.startsWith('data:')) return ref;
    const abs = new URL(ref, jsonUrl);
    const base = new URL('./', location.href).href;
    return abs.href.startsWith(base) ? abs.href.slice(base.length) : abs.href;
  }
  async function syncRepo({ quiet = false } = {}) {
    const url = new URL(S.settings.syncUrl || 'cards.json', location.href);
    let data;
    try {
      const u = new URL(url); u.searchParams.set('t', Date.now());
      const r = await fetch(u, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
    } catch (e) { if (!quiet) toast('つながりません（オフライン？）'); return null; }
    const parsed = WC.parseCardsFile(data);
    for (const c of parsed.cards) {
      c.image = rebase(c.image, url.href);
      for (const l of Object.keys(c.audio)) c.audio[l] = rebase(c.audio[l], url.href);
    }
    const local = await DB.all('cards');
    const vput = WC.mergeVideos(await DB.all('videos'), parsed.videos, 'repo');
    const { put, stats } = WC.mergeCards(local, parsed.cards, 'repo');
    const idx = new Map(parsed.cards.map((c, i) => [c.id, i]));
    put.forEach((c) => { c.order = idx.get(c.id); });
    if (vput.length) await DB.putMany('videos', vput);
    if (put.length) await DB.putMany('cards', put);
    await DB.setMeta('lastSync', { at: Date.now(), ...stats, errors: parsed.errors.length });
    cacheMedia(parsed.cards);
    await loadAll();
    if (!quiet || stats.added || stats.updated) {
      toast(stats.added ? `あたらしい カード ${stats.added}まい！🎉` : stats.updated ? `カードを ${stats.updated}まい こうしん` : 'あたらしい カードは ないよ');
    }
    return stats;
  }
  async function cacheMedia(cards) {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const refs = new Set();
      cards.forEach((c) => { if (c.image) refs.add(c.image); Object.values(c.audio || {}).forEach((a) => refs.add(a)); });
      for (const r of refs) {
        if (r.startsWith('idb:') || r.startsWith('data:')) continue;
        const u = new URL(r, location.href);
        if (u.origin !== location.origin) continue;
        if (!(await cache.match(u.href))) { try { await cache.add(u.href); } catch (e) {} }
      }
    } catch (e) {}
  }

  /* ---------- 取り込み・書き出し ---------- */
  async function dataUrlToBlob(d) { return (await fetch(d)).blob(); }
  function blobToDataUrl(b) { return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }

  async function importFile(file) {
    let text;
    try { text = await file.text(); } catch (e) { return toast('ファイルを よめません'); }
    const parsed = WC.parseCardsFile(text);
    if (!parsed.cards.length) return toast('カードが 見つかりません：' + (parsed.errors[0] || ''), 4000);
    const now = Date.now();
    for (const c of parsed.cards) {
      if (!c.source || c.source === 'user') c.source = parsed.kind === 'backup' ? c.source || 'user' : 'import';
      if (c.image && c.image.startsWith('data:')) {
        const mid = 'img-' + c.id + '-' + now.toString(36);
        await DB.put('media', { id: mid, blob: await dataUrlToBlob(c.image), at: now }); c.image = 'idb:' + mid;
      }
      for (const l of Object.keys(c.audio)) if (c.audio[l].startsWith('data:')) {
        const mid = 'aud-' + c.id + '-' + l + '-' + now.toString(36);
        await DB.put('media', { id: mid, blob: await dataUrlToBlob(c.audio[l]), at: now }); c.audio[l] = 'idb:' + mid;
      }
    }
    const vput = WC.mergeVideos(await DB.all('videos'), parsed.videos, 'file');
    const { put, stats } = WC.mergeCards(await DB.all('cards'), parsed.cards, 'file', now);
    if (vput.length) await DB.putMany('videos', vput);
    if (put.length) await DB.putMany('cards', put);
    if (parsed.progress.length) {
      const cur = new Map((await DB.all('progress')).map((p) => [p.id, p]));
      await DB.putMany('progress', parsed.progress.filter((p) => !cur.has(p.id) || (p.last || 0) > (cur.get(p.id).last || 0)));
    }
    cacheMedia(parsed.cards);
    await loadAll();
    toast(`よみこみ：あたらしい ${stats.added}・こうしん ${stats.updated}${parsed.errors.length ? `・エラー ${parsed.errors.length}` : ''}`, 4000);
    if (parsed.errors.length) console.warn(parsed.errors);
    renderSettings();
  }

  async function exportBackup() {
    const cards = await DB.all('cards');
    const out = [];
    for (const c of cards) {
      const o = { ...c, audio: { ...(c.audio || {}) } };
      if (o.image && o.image.startsWith('idb:')) { const m = await DB.get('media', o.image.slice(4)); o.image = m ? await blobToDataUrl(m.blob) : ''; }
      for (const l of Object.keys(o.audio)) if (o.audio[l].startsWith('idb:')) { const m = await DB.get('media', o.audio[l].slice(4)); if (m) o.audio[l] = await blobToDataUrl(m.blob); else delete o.audio[l]; }
      out.push(o);
    }
    const data = WC.buildBackup({ cards: out, videos: await DB.all('videos'), progress: await DB.all('progress'), settings: S.settings });
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const name = `kotoba-album-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name === 'AbortError') return; download(blob, name); }
    } else download(blob, name);
    await DB.setMeta('lastExport', Date.now());
    toast('バックアップを 書き出しました'); renderSettings();
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- データ保護 ---------- */
  async function requestPersist() {
    if (!(navigator.storage && navigator.storage.persist)) return null;
    try { return (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (e) { return false; }
  }

  /* ---------- おとなメニュー（設定） ---------- */
  async function renderSettings() {
    const st = S.settings;
    const last = await DB.getMeta('lastSync', null);
    const lastExp = await DB.getMeta('lastExport', null);
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => null) : null;
    let usage = '';
    if (navigator.storage && navigator.storage.estimate) { try { const e = await navigator.storage.estimate(); usage = `つかっている容量：${(e.usage / 1048576).toFixed(1)} MB`; } catch (e) {} }
    const tog = (k, label) => `<label class="tog"><span>${label}</span><input type="checkbox" data-show="${k}" ${st.show[k] ? 'checked' : ''}><i></i></label>`;
    $('#v-settings').innerHTML = `
      <section class="set"><h3>➕ カード</h3>
        <a class="btn primary big" href="#edit/new">＋ カードを つくる</a>
        <button class="btn" id="s-sync">🔄 あたらしい カードを さがす</button>
        <p class="fine">${last ? `さいごに確認：${new Date(last.at).toLocaleString('ja-JP')}（ぜんぶで ${S.cards.length}まい）` : 'まだ確認していません'}</p>
        <label class="btn">📥 JSONファイルを 読みこむ<input type="file" accept="application/json,.json" hidden id="s-import"></label>
        <button class="btn" id="s-export">📤 バックアップを 書き出す</button>
        <p class="fine">最終書き出し：${lastExp ? new Date(lastExp).toLocaleString('ja-JP') : 'まだありません'}（写真も入ります）</p>
      </section>
      <section class="set" id="s-transfer"><h3>📦 引っ越し（機種変更）</h3>
        <p class="fine">カード・自分で撮った写真や録音・おぼえた記録・設定を ぜんぶ 1つのファイルにします。iPhone では共有メニューから「"ファイル"に保存」か Google ドライブへ。</p>
        <button class="btn primary big" id="s-export-all">📤 データを書き出す</button>
        <label class="btn big">📥 データを読み込む<input type="file" accept="application/json,.json" hidden id="s-import-all"></label>
        <label class="tog"><span>読み込み方：置き換え（おすすめ）</span><input type="radio" name="s-import-mode" value="replace" checked><i></i></label>
        <label class="tog"><span>読み込み方：統合（今のカードも残す）</span><input type="radio" name="s-import-mode" value="merge"><i></i></label>
        <div id="s-transfer-status" class="fine"></div>
        <p class="fine">読み込む前に 中身を確認します。失敗しても 今のデータは 消えません。</p>
      </section>
      <section class="set"><h3>👀 ひょうじする ことば</h3>
        <p class="fine">えいごは いつも ひょうじ</p>
        ${tog('kana', 'えいごの よみかた（ひらがな）')}${tog('ja', 'にほんご 🇯🇵')}${tog('zh', 'ちゅうごくご 🇹🇼')}${tog('pinyin', 'ピンイン')}
      </section>
      <section class="set"><h3>🔊 こえ</h3>
        <label class="range"><span>はやさ <b id="s-rate-v">${st.rate.toFixed(1)}</b></span><input type="range" id="s-rate" min="0.5" max="1.3" step="0.1" value="${st.rate}"></label>
        <button class="btn" id="s-test">🔊 ためしに きく（whale shark）</button>
        <label class="tog"><span>カードを ひらいたら よみあげる</span><input type="checkbox" id="s-auto" ${st.autoplay ? 'checked' : ''}><i></i></label>
        <label class="tog"><span>こうかおん（ピンポン♪）</span><input type="checkbox" id="s-sfx" ${st.sfx ? 'checked' : ''}><i></i></label>
        <p class="fine">付属のカードは AI音声（Microsoft Edge TTS）の mp3。じぶんで作ったカードは スマホの声で よみます${Speech.hasTTS() ? '' : '（この端末は よみあげ非対応）'}。</p>
      </section>
      <section class="set"><h3>⭐ クイズ</h3>
        <div class="seg">${[5, 10].map((n) => `<button data-ql="${n}" class="${st.quizLen === n ? 'on' : ''}">${n}もん</button>`).join('')}</div>
      </section>
      <section class="set"><h3>🛡️ データ</h3>
        <p class="persist ${persisted ? 'on' : 'off'}">データ保護：${persisted === null ? 'このブラウザは未対応' : persisted ? '有効 ✅' : '未設定（ホーム画面に追加すると有効になりやすい）'}</p>
        ${persisted === false ? '<button class="btn" id="s-persist">🛡️ データ保護を おねがいする</button>' : ''}
        <p class="fine">${usage}</p>
        <button class="btn danger" id="s-reset">🔁 おぼえた記録を リセット</button>
      </section>
      <p class="fine center">ことばアルバム v${APP_VERSION} ・ オフラインでも うごきます<br>ホーム画面に追加：Safari の共有 → 「ホーム画面に追加」</p>`;
    $$('[data-show]').forEach((i) => i.addEventListener('change', () => { st.show[i.dataset.show] = i.checked; saveSettings(); }));
    $('#s-rate').addEventListener('input', (e) => { st.rate = +e.target.value; $('#s-rate-v').textContent = st.rate.toFixed(1); saveSettings(); });
    $('#s-test').onclick = () => { const c = S.cards.find((x) => x.id === 'whale-shark') || S.cards[0]; if (c) say(c, 'en'); };
    $('#s-auto').onchange = (e) => { st.autoplay = e.target.checked; saveSettings(); };
    $('#s-sfx').onchange = (e) => { st.sfx = e.target.checked; saveSettings(); };
    $$('[data-ql]').forEach((b) => b.onclick = () => { st.quizLen = +b.dataset.ql; saveSettings(); renderSettings(); });
    $('#s-sync').onclick = async () => { $('#s-sync').disabled = true; await syncRepo(); renderSettings(); };
    $('#s-import').onchange = (e) => { const f = e.target.files[0]; if (f) importFile(f); };
    $('#s-export').onclick = exportBackup;
    if (window.Transfer) Transfer.bind({ DB, toast, legacyImport: importFile });
    const ps = $('#s-persist'); if (ps) ps.onclick = async () => { const ok = await requestPersist(); toast(ok ? 'データ保護 ON' : 'ブラウザが ことわりました'); renderSettings(); };
    $('#s-reset').onclick = async () => { if (!confirm('おぼえた記録（⭐）を ぜんぶ けしますか？ カードは のこります。')) return; await DB.clear('progress'); S.prog = new Map(); toast('リセットしました'); };
  }

  /* ---------- 起動 ---------- */
  async function boot() {
    $('#back').onclick = () => { location.hash = parentOf(route); };
    window.addEventListener('hashchange', render);
    await DB.open();
    await loadAll();
    const first = !(await DB.getMeta('lastSync', null));
    if (first) await syncRepo({ quiet: true });
    await render();
    if (!first && navigator.onLine !== false) syncRepo({ quiet: true }).then((s) => { if (s && (s.added || s.updated) && ['home', 'list'].includes(route.view)) render(); });
    requestPersist();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    document.body.classList.add('ready');
  }
  window.__app = { S, syncRepo, importFile, exportBackup, render };
  boot();
})();
