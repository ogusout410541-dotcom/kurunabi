/* 汎用ヘルパー。ビルド不要・file:// でも動くように全モジュールは window.HC にぶら下げる */
(function () {
  'use strict';
  const HC = (window.HC = window.HC || {});
  const U = (HC.util = {});

  U.$ = (s, r = document) => r.querySelector(s);
  U.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  U.num = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  U.yen = (n) => (n < 0 ? '-¥' : '¥') + U.num(Math.abs(n || 0));
  U.pad2 = (n) => String(n).padStart(2, '0');
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);

  U.debounce = (fn, ms) => {
    let t;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.flush = (...a) => { clearTimeout(t); fn(...a); };
    return d;
  };

  U.time = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}`;
  };
  U.date = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}/${U.pad2(d.getMonth() + 1)}/${U.pad2(d.getDate())}`;
  };
  /** 「10月4日(土)」の形 */
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  U.md = (ts) => {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
  };
  /** 秒まで出す時計表示 */
  U.clockTime = (ts) => {
    const d = new Date(ts);
    return `${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}:${U.pad2(d.getSeconds())}`;
  };
  /** 経過時間 h:mm:ss（1時間未満は m:ss） */
  U.span = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${U.pad2(m)}:${U.pad2(sec)}` : `${m}:${U.pad2(sec)}`;
  };

  /** 全角→半角 */
  U.toHalf = (s) => String(s ?? '').normalize('NFKC');

  /** 検索用正規化: NFKC・小文字・カタカナ→ひらがな・空白や区切り記号除去 */
  U.norm = (s) =>
    U.toHalf(s)
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s　・･\-‐―ー〜~_.,、。!！?？'"]/g, '');

  /** 数字だけ取り出す（価格入力用） */
  U.parseYen = (s) => {
    const n = parseInt(U.toHalf(s).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };

  U.vibrate = (ms = 12) => {
    if (HC.store && !HC.store.state.settings.haptics) return;
    try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* noop */ }
  };

  U.download = (filename, text, mime = 'application/json') => {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  U.readFile = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsText(file);
    });

  U.pickFile = (accept = '.json,application/json,text/plain') =>
    new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.onchange = () => res(inp.files && inp.files[0]);
      inp.click();
    });

  U.copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (__) { /* noop */ }
      ta.remove();
      return ok;
    }
  };

  // ---- 圧縮（共有リンク用）: deflate-raw + base64url。未対応ブラウザは無圧縮 ----
  const b64u = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64u = (str) => {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  const pipe = async (bytes, stream) =>
    new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

  U.pack = async (obj) => {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      try { return 'z' + b64u(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (_) { /* fallthrough */ }
    }
    return 'r' + b64u(raw);
  };
  U.unpack = async (str) => {
    const kind = str[0];
    let bytes = unb64u(str.slice(1));
    if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes));
  };

  // ---- 簡易イベントバス ----
  const listeners = {};
  U.on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn);
  U.emit = (ev, ...a) => (listeners[ev] || []).forEach((fn) => fn(...a));

  // ---- SVG アイコン（stroke系, 24x24） ----
  const P = {
    go: '<path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    map: '<path d="M9 3 3 5.5v15.5l6-2.5 6 2.5 6-2.5V3l-6 2.5z"/><path d="M9 3v15.5M15 5.5V21"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    heart: '<path d="M12 20s-7.5-4.6-9.3-9.2C1.5 7.6 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.5 3.1 4.3 6.3C19.5 15.4 12 20 12 20z"/>',
    pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
    skip: '<path d="m5 5 8 7-8 7zM17 5v14"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    yen: '<path d="m6 3 6 8 6-8M12 11v10M7 13h10M7 17h10"/>',
    star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4l-5.5 2.9 1-6.2L3 9.7l6.2-.9z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    warn: '<path d="M12 4 2.6 20h18.8z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.6" r="1.1" fill="currentColor" stroke="none"/>',
    right: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    minus: '<path d="M5 12h14"/>',
    backspace: '<path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9L2 12z"/><path d="m12 9 5 6M17 9l-5 6"/>',
    note: '<path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5M8.5 13h7M8.5 16.5h5"/>',
    flag: '<path d="M6 21V4"/><path d="M6 4.5h11l-2.2 3.8L17 12H6z"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9 2h6M19.5 6.5l-1.8 1.8"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    move: '<path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M9 4v5h6V4M8 20v-6h8v6"/>',
    print: '<path d="M7 9V3h10v6"/><path d="M5 9h14a2 2 0 0 1 2 2v6h-4v4H7v-4H3v-6a2 2 0 0 1 2-2z"/><path d="M9 15h6"/>',
    door: '<path d="M4 21h16"/><path d="M15 21V3H7v18"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5.2-5.2 2 2-5.2z"/>',
    camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
    offline: '<path d="M3 3l18 18"/><path d="M8.6 15.4a5 5 0 0 1 6.8 0"/><path d="M5 12a10 10 0 0 1 4-2.4M19 12a10 10 0 0 0-7.6-2.9"/><path d="M2 8.8A15 15 0 0 1 7 6M22 8.8a15 15 0 0 0-9-2.7"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
    wifi: '<path d="M8.6 15.4a5 5 0 0 1 6.8 0"/><path d="M5.2 11.8a10 10 0 0 1 13.6 0"/><path d="M2 8.4a15 15 0 0 1 20 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
    xlogo: '<path d="M13.68 10.62 20.24 3h-1.55l-5.7 6.62L8.45 3H3.2l6.88 10.01L3.2 21h1.55l6.02-6.99L15.57 21h5.24l-7.13-10.38z" fill="currentColor" stroke="none"/>',
  };
  // 塗りで描くマーク（ブランドロゴなど）は線幅を持たせない
  const FILLED = new Set(['xlogo']);
  U.icon = (name, cls = '') =>
    `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="${FILLED.has(name) ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
})();
