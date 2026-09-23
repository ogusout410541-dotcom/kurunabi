/* オフライン対応：アプリ本体をキャッシュ（会場は電波が弱い前提）
   ファイルを変更したら CACHE のバージョンを上げること */
const CACHE = 'kurunavi-v0.9.1';
const ASSETS = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/util.js', 'js/parser.js', 'js/layout.js', 'js/qr.js', 'js/shots.js', 'js/store.js', 'js/ui.js', 'js/map.js', 'js/sync.js', 'js/editor.js', 'js/views.js', 'js/app.js',
  'data/holocle12.js', 'data/holocle12-map.webp',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 画面からの問い合わせ（オフライン準備の状態確認・取り込み直し）
self.addEventListener('message', (e) => {
  const port = e.ports && e.ports[0];
  if (e.data === 'status') {
    e.waitUntil(caches.open(CACHE).then(async (c) => {
      const keys = await c.keys();
      port && port.postMessage({ cache: CACHE, files: keys.length, assets: ASSETS.length });
    }));
  } else if (e.data === 'refresh') {
    e.waitUntil(
      caches.open(CACHE)
        .then((c) => c.addAll(ASSETS))
        .then(() => port && port.postMessage({ ok: true }))
        .catch((err) => port && port.postMessage({ ok: false, error: String(err && err.message || err) }))
    );
  }
});

// 同一オリジンは「キャッシュ優先＋裏で更新」
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        // 圏外でキャッシュにも無いとき、画面遷移ならアプリ本体を返す（白画面にしない）
        .catch(() => hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined));
      return hit || net;
    })
  );
});
