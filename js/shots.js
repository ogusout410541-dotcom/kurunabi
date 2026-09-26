/* お品書き画像の保管（IndexedDB）
   - 画像は縮小して保存。一覧表示用に小さなサムネ（dataURL）をメタ側に持つので、描画は同期で済む
   - localStorage の計画データとは別扱い。共有リンクやJSON書き出しには含めない（容量が大きいため）
   - file:// では IndexedDB が使えないブラウザがあるので、使えない時は ready=false にして機能を隠す */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const Sh = (HC.shots = {});

  const DB = 'kurunavi';
  const DB_V = 2;
  const META = 'shotMeta'; // { id, ev, cid, thumb(dataURL), w, h, size, t }
  const BLOB = 'shotBlob'; // { id, blob }
  const FILES = 'files';   // { key, blob, w, h, name, t } 配置図の画像など（キーは 'map:<eventId>'）
  const MAX_SIDE = 1600;   // 保存する画像の最大辺
  const THUMB = 180;       // サムネの最大辺

  Sh.ready = false;
  Sh.error = '';
  const index = new Map(); // 'ev:cid' → [meta]（新しい順）

  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DB, DB_V); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(BLOB)) db.createObjectStore(BLOB, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'key' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error('blocked'));
    });
    return dbp;
  };

  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error || new Error('abort')); });
  /** トランザクションを開く。使い方: const [t, m, b] = await tx([META, BLOB], 'readwrite') */
  const tx = async (names, mode) => {
    const db = await open();
    const t = db.transaction(names, mode);
    return [t, ...names.map((n) => t.objectStore(n))];
  };

  const key = (ev, cid) => ev + ':' + cid;
  const put = (m) => {
    const arr = index.get(key(m.ev, m.cid)) || [];
    arr.unshift(m);
    index.set(key(m.ev, m.cid), arr);
  };

  /** 起動時：メタだけ読み込む（画像本体は開いたときに取り出す） */
  Sh.load = async () => {
    try {
      const [t, m] = await tx([META], 'readonly');
      const metas = await reqP(m.getAll());
      await done(t);
      index.clear();
      metas.sort((a, b) => b.t - a.t).forEach(put);
      Sh.ready = true;
    } catch (e) {
      Sh.ready = false;
      Sh.error = String((e && e.message) || e);
    }
    return Sh.ready;
  };

  /** そのサークルの画像メタ一覧（同期） */
  Sh.list = (ev, cid) => index.get(key(ev, cid)) || [];
  Sh.has = (ev, cid) => Sh.list(ev, cid).length > 0;
  Sh.meta = (id) => {
    for (const arr of index.values()) { const m = arr.find((x) => x.id === id); if (m) return m; }
    return null;
  };
  /** イベント内の合計（枚数・概算バイト） */
  Sh.usage = (ev) => {
    let n = 0, bytes = 0;
    index.forEach((arr, k) => {
      if (ev && !k.startsWith(ev + ':')) return;
      arr.forEach((m) => { n++; bytes += m.size || 0; });
    });
    return { n, bytes };
  };

  // ---- 画像の読み込みと縮小
  const loadImage = (file) =>
    new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { res({ img, url }); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('画像を読めません')); };
      img.src = url;
    });

  const toBlob = (canvas, type, q) =>
    new Promise((res) => {
      if (canvas.toBlob) canvas.toBlob((b) => res(b), type, q);
      else res(null);
    });

  const draw = (img, max) => {
    const scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { cv, w, h };
  };

  /** 画像を1枚追加する */
  Sh.add = async (ev, cid, file) => {
    if (!/^image\//.test(file.type || '')) throw new Error('画像ファイルを選んでください');
    const { img, url } = await loadImage(file);
    try {
      const big = draw(img, MAX_SIDE);
      const small = draw(img, THUMB);
      const blob = (await toBlob(big.cv, 'image/jpeg', 0.85)) || file;
      const meta = {
        id: U.uid(),
        ev,
        cid,
        thumb: small.cv.toDataURL('image/jpeg', 0.7),
        w: big.w,
        h: big.h,
        size: blob.size,
        t: Date.now(),
      };
      const [t, m, b] = await tx([META, BLOB], 'readwrite');
      m.put(meta);
      b.put({ id: meta.id, blob });
      await done(t);
      put(meta);
      return meta;
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // ---- 端末間の受け渡し（js/sync.js の「画像を送る／受け取る」から使う）
  // meta.remote = 別の端末から受け取った画像 / meta.sent = この端末から送信済み

  /** すべての画像メタ（イベント横断） */
  Sh.all = () => {
    const out = [];
    index.forEach((arr) => arr.forEach((m) => out.push(m)));
    return out;
  };
  /** まだ送っていない、この端末で入れた画像 */
  Sh.unsent = () => Sh.all().filter((m) => !m.remote && !m.sent);

  /** 画像本体（Blob） */
  Sh.blob = async (id) => {
    const [t, b] = await tx([BLOB], 'readonly');
    const rec = await reqP(b.get(id));
    await done(t);
    return rec ? rec.blob : null;
  };

  /** メタの一部を書き換える（送信済みの印など） */
  Sh.mark = async (id, patch) => {
    const m = Sh.meta(id);
    if (!m) return;
    Object.assign(m, patch);
    const [t, s] = await tx([META], 'readwrite');
    s.put(m);
    await done(t);
  };

  /** 受け取った画像を、送り元と同じIDで保存する（サムネはこちらで作る） */
  Sh.addReceived = async (info, blob) => {
    const { img, url } = await loadImage(blob);
    try {
      const small = draw(img, THUMB);
      const meta = {
        id: info.id, ev: info.ev, cid: info.cid,
        thumb: small.cv.toDataURL('image/jpeg', 0.7),
        w: info.w || img.naturalWidth, h: info.h || img.naturalHeight,
        size: blob.size, t: info.t || Date.now(), remote: true,
      };
      const [t, m, b] = await tx([META, BLOB], 'readwrite');
      m.put(meta);
      b.put({ id: meta.id, blob });
      await done(t);
      Sh.forget(meta.id);
      put(meta);
      // 表示は新しい順
      const arr = index.get(key(meta.ev, meta.cid));
      arr.sort((a, b2) => b2.t - a.t);
      return meta;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  /** メモリ上の一覧からだけ外す（入れ直すとき用） */
  Sh.forget = (id) => {
    index.forEach((arr, k) => {
      const i = arr.findIndex((x) => x.id === id);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) index.delete(k);
    });
  };

  // 受け取った画像をこの端末で消したら、次に受け取るときにまた入れないよう覚えておく
  const SKIP_KEY = 'kurunavi.shotSkip';
  Sh.skipped = () => {
    try { return new Set(JSON.parse(localStorage.getItem(SKIP_KEY) || '[]')); } catch (_) { return new Set(); }
  };
  const addSkip = (ids) => {
    if (!ids.length) return;
    const s = Sh.skipped();
    ids.forEach((id) => s.add(id));
    try { localStorage.setItem(SKIP_KEY, JSON.stringify([...s].slice(-2000))); } catch (_) { /* noop */ }
  };

  /** 表示用の Blob URL（使い終わったら revoke すること） */
  Sh.url = async (id) => {
    const [t, b] = await tx([BLOB], 'readonly');
    const rec = await reqP(b.get(id));
    await done(t);
    return rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
  };

  /** 1枚消す。opt.sync=true は受け取りの片付け（送り元で消えたもの）で、覚えておく必要がない */
  Sh.remove = async (id, opt = {}) => {
    const meta = Sh.meta(id);
    const [t, m, b] = await tx([META, BLOB], 'readwrite');
    m.delete(id);
    b.delete(id);
    await done(t);
    Sh.forget(id);
    if (meta && meta.remote && !opt.sync) addSkip([id]);
  };

  /** イベント単位で全部消す（イベント削除時など）。ev 省略で全消去 */
  Sh.clear = async (ev) => {
    const ids = [], remote = [];
    index.forEach((arr, k) => { if (!ev || k.startsWith(ev + ':')) arr.forEach((m) => { ids.push(m.id); if (m.remote) remote.push(m.id); }); });
    if (!ids.length) return 0;
    addSkip(remote);
    const [t, m, b] = await tx([META, BLOB], 'readwrite');
    ids.forEach((id) => { m.delete(id); b.delete(id); });
    await done(t);
    index.forEach((arr, k) => { if (!ev || k.startsWith(ev + ':')) index.delete(k); });
    return ids.length;
  };

  // ---- 配置図の画像など、キー付きのファイル
  const fileUrls = new Map(); // key → objectURL（起動時にまとめて作る）

  /** 起動時：配置図の画像を読み込んで表示用のURLを用意する */
  Sh.loadFiles = async () => {
    if (!Sh.ready) return;
    try {
      const [t, f] = await tx([FILES], 'readonly');
      const all = await reqP(f.getAll());
      await done(t);
      fileUrls.forEach((u) => URL.revokeObjectURL(u));
      fileUrls.clear();
      all.forEach((rec) => { if (rec && rec.blob) fileUrls.set(rec.key, URL.createObjectURL(rec.blob)); });
      Sh.fileMeta = new Map(all.map((r) => [r.key, { w: r.w, h: r.h, name: r.name, size: r.blob ? r.blob.size : 0 }]));
    } catch (_) { /* 使えなければ画像なしで進む */ }
  };

  Sh.putFile = async (key, blob, meta = {}) => {
    const [t, f] = await tx([FILES], 'readwrite');
    f.put({ key, blob, w: meta.w || 0, h: meta.h || 0, name: meta.name || '', t: Date.now() });
    await done(t);
    const old = fileUrls.get(key);
    if (old) URL.revokeObjectURL(old);
    fileUrls.set(key, URL.createObjectURL(blob));
    (Sh.fileMeta = Sh.fileMeta || new Map()).set(key, { w: meta.w || 0, h: meta.h || 0, name: meta.name || '', size: blob.size });
    return fileUrls.get(key);
  };

  Sh.removeFile = async (key) => {
    const [t, f] = await tx([FILES], 'readwrite');
    f.delete(key);
    await done(t);
    const old = fileUrls.get(key);
    if (old) URL.revokeObjectURL(old);
    fileUrls.delete(key);
    if (Sh.fileMeta) Sh.fileMeta.delete(key);
  };

  /** 配置図画像の表示用URL（無ければ空文字） */
  Sh.fileUrl = (key) => fileUrls.get(key) || '';
  Sh.mapUrl = (eventId) => Sh.fileUrl('map:' + eventId);
  Sh.mapMeta = (eventId) => (Sh.fileMeta && Sh.fileMeta.get('map:' + eventId)) || null;

  /** 端末の空き容量の目安（取れないブラウザでは null） */
  Sh.quota = async () => {
    try {
      const e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    } catch (_) { return null; }
  };
})();
