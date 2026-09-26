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
  const get = async (k, q = '') => {
    const url = `${conf().url}?k=${encodeURIComponent(k)}${q}&t=${Date.now()}`;
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
    st.data = S().migrateData(obj.data || {});
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
    if (S().isDemo()) return { skipped: 'demo' };   // デモの記録は送らない
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
    if (S().isDemo()) return { skipped: 'demo' };   // デモ中に取り込むと練習の記録が上書きされる
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
    Sy.push().then((r) => {
      if (r && r.conflict) U.emit('sync', { conflict: r.server });
      // 送信中に次の変更が来たときは取りこぼさないよう、もう一度予約する
      else if (r && r.skipped === 'busy') schedule();
    });
  }, PUSH_WAIT);

  U.on('change', (m) => {
    if (applying || !Sy.configured() || S().isDemo()) return;
    if (m && m.sync) return;
    conf().dirty = true;
    schedule();
  });

  window.addEventListener('online', () => { if (conf().dirty) schedule(); });

  // ---- 端末を持ち替えたときの取り込み --------------------------------
  let lastPullAt = 0;
  const PULL_GAP = 15000; // 短い間に何度も取りに行かない

  /** 画面に戻ってきたら、別の端末の変更を拾いに行く */
  const maybePull = async () => {
    if (!Sy.configured() || !navigator.onLine || Sy.state.busy) return;
    if (Date.now() - lastPullAt < PULL_GAP) return;
    lastPullAt = Date.now();
    const r = await Sy.pull();
    if (r && r.conflict) U.emit('sync', { conflict: r.server });
    else if (r && r.ok && r.updated) U.emit('sync', { pulledNew: true, device: r.device });
  };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') maybePull(); });
  window.addEventListener('focus', maybePull);

  /** 起動時：軽く様子を見る（失敗しても画面は普通に使える） */
  Sy.boot = async () => {
    if (!Sy.configured() || !navigator.onLine) return;
    lastPullAt = Date.now();
    const r = await Sy.pull();
    if (r && r.conflict) U.emit('sync', { conflict: r.server });
    // ほかの端末が置いたお品書き画像があれば知らせる（受け取るかは本人が決める）
    const n = await Sy.shotsCheck();
    if (n) U.emit('sync', { shotsNew: n });
  };

  // ---- お品書き画像（送る／受け取る） -----------------------------------
  // 計画の同期とは別に、押したときだけ動かす（画像は重いので自動では送らない）。
  // サーバーには画像を1枚ずつ置き、一覧（id・イベント・サークル・送った端末）で差分を見る

  const OLD_GAS = 'GASのコードが古く、画像を置けません。tools/gas/コード.gs を貼り直して「新しいバージョン」でデプロイしてください';

  /** サーバーにある画像の一覧 */
  const shotIndex = async (k) => {
    const r = await get(k, '&op=shots');
    if (!r.ok) throw new Error(r.error || '一覧を読めませんでした');
    if (!r.shots || !Array.isArray(r.list)) throw new Error(OLD_GAS);   // 1.1.x のGASは op を知らない
    return r.list;
  };

  const blobToB64 = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ''));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
  const b64ToBlob = (b64, type) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'image/jpeg' });
  };

  const shotGuard = () => {
    if (!Sy.configured()) return '先に「PCとスマホで同期」を設定してください';
    if (!HC.shots || !HC.shots.ready) return 'この端末では画像を保存できません';
    if (!navigator.onLine) return 'オフラインです。電波のあるところで押してください';
    if (Sy.state.shotBusy) return 'いま画像を送受信しています';
    return '';
  };

  /**
   * この端末で入れた画像のうち、まだ置いていないものを送る。
   * この端末から送ったあとで消したものは、サーバーからも消す
   * @param onStep (i, n) 進み具合
   */
  Sy.shotsPush = async (onStep = () => {}) => {
    const g = shotGuard();
    if (g) return { error: g };
    const Sh = HC.shots;
    Sy.state.shotBusy = true;
    let sent = 0;
    try {
      const k = await keyOf(conf().phrase);
      const dev = deviceName();
      const list = await shotIndex(k);
      const onServer = new Set(list.map((x) => x.id));
      const mine = Sh.all().filter((m) => !m.remote);
      const mineIds = new Set(mine.map((m) => m.id));
      const todo = mine.filter((m) => !onServer.has(m.id));
      // 送ったはずなのにサーバーに無い（誰かが消した）ものは送り直す。送信済みの印だけ付け直す
      for (const m of mine) if (onServer.has(m.id) && !m.sent) await Sh.mark(m.id, { sent: true });
      const gone = list.filter((x) => x.dev === dev && !mineIds.has(x.id)).map((x) => x.id);
      for (let i = 0; i < todo.length; i++) {
        onStep(i, todo.length);
        const m = todo[i];
        const blob = await Sh.blob(m.id);
        if (!blob) continue;
        // base:-1 … 古いGASに当たっても計画のデータを上書きしない（必ず「競合」で返る）
        const r = await post({ op: 'shotPut', k, base: -1, device: dev, id: m.id, meta: { ev: m.ev, cid: m.cid, w: m.w, h: m.h, t: m.t }, data: await blobToB64(blob) });
        if (r.conflict) throw new Error(OLD_GAS);
        if (!r.ok) throw new Error(r.error || '送れませんでした');
        await Sh.mark(m.id, { sent: true });
        sent++;
      }
      onStep(todo.length, todo.length);
      if (gone.length) {
        const r = await post({ op: 'shotDel', k, base: -1, device: dev, ids: gone });
        if (r.conflict) throw new Error(OLD_GAS);
      }
      conf().shotsAt = Date.now();
      S().save();
      return { ok: true, sent, removed: gone.length, total: list.length - gone.length + sent };
    } catch (e) {
      return { error: niceError(e), sent };
    } finally {
      Sy.state.shotBusy = false;
    }
  };

  /**
   * ほかの端末が置いた画像を受け取る（まだ持っていないものだけ）。
   * 送り元で消えたものは、この端末からも消す（この端末で入れた画像には触らない）
   */
  Sy.shotsPull = async (onStep = () => {}) => {
    const g = shotGuard();
    if (g) return { error: g };
    const Sh = HC.shots;
    Sy.state.shotBusy = true;
    let got = 0;
    try {
      const k = await keyOf(conf().phrase);
      const list = await shotIndex(k);
      const have = new Set(Sh.all().map((m) => m.id));
      const skip = Sh.skipped();
      const todo = list.filter((x) => !have.has(x.id) && !skip.has(x.id));
      const onServer = new Set(list.map((x) => x.id));
      const gone = Sh.all().filter((m) => m.remote && !onServer.has(m.id));
      for (let i = 0; i < todo.length; i++) {
        onStep(i, todo.length);
        const x = todo[i];
        const r = await get(k, '&op=shot&id=' + encodeURIComponent(x.id));
        if (!r.ok) { if (r.error === 'notfound') continue; throw new Error(r.error || '受け取れませんでした'); }
        await Sh.addReceived(x, b64ToBlob(r.data, r.type));
        got++;
      }
      onStep(todo.length, todo.length);
      for (const m of gone) await Sh.remove(m.id, { sync: true });
      conf().shotsAt = Date.now();
      S().save();
      return { ok: true, got, removed: gone.length };
    } catch (e) {
      return { error: niceError(e), got };
    } finally {
      Sy.state.shotBusy = false;
    }
  };

  /** 受け取れる画像が何枚あるかだけ見る（起動時に知らせる用。失敗しても黙る） */
  Sy.shotsCheck = async () => {
    if (shotGuard()) return 0;
    try {
      const k = await keyOf(conf().phrase);
      const list = await shotIndex(k);
      const have = new Set(HC.shots.all().map((m) => m.id));
      const skip = HC.shots.skipped();
      return list.filter((x) => !have.has(x.id) && !skip.has(x.id)).length;
    } catch (_) { return 0; }
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
