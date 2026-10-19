/* ことばアルバム — 引っ越し用「データを書き出す／データを読み込む」（機種変更向け・まるごと）。
   書き出し: IndexedDB の全ストア（cards / videos / progress / media（自分で撮った写真・録音は Base64）/ meta（設定など））を1つのJSONに。
   読み込み: アプリ名とスキーマ版を確認 → 先に全部検証・変換 → 確認 → 1つのトランザクションで置き換え（既定）か統合。
   失敗したらトランザクションごと取り消し＝今のデータは壊れない。既存のストア・形式は変えない（追加のみ）。
   ※ 中身は data の下に入れるので、古い「JSONファイルを読みこむ」に間違って渡しても何も起きない（cards が見つからない扱い）。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Transfer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const APP = 'kotoba-album';
  const SCHEMA = 2; // 1 = 従来の word-cards-backup（カードに写真を埋め込み）、2 = まるごと
  const STORES = ['cards', 'videos', 'progress', 'media', 'meta'];
  const keyOf = (s, r) => (s === 'meta' ? r.key : r.id);

  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fileName = (d) => `kotoba-album-all-v${SCHEMA}-${localDate(d)}.json`;

  /* 形だけの検証（DOM不要・node でテスト）。戻り値: { kind: 'full'|'legacy', errors: [] } */
  function validate(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { errors: ['JSONの形が違います'] };
    if (obj.format === 'word-cards-backup' && Array.isArray(obj.cards)) return { kind: 'legacy', errors: [] };
    if (obj.app !== APP) return { errors: [`このアプリのファイルではありません（app: ${obj.app || 'なし'}）`] };
    const v = Number(obj.version);
    if (!Number.isInteger(v) || v < 2) return { errors: ['バージョンが不明です'] };
    if (v > SCHEMA) return { errors: [`新しすぎるファイルです（v${v}）。アプリを更新してください`] };
    if (!obj.data || typeof obj.data !== 'object') return { errors: ['data がありません'] };
    const errors = [];
    for (const s of STORES) {
      const rows = obj.data[s];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) { errors.push(`${s} が一覧になっていません`); continue; }
      rows.forEach((r, i) => {
        if (!r || typeof r !== 'object') errors.push(`${s} ${i + 1}行め: 不正`);
        else if (keyOf(s, r) == null || keyOf(s, r) === '') errors.push(`${s} ${i + 1}行め: id がありません`);
        else if (s === 'media' && !(r.blob && typeof r.blob.__blob === 'string' && r.blob.__blob.startsWith('data:'))) errors.push(`media ${r.id}: 画像/音声データがありません`);
      });
    }
    if (!Array.isArray(obj.data.cards)) errors.push('cards がありません');
    return { kind: 'full', errors };
  }

  function counts(obj) { const c = {}; for (const s of STORES) c[s] = Array.isArray(obj.data[s]) ? obj.data[s].length : 0; return c; }

  /* ---- ここからブラウザ専用 ---- */
  const toDataURL = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
  function dataURLToBlob(s) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(s || '');
    if (!m) throw new Error('画像/音声データが壊れています');
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: m[1] || 'application/octet-stream' });
  }
  async function encode(v) {
    if (typeof Blob !== 'undefined' && v instanceof Blob) return { __blob: await toDataURL(v) };
    if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await encode(x)); return o; }
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await encode(x); return o; }
    return v;
  }
  function decode(v) {
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === 'object') {
      if (typeof v.__blob === 'string' && Object.keys(v).length === 1) return dataURLToBlob(v.__blob);
      const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decode(x); return o;
    }
    return v;
  }

  async function buildFullExport(DB) {
    const data = {};
    for (const s of STORES) { data[s] = []; for (const r of await DB.all(s)) data[s].push(await encode(r)); }
    const out = { app: APP, version: SCHEMA, schema: SCHEMA, full: true, exportedAt: new Date().toISOString(), data };
    out.counts = counts(out);
    return out;
  }

  /* 検証＋Blob化（DBには触らない） */
  function parseFull(obj) {
    const v = validate(obj);
    if (v.errors.length) throw new Error(v.errors.slice(0, 3).join(' / '));
    if (v.kind === 'legacy') return { kind: 'legacy' };
    const stores = {};
    for (const s of STORES) if (Array.isArray(obj.data[s])) stores[s] = obj.data[s].map(decode);
    return { kind: 'full', version: Number(obj.version), stores, counts: counts(obj), exportedAt: obj.exportedAt || '' };
  }

  const stamp = (r) => Number(r.updatedAt || r.last || r.at || 0) || Date.parse(r.updatedAt || 0) || 0;

  async function applyFull(DB, parsed, mode) {
    const db = await DB.open();
    const current = {};
    if (mode === 'merge') for (const s of Object.keys(parsed.stores)) current[s] = new Map((await DB.all(s)).map((r) => [keyOf(s, r), r]));
    const res = { added: 0, updated: 0, skipped: 0 };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORES, 'readwrite');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('中止されました'));
      try {
        if (mode === 'replace') {
          for (const s of STORES) tx.objectStore(s).clear();
          for (const [s, rows] of Object.entries(parsed.stores)) for (const r of rows) { tx.objectStore(s).put(r); res.added++; }
        } else {
          for (const [s, rows] of Object.entries(parsed.stores)) for (const r of rows) {
            const cur = current[s].get(keyOf(s, r));
            if (!cur) { tx.objectStore(s).put(r); res.added++; }
            else if (s !== 'meta' && s !== 'media' && stamp(r) > stamp(cur)) { tx.objectStore(s).put(r); res.updated++; }
            else res.skipped++;
          }
        }
      } catch (e) { try { tx.abort(); } catch (_) {} reject(e); }
    });
    return res;
  }

  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function saveFile(blob, name, statusEl) {
    const url = URL.createObjectURL(blob);
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
    const canShare = !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    const fallback = () => {
      if (!statusEl) return;
      const a = document.createElement('a'); a.href = url; a.download = name; a.className = 'btn'; a.textContent = '⬇ ' + name + ' を保存';
      statusEl.appendChild(a);
      if (canShare) { const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = '📤 共有して保存（ファイル／Drive）'; b.onclick = () => navigator.share({ files: [file], title: name }).catch(() => {}); statusEl.appendChild(b); }
    };
    if (canShare && isIOS()) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; }
      catch (e) { fallback(); return e && e.name === 'AbortError' ? 'aborted' : 'fallback'; }
    }
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    fallback(); return 'download';
  }

  const LABEL = { cards: 'カード', videos: 'ビデオ', progress: 'おぼえた記録', media: '写真・録音', meta: '設定など' };
  const summary = (c) => Object.entries(c).map(([s, n]) => `${LABEL[s]}: ${n}`).join('\n');

  /* おとなメニューのボタンをつなぐ。opts: { DB, toast, legacyImport(file) } */
  function bind(opts) {
    const $ = (id) => document.getElementById(id);
    const st = $('s-transfer-status'); if (!st) return;
    $('s-export-all').onclick = async () => {
      st.textContent = '書き出し中…';
      try {
        const obj = await buildFullExport(opts.DB);
        const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
        const name = fileName();
        st.innerHTML = ''; const p = document.createElement('p'); p.className = 'fine'; p.style.whiteSpace = 'pre-line';
        p.textContent = `${name}（${(blob.size / 1048576).toFixed(1)} MB）\n${summary(obj.counts)}`; st.appendChild(p);
        const how = await saveFile(blob, name, st);
        if (how !== 'aborted') await opts.DB.setMeta('lastExport', Date.now());
        opts.toast(how === 'aborted' ? '共有をキャンセル（下のボタンで保存できます）' : 'データを 書き出しました');
      } catch (e) { console.warn(e); st.textContent = '書き出し失敗: ' + e.message; }
    };
    $('s-import-all').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      let parsed;
      try { parsed = parseFull(JSON.parse(await f.text())); }
      catch (err) { st.textContent = '読み込み中止（今のデータはそのまま）: ' + err.message; opts.toast('読み込めません'); return; }
      if (parsed.kind === 'legacy') {
        if (!confirm(`「${f.name}」は 以前の形式のバックアップです。今のカードは残したまま 足します（統合）。よろしいですか？`)) { st.textContent = 'キャンセルしました（今のデータはそのまま）'; return; }
        return opts.legacyImport(f);
      }
      const mode = (document.querySelector('input[name="s-import-mode"]:checked') || {}).value === 'merge' ? 'merge' : 'replace';
      const msg = `「${f.name}」（v${parsed.version}${parsed.exportedAt ? '・' + new Date(parsed.exportedAt).toLocaleString('ja-JP') : ''}）\n\n${summary(parsed.counts)}\n\n` +
        (mode === 'replace' ? '⚠ 今この端末にあるカード・写真・記録・設定を全部消して、ファイルの内容に置き換えます。よろしいですか？' : '今のデータは残したまま、ファイルの内容を足します。よろしいですか？');
      if (!confirm(msg)) { st.textContent = 'キャンセルしました（今のデータはそのまま）'; return; }
      try {
        const r = await applyFull(opts.DB, parsed, mode);
        st.textContent = mode === 'replace' ? `置き換え完了: ${r.added}件` : `統合完了: 追加${r.added} 更新${r.updated} スキップ${r.skipped}`;
        opts.toast('読み込みました。画面を更新します');
        setTimeout(() => location.reload(), 1200);
      } catch (err) { console.warn(err); st.textContent = '読み込み失敗（今のデータはそのまま）: ' + err.message; }
    };
  }

  return { APP, SCHEMA, STORES, validate, fileName, localDate, buildFullExport, parseFull, applyFull, saveFile, bind };
});
