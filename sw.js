/* ことばアルバム service worker — アプリ本体をキャッシュしてオフライン動作。
   本体を変えたら CACHE の番号を上げる。写真・音声（media/）は別キャッシュで、版を上げても消さない。 */
const CACHE = 'wordcards-shell-v5';
const MEDIA = 'wordcards-media-v1';
const SHELL = ['./', './index.html', './css/style.css', './js/core.js', './js/db.js', './js/speech.js', './js/transfer.js', './js/app.js',
  './cards.json', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== MEDIA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function timeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 写真・音声：キャッシュ優先＋うしろで更新（stale-while-revalidate）
  if (url.pathname.includes('/media/')) {
    e.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((r) => { if (r.ok && r.status === 200) c.put(req, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || new Response('', { status: 504 });
    }));
    return;
  }
  // 本体・cards.json：ネット優先（4秒で見切り）→ だめならキャッシュ
  e.respondWith(timeout(fetch(req), 4000).then((r) => {
    if (r.ok && r.status === 200) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname.endsWith('/cards.json') ? './cards.json' : req, copy)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((m) => m || (req.mode === 'navigate' ? caches.match('./index.html') : new Response('', { status: 504 })))));
});
