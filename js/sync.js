/* PCとスマホで計画・記録を共有する（Google Apps Script に置いた JSON を読み書きするだけ）
   - 通信が切れていてもアプリは普段どおり動き、つながったときにまとめて送る（オフライン優先）
   - 送るのは計画・記録・お気に入り・自作の配置図。画面設定は端末ごとに残す
   - 合言葉はサーバーに送らず、そのハッシュ（k）だけを使う */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const S = () => HC.store;
  const Sy = (HC.sync = {});

  const PUSH_WAIT = 4000; // 変更してから送るまでの待ち（打っている途中で送らない）

  Sy.state = { busy: false, last: '', error: '' };

  /** 失敗の理由を日本語にする（原因がひと目で分かるように） */
  const niceError = (e) => {
    const m = String((e && e.message) || e || '');
    if (/failed to fetch|networkerror|load failed|network request/i.test(m)) return 'つながりませんでした（URLと電波を確認してください）';
    if (/応答が 40[0-9]/.test(m)) return 'アクセスを断られました（GASのデプロイを「アクセスできるユーザー：全員」にしてください）';
    if (/応答が 5\d\d/.test(m)) return 'サーバー側でエラーが出ています（少し待って、もう一度）';
    return m;
  };

  const conf = () => S().state.sync;
  Sy.configured = () => !!(conf().url && conf().phrase);

  /** 合言葉 → サーバー上の置き場所のキー（合言葉そのものは送らない） */
  const keyOf = async (phrase) => {
    const bytes = new TextEncoder().encode('kurunavi:' + phrase);
    if (crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(buf)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // https でないと使えない環境むけの予備（同期は https 前提なので普段は通らない）
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    bytes.forEach((b) => { h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0; h2 = Math.imul(h2 + b, 0x85ebca6b) >>> 0; });
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2);
  };

  /** この端末の呼び名（競合したときにどちらの変更か分かるように） */
  const deviceName = () => {
    const c = conf();
    if (!c.device) {
      c.device = (matchMedia('(pointer: coarse)').matches ? 'スマホ' : 'PC') + '-' + U.uid().slice(-3);
      S().save();
    }
    return c.device;
  };

  // ---- 通信 ------------------------------------------------------------
  const get = async (k) => {
    const url = `${conf().url}?k=${encodeURIComponent(k)}&t=${Date.now()}`;
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (!res.ok) throw new Error('サーバーの応答が ' + res.status);
    return res.json();
  };
  const post = async (payload) => {
    // text/plain で送ると事前確認（preflight）が起きず、GAS でもそのまま受け取れる
    const res = await fetch(conf().url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('サーバーの応答が ' + res.status);
    return res.json();
  };

  // ---- 送る・取り込む --------------------------------------------------
  /** 送受信するのは計画まわりだけ（テーマや地図の向きは端末ごと） */
  const payload = () => {
    const st = S().state;
    return { v: 1, eventId: st.eventId, data: st.data, customEvents: st.customEvents, favorites: st.favorites, layouts: st.layouts };
  };

  const apply = (obj) => {
    const st = S().state;
    if (!obj || typeof obj !== 'object') throw new Error('中身を読めません');
    st.data = obj.data || {};
    st.customEvents = obj.customEvents || {};
    st.favorites = obj.favorites || {};
    st.layouts = obj.layouts || {};
    if (obj.eventId && (Object.keys(st.customEvents).includes(obj.eventId) || (HC.bundled || []).some((e) => e.id === obj.eventId))) {
      st.eventId = obj.eventId;
    }
    S().invalidate();
    S().flush();
  };

  /** 送る。opt.force=true で、相手が新しくても上書きする */
  Sy.push = async (opt = {}) => {
    const c = conf();
    if (!Sy.configured()) return { skipped: 'not-configured' };
    if (!navigator.onLine) { c.dirty = true; S().save(); return { skipped: 'offline' }; }
    if (Sy.state.busy) return { skipped: 'busy' };
    Sy.state.busy = true;
    try {
      const k = await keyOf(c.phrase);
      const data = await U.pack(payload());
      const r = await post({ k, data, base: opt.force ? null : (c.syncedAt || 0), device: deviceName() });
      if (r.conflict) return { conflict: true, server: r };
      if (!r.ok) throw new Error(r.error || '保存できませんでした');
      c.syncedAt = r.updated;
      c.dirty = false;
      c.lastAt = Date.now();
      S().save();
      Sy.state.error = '';
      U.emit('sync', { pushed: true });
      return { ok: true, updated: r.updated };
    } catch (e) {
      Sy.state.error = niceError(e);
      c.dirty = true;
      S().save();
      return { error: niceError(e) };
    } finally {
      Sy.state.busy = false;
    }
  };

  /** 取り込む。opt.force=true で、こちらの未送信ぶんを捨てて取り込む */
  Sy.pull = async (opt = {}) => {
    const c = conf();
    if (!Sy.configured()) return { skipped: 'not-configured' };
    if (!navigator.onLine) return { skipped: 'offline' };
    if (Sy.state.busy) return { skipped: 'busy' };
    Sy.state.busy = true;
    try {
      const k = await keyOf(c.phrase);
      const r = await get(k);
      if (!r.ok) throw new Error(r.error || '読み込めませんでした');
      if (!r.updated || !r.data) return { ok: true, empty: true };
      if (r.updated === c.syncedAt && !opt.force) return { ok: true, same: true };
      if (c.dirty && !opt.force) return { conflict: true, server: r };
      applying = true;
      apply(await U.unpack(r.data));
      applying = false;
      c.syncedAt = r.updated;
      c.dirty = false;
      c.lastAt = Date.now();
      S().save();
      Sy.state.error = '';
      U.emit('change', { event: true });
      U.emit('sync', { pulled: true });
      return { ok: true, updated: r.updated, device: r.device };
    } catch (e) {
      applying = false;
      Sy.state.error = niceError(e);
      return { error: niceError(e) };
    } finally {
      Sy.state.busy = false;
    }
  };

  /** 取り込みながら、いまの端末の内容を優先したいとき用（相手を見てから上書き） */
  Sy.overwrite = () => Sy.push({ force: true });
  Sy.takeServer = () => Sy.pull({ force: true });

  // ---- 自動送信 --------------------------------------------------------
  let applying = false;
  const schedule = U.debounce(() => {
    if (!conf().auto || !Sy.configured()) return;
    Sy.push().then((r) => { if (r && r.conflict) U.emit('sync', { conflict: r.server }); });
  }, PUSH_WAIT);

  U.on('change', (m) => {
    if (applying || !Sy.configured()) return;
    if (m && m.sync) return;
    conf().dirty = true;
    schedule();
  });

  window.addEventListener('online', () => { if (conf().dirty) schedule(); });

  /** 起動時：軽く様子を見る（失敗しても画面は普通に使える） */
  Sy.boot = async () => {
    if (!Sy.configured() || !navigator.onLine) return;
    const r = await Sy.pull();
    if (r && r.conflict) U.emit('sync', { conflict: r.server });
  };

  /** 設定の受け渡し（QR用）。合言葉ごと渡すので、スマホ側は読み取るだけで済む */
  Sy.exportConfig = () => ({ app: 'kurunavi', kind: 'sync', url: conf().url, phrase: conf().phrase });
  Sy.importConfig = (o) => {
    if (!o || o.kind !== 'sync' || !o.url) throw new Error('同期の設定ではありません');
    const c = conf();
    c.url = String(o.url);
    c.phrase = String(o.phrase || '');
    c.auto = true;
    c.syncedAt = 0;
    c.dirty = false;
    S().save();
  };
})();
