/* オフライン対応：アプリ本体をキャッシュ（会場は電波が弱い前提）
   ファイルを変更したら CACHE のバージョンを上げること */
const CACHE = 'kurunavi-v1.1.1';
const ASSETS = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/util.js', 'js/parser.js', 'js/layout.js', 'js/qr.js', 'js/shots.js', 'js/store.js', 'js/ui.js', 'js/map.js', 'js/sync.js', 'js/editor.js', 'js/views.js', 'js/app.js',
  'data/holocle12.js', 'data/holocle12-map.webp',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

/* 取り込むときは必ずネットワークから取る。
   ブラウザのHTTPキャッシュ（GitHub Pages は max-age=600）が残っていると、
   新しい版のキャッシュに古いファイルが入り、いつまでも更新されない状態になる */
const freshRequests = () =>
  ASSETS.map((p) => new Request(p + (p.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(CACHE), { cache: 'reload' }));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(freshRequests())).then(() => self.skipWaiting()));
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
        .then((c) => c.addAll(freshRequests()))
        .then(() => port && port.postMessage({ ok: true }))
        .catch((err) => port && port.postMessage({ ok: false, error: String(err && err.message || err) }))
    );
  }
});

// アプリ本体のパス一覧（この中のファイルは「同じ版のかたまり」で揃える）
const shellPaths = new Set(ASSETS.map((p) => new URL(p, self.registration ? self.registration.scope : self.location.href).pathname));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isShell = shellPaths.has(url.pathname) || req.mode === 'navigate';

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (isShell) {
        // 本体は裏で1ファイルずつ入れ替えない。
        // 個別に新しくすると「古いJSと新しいJSが混ざった状態」で動いてしまうため、
        // 差し替えは新しい Service Worker の install（ASSETS をまとめて取得）にまかせる
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (_) {
          return (await cache.match('index.html', { ignoreSearch: true })) || Response.error();
        }
      }
      // 本体以外（あとから足す画像など）は、キャッシュ優先＋裏で更新
      const net = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
