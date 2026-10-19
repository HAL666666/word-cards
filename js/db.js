/* IndexedDB。バージョンを上げるときは「足すだけ」：既存ストアは消さない・作りなおさない。 */
(function (global) {
  'use strict';
  const DB_NAME = 'word-cards-db';
  const DB_VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // v1: カード・ビデオ・おぼえた記録・写真/音声のBlob・設定など
        if (!db.objectStoreNames.contains('cards')) {
          const s = db.createObjectStore('cards', { keyPath: 'id' });
          s.createIndex('byVideo', 'video', { unique: false });
        }
        if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        // v2 以降はここに「if (!contains(...)) create」を足していく
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbp = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('IndexedDB upgrade blocked (他のタブを閉じてください)');
    });
    return dbp;
  }

  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let out;
      Promise.resolve(fn(t.objectStore(store), t)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const DB = {
    open,
    all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())),
    get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
    put: (store, val) => tx(store, 'readwrite', (s) => { s.put(val); }),
    putMany: (store, vals) => tx(store, 'readwrite', (s) => { vals.forEach((v) => s.put(v)); }),
    del: (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); }),
    clear: (store) => tx(store, 'readwrite', (s) => { s.clear(); }),
    async getMeta(key, dflt) { const r = await DB.get('meta', key); return r ? r.value : dflt; },
    setMeta: (key, value) => DB.put('meta', { key, value }),
  };
  global.DB = DB;
})(window);
