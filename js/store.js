/* 状態管理・永続化・集計。UIはここの関数だけを通してデータを書き換える */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const P = HC.parser;
  const Lay = HC.layout;
  const S = (HC.store = {});

  const KEY = 'kurunavi.v1';
  const BACKUP_KEY = 'kurunavi.backup';
  const VERSION = 1;

  S.PRI = {
    1: { label: '必須', short: 'S', cls: 'p1' },
    2: { label: '優先', short: 'A', cls: 'p2' },
    3: { label: '通常', short: 'B', cls: 'p3' },
    4: { label: '余裕', short: 'C', cls: 'p4' },
  };
  S.STATUS = {
    todo: { label: '未購入', cls: 'st-todo' },
    later: { label: 'あとで', cls: 'st-later' },
    done: { label: '購入済', cls: 'st-done' },
    soldout: { label: '売切', cls: 'st-soldout' },
    skip: { label: '見送り', cls: 'st-skip' },
  };
  S.ITEM_PRESETS = ['新刊', '既刊', '新刊セット', 'グッズ', 'アクスタ', '缶バッジ', 'ステッカー', '色紙', '無料配布'];
  S.PRICE_PRESETS = [100, 300, 500, 700, 1000, 1500, 2000, 3000, 5000];

  const defaultSettings = () => ({
    theme: 'auto',
    font: 1,
    haptics: true,
    wakeLock: true,
    mapMode: 'simple', // simple | image
    mapOrient: 'auto', // auto | land | port
    routeMode: 'must', // must | tier | short
    showRoute: true,
    defaultPay: 'cash',
  });

  // PCとスマホの同期（js/sync.js）。url と phrase が入っていれば動く
  const defaultSync = () => ({
    url: '',        // GAS ウェブアプリの /exec URL
    phrase: '',     // 合言葉（サーバーには送らず、ハッシュだけ使う）
    auto: true,     // 変更してから数秒後に自動で送る
    syncedAt: 0,    // 最後に確認したサーバー側の更新時刻
    dirty: false,   // まだ送っていない変更があるか
    lastAt: 0,      // 最後に送受信した時刻（この端末の時計）
    device: '',     // この端末の呼び名
  });

  const defaultState = () => ({
    v: VERSION,
    eventId: (HC.bundled && HC.bundled[0] && HC.bundled[0].id) || '',
    customEvents: {},
    data: {},
    favorites: {},
    layouts: {},   // イベントIDごとの配置図（エディタで作ったもの。同梱の配置図より優先）
    sync: defaultSync(),
    settings: defaultSettings(),
  });

  const defaultData = () => ({
    budget: 0,
    cash: 0,
    reserve: 0,
    order: [],
    entries: {},
    extras: [],
    addCircles: [],
    start: '',
    focus: null,
    openAt: '',     // 開場時刻 'HH:MM'（空ならイベント側の既定値。経過時間の基準）
    endAt: '',      // 終了時刻 'HH:MM'（空ならイベント側の既定値）
    startedAt: 0,   // 「いま開始」で押した時刻。openAt が無いときの基準
    updated: Date.now(),
  });

  S.state = defaultState();

  // ------------------------------------------------------------------ 永続化
  S.load = () => {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (_) { /* noop */ }
    if (raw) {
      try { S.state = migrate(JSON.parse(raw)); } catch (e) { console.error(e); S.state = defaultState(); }
    }
    if (!S.allEvents().some((e) => e.id === S.state.eventId)) S.state.eventId = S.allEvents()[0]?.id || '';
  };

  const migrate = (st) => {
    const base = defaultState();
    const out = { ...base, ...st };
    out.settings = { ...defaultSettings(), ...(st.settings || {}) };
    out.customEvents = st.customEvents || {};
    out.data = st.data || {};
    out.favorites = st.favorites || {};
    out.layouts = st.layouts || {};
    out.sync = { ...defaultSync(), ...(st.sync || {}) };
    Object.keys(out.data).forEach((k) => (out.data[k] = { ...defaultData(), ...out.data[k] }));
    out.v = VERSION;
    return out;
  };

  let saveFailedNotified = false;
  const writeNow = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(S.state));
      saveFailedNotified = false;
    } catch (e) {
      console.error(e);
      if (!saveFailedNotified) {
        saveFailedNotified = true;
        U.emit('toast', '保存に失敗しました（容量不足の可能性）。データを書き出してください', { error: true });
      }
    }
  };
  S.save = U.debounce(writeNow, 250);
  S.flush = () => S.save.flush();

  // ------------------------------------------------------------------ イベント
  S.allEvents = () => {
    const b = (HC.bundled || []).map((e) => ({ id: e.id, name: e.name, short: e.short, date: e.date, custom: false }));
    const c = Object.values(S.state.customEvents).map((e) => ({ id: e.id, name: e.name, short: e.short, date: e.date, custom: true }));
    return [...b, ...c];
  };

  const cache = {};
  S.invalidate = (id) => { if (id) delete cache[id]; else Object.keys(cache).forEach((k) => delete cache[k]); S._hist = null; };

  /** 現在（または指定）イベントの解決済みデータ {id,name,circles,byId,layout,image} */
  S.ev = (id = S.state.eventId) => {
    if (cache[id]) return cache[id];
    const bundled = (HC.bundled || []).find((e) => e.id === id);
    const custom = S.state.customEvents[id];
    const src = bundled || custom;
    if (!src) return null;
    let circles = P.parseCompact(src.circles || '');
    const d = S.state.data[id];
    if (d && d.addCircles && d.addCircles.length) {
      const ids = new Set(circles.map((c) => c.id));
      d.addCircles.forEach((c) => { if (!ids.has(c.id)) circles.push({ ...c, added: true }); });
    }
    circles = P.sortCircles(circles);
    let spec = bundled ? bundled.layout : null;
    if (custom && custom.layoutFrom) {
      const from = (HC.bundled || []).find((e) => e.id === custom.layoutFrom);
      spec = from ? from.layout : null;
    }
    if (S.state.layouts && S.state.layouts[id]) spec = S.state.layouts[id]; // 自分で編集した配置図が最優先
    const ev = {
      id,
      name: src.name,
      short: src.short || src.name,
      date: src.date || '',
      openAt: src.openAt || '',
      endAt: src.endAt || '',
      schedule: src.schedule || [],
      custom: !bundled,
      circles,
      byId: new Map(circles.map((c) => [c.id, c])),
      spec,
      _layout: null,
      get layout() {
        if (!this._layout) this._layout = Lay.forCircles(this.spec, this.circles);
        return this._layout;
      },
    };
    ev.blocks = Array.from(new Set(circles.map((c) => c.block)));
    cache[id] = ev;
    return ev;
  };

  /** 現在イベントの利用者データ（無ければ作る） */
  S.d = (id = S.state.eventId) => {
    if (!S.state.data[id]) {
      S.state.data[id] = defaultData();
      const L = S.ev(id)?.layout;
      S.state.data[id].start = L?.starts?.[0]?.id || '';
    }
    return S.state.data[id];
  };

  /** 配置図を差し替える（エディタから）。spec=null で同梱の配置図に戻す */
  S.setLayout = (id, spec) => {
    if (spec) S.state.layouts[id] = spec;
    else delete S.state.layouts[id];
    S.invalidate(id);
    S.save();
    U.emit('change', { event: true });
  };
  S.hasCustomLayout = (id = S.state.eventId) => !!(S.state.layouts && S.state.layouts[id]);

  S.switchEvent = (id) => {
    S.state.eventId = id;
    undoStack.length = 0;
    S.save();
    U.emit('change', { event: true });
  };

  S.createEvent = ({ name, short, date, text, layoutFrom, copyBudgetFrom }) => {
    const circles = P.parseCircleList(text);
    const id = 'ev-' + U.uid();
    S.state.customEvents[id] = {
      id,
      name: name || '新しいイベント',
      short: short || name || '新規',
      date: date || '',
      circles: P.toCompact(circles),
      layoutFrom: layoutFrom || '',
      created: Date.now(),
    };
    const d = S.d(id);
    if (copyBudgetFrom && S.state.data[copyBudgetFrom]) {
      const src = S.state.data[copyBudgetFrom];
      d.budget = src.budget; d.cash = src.cash; d.reserve = src.reserve;
    }
    S.invalidate(id);
    S.state.eventId = id;
    S.save();
    U.emit('change', { event: true });
    return { id, count: circles.length };
  };

  S.updateCustomEvent = (id, patch) => {
    const e = S.state.customEvents[id];
    if (!e) return;
    Object.assign(e, patch);
    S.invalidate(id);
    S.save();
    U.emit('change', { event: true });
  };

  S.deleteEvent = (id) => {
    delete S.state.customEvents[id];
    delete S.state.data[id];
    delete S.state.layouts[id];
    S.invalidate(id);
    if (S.state.eventId === id) S.state.eventId = S.allEvents()[0]?.id || '';
    S.save();
    U.emit('change', { event: true });
  };

  // ------------------------------------------------------------------ 変更＆元に戻す
  const undoStack = [];
  S.canUndo = () => undoStack.length > 0 && undoStack[undoStack.length - 1].eventId === S.state.eventId;
  S.undoLabel = () => (S.canUndo() ? undoStack[undoStack.length - 1].label : '');

  /** データ変更は必ずこれを通す。label があれば元に戻せる */
  S.mutate = (label, fn, opt = {}) => {
    const id = S.state.eventId;
    const d = S.d(id);
    if (label) {
      undoStack.push({ label, eventId: id, json: JSON.stringify(d) });
      if (undoStack.length > 50) undoStack.shift();
    }
    const r = fn(d);
    d.updated = Date.now();
    S._hints = null; // 価格のあたり（品名→よく入れている金額）を作り直す
    if (opt.circles) S.invalidate(id);
    S.save();
    U.emit('change', { label, silent: opt.silent });
    return r;
  };

  S.undo = () => {
    if (!S.canUndo()) return null;
    const u = undoStack.pop();
    S.state.data[u.eventId] = JSON.parse(u.json);
    S.invalidate(u.eventId);
    S.save();
    U.emit('change', { undo: true });
    return u.label;
  };

  S.setSetting = (k, v) => {
    S.state.settings[k] = v;
    S.save();
    U.emit('settings', k);
  };

  // ------------------------------------------------------------------ サークル・計画
  S.circle = (cid) => S.ev()?.byId.get(cid) || null;
  S.entry = (cid) => S.d().entries[cid] || null;
  S.isPlanned = (cid) => !!S.d().entries[cid];

  S.newEntry = (c, pri = 3) => ({
    cid: c.id,
    pri,
    items: [],
    memo: '',
    menu: '',
    status: 'todo',
    noItems: false,   // true = お品書き待ちではなく、買うものを入れないと決めた
    snap: { name: c.name, tw: c.tw, space: c.space },
    addedAt: Date.now(),
  });

  S.newItem = (name = '', price = 0, qty = 1, extra = {}) => ({
    id: U.uid(),
    name,
    price: Number(price) || 0,
    qty: Math.max(1, Number(qty) || 1),
    status: 'todo',
    paid: null,
    pay: null,
    planned: true,
    t: null,
    ...extra,
  });

  /** お品書きがまだ出ていない＝買うものが1つも入っていないサークル（自分で「入れない」と決めたものは除く） */
  S.isPending = (e) => !!e && !e.noItems && !e.items.some((i) => i.planned !== false);
  S.pendingCids = (id = S.state.eventId) => {
    const d = S.d(id);
    return d.order.filter((cid) => S.isPending(d.entries[cid]));
  };

  S.itemCost = (it) => (it.paid != null ? it.paid : (it.price || 0) * (it.qty || 1));
  S.entryPlanned = (e) => U.sum(e.items.filter((i) => i.planned !== false), (i) => (i.price || 0) * (i.qty || 1));
  S.entrySpent = (e) => U.sum(e.items.filter((i) => i.status === 'bought'), S.itemCost);
  S.entryLeft = (e) => U.sum(e.items.filter((i) => i.status === 'todo'), (i) => (i.price || 0) * (i.qty || 1));

  S.addToPlan = (cid, pri = 3) =>
    S.mutate('計画に追加', (d) => {
      if (d.entries[cid]) { d.entries[cid].pri = pri; return; }
      const c = S.circle(cid);
      if (!c) return;
      d.entries[cid] = S.newEntry(c, pri);
      d.order.push(cid);
    });

  S.removeFromPlan = (cid) =>
    S.mutate('計画から削除', (d) => {
      delete d.entries[cid];
      d.order = d.order.filter((x) => x !== cid);
      if (d.focus === cid) d.focus = null;
    });

  S.setStatus = (cid, status, label) =>
    S.mutate(label || S.STATUS[status].label, (d) => {
      const e = d.entries[cid];
      if (!e) return;
      e.status = status;
      const now = Date.now();
      if (status === 'done') {
        e.doneAt = now;
      } else if (status === 'soldout') {
        e.doneAt = now;
        e.items.forEach((i) => { if (i.status === 'todo') i.status = 'soldout'; });
      } else if (status === 'skip') {
        e.doneAt = now;
      } else if (status === 'todo') {
        e.doneAt = null;
      }
      if (status !== 'todo' && d.focus === cid) d.focus = null;
      if (status === 'later') {
        // あとで回す → 並び順の末尾へ
        d.order = d.order.filter((x) => x !== cid).concat(cid);
      }
    });

  /** 全部買った：未購入アイテムを予定価格で購入扱いにして完了 */
  S.completeAll = (cid, pay) =>
    S.mutate('購入完了', (d) => {
      const e = d.entries[cid];
      if (!e) return;
      const now = Date.now();
      e.items.forEach((i) => {
        if (i.status === 'todo') { i.status = 'bought'; i.paid = null; i.pay = pay || S.state.settings.defaultPay; i.t = now; }
      });
      e.status = 'done';
      e.doneAt = now;
      if (d.focus === cid) d.focus = null;
    });

  S.toggleItem = (cid, iid, pay) =>
    S.mutate('購入チェック', (d) => {
      const e = d.entries[cid];
      const it = e && e.items.find((i) => i.id === iid);
      if (!it) return;
      if (it.status === 'bought') { it.status = 'todo'; it.t = null; it.paid = null; }
      else { it.status = 'bought'; it.t = Date.now(); it.pay = pay || it.pay || S.state.settings.defaultPay; }
    });

  S.setItemStatus = (cid, iid, status) =>
    S.mutate('アイテム状態', (d) => {
      const it = d.entries[cid]?.items.find((i) => i.id === iid);
      if (!it) return;
      it.status = status;
      if (status !== 'bought') { it.paid = null; it.t = null; }
    });

  /** 実際に払った額の記録（アイテム確定 or 追加購入） */
  S.recordPurchase = (cid, { iid, name, amount, qty, pay }) =>
    S.mutate(iid ? '金額を修正' : '追加購入', (d) => {
      const now = Date.now();
      if (!cid) {
        d.extras.push({ id: U.uid(), name: name || 'その他', cost: amount, qty: qty || 1, pay, t: now });
        return;
      }
      const e = d.entries[cid];
      if (!e) return;
      if (iid) {
        const it = e.items.find((i) => i.id === iid);
        if (!it) return;
        if (name != null) it.name = name;
        it.qty = qty || it.qty;
        it.paid = amount;
        if (!it.price) it.price = Math.round(amount / (it.qty || 1));
        it.status = 'bought';
        it.pay = pay;
        it.t = it.t || now;
      } else {
        e.items.push(S.newItem(name || '追加購入', Math.round(amount / (qty || 1)), qty || 1, {
          status: 'bought', paid: amount, pay, planned: false, t: now,
        }));
      }
    });

  S.removeExtra = (xid) => S.mutate('支出を削除', (d) => { d.extras = d.extras.filter((x) => x.id !== xid); });

  S.reorder = (ids) =>
    S.mutate('並べ替え', (d) => {
      const set = new Set(ids);
      d.order = ids.concat(d.order.filter((x) => !set.has(x)));
    });

  S.move = (cid, delta) =>
    S.mutate('並べ替え', (d) => {
      const i = d.order.indexOf(cid);
      const j = U.clamp(i + delta, 0, d.order.length - 1);
      if (i < 0 || i === j) return;
      d.order.splice(i, 1);
      d.order.splice(j, 0, cid);
    });

  S.focus = (cid) => S.mutate(null, (d) => { d.focus = cid; }, { silent: true });

  /** 当日の進行状況 */
  S.queue = () => {
    const d = S.d();
    const todo = [], later = [], finished = [];
    d.order.forEach((cid) => {
      const e = d.entries[cid];
      if (!e) return;
      if (e.status === 'todo') todo.push(cid);
      else if (e.status === 'later') later.push(cid);
      else finished.push(cid);
    });
    const f = d.focus && d.entries[d.focus];
    const current = f && (f.status === 'todo' || f.status === 'later') ? d.focus : todo[0] || later[0] || null;
    return { current, todo, later, finished };
  };

  /** 予算まわりの集計 */
  S.stats = () => {
    const d = S.d();
    let spent = 0, cashSpent = 0, plannedLeft = 0, mustLeft = 0, plannedTotal = 0, unknown = 0;
    let doneCount = 0, activeCount = 0, mustTotal = 0, mustDone = 0;
    const pay = S.state.settings.defaultPay;
    Object.values(d.entries).forEach((e) => {
      const active = e.status === 'todo' || e.status === 'later';
      if (active) activeCount++;
      else doneCount++;
      if (e.pri === 1) { mustTotal++; if (!active) mustDone++; }
      e.items.forEach((i) => {
        const planned = (i.price || 0) * (i.qty || 1);
        if (i.planned !== false) plannedTotal += planned;
        if (i.status === 'bought') {
          const c = S.itemCost(i);
          spent += c;
          if ((i.pay || pay) === 'cash') cashSpent += c;
        } else if (i.status === 'todo' && active) {
          plannedLeft += planned;
          if (e.pri === 1) mustLeft += planned;
          if (!i.price) unknown++;
        }
      });
      if (active && !e.items.some((i) => i.status === 'todo')) unknown++;
    });
    d.extras.forEach((x) => {
      spent += x.cost || 0;
      if ((x.pay || pay) === 'cash') cashSpent += x.cost || 0;
    });
    const usable = (d.budget || 0) - (d.reserve || 0);
    return {
      budget: d.budget || 0,
      reserve: d.reserve || 0,
      usable,
      spent,
      cashSpent,
      left: usable - spent,
      plannedLeft,
      mustLeft,
      plannedTotal,
      projected: usable - spent - plannedLeft,
      cash: d.cash || 0,
      cashLeft: d.cash ? d.cash - cashSpent : null,
      unknown,
      doneCount,
      activeCount,
      total: doneCount + activeCount,
      mustTotal,
      mustDone,
    };
  };

  /**
   * 「どこまで買ったらいくらか」の試算。優先度の高いほうから積み上げ、
   * 予算・持っていく現金との差を返す（当日の判断材料にする）
   */
  S.simulate = () => {
    const d = S.d();
    const st = S.stats();
    const pay = S.state.settings.defaultPay;
    const extras = U.sum(d.extras, (x) => x.cost);
    // 価格未定を見積もるための平均単価（今の計画で分かっている値から）
    const known = [];
    Object.values(d.entries).forEach((e) => e.items.forEach((i) => { if (i.status === 'todo' && i.price) known.push(i.price); }));
    const avg = known.length ? Math.round(U.sum(known) / known.length) : 0;

    const LABEL = ['必須だけ', '優先まで', '通常まで', 'すべて'];
    let cum = 0, cumCount = 0, cumUnknown = 0;
    const rows = [1, 2, 3, 4].map((tier) => {
      let add = 0, count = 0, unknown = 0;
      Object.values(d.entries).forEach((e) => {
        if (e.pri !== tier || !(e.status === 'todo' || e.status === 'later')) return;
        count++;
        e.items.forEach((i) => {
          if (i.status !== 'todo') return;
          if (i.price) add += i.price * (i.qty || 1);
          else unknown++;
        });
      });
      cum += add; cumCount += count; cumUnknown += unknown;
      const total = st.spent + cum;
      return {
        tier,
        label: LABEL[tier - 1],
        count,
        cumCount,
        add,
        cum,
        total,
        budgetLeft: st.usable ? st.usable - total : null,
        cashLeft: d.cash ? d.cash - (st.cashSpent + (pay === 'cash' ? cum : 0)) : null,
        unknown: cumUnknown,
        unknownEst: cumUnknown * avg,
      };
    });
    // 予算に収まる一番深いところ
    // 1件も無い段は見出しとして意味がないので、収まる段の判定から外す
    const fits = st.usable ? [...rows].reverse().find((r) => r.budgetLeft >= 0 && (r.count > 0 || r.tier === 1)) : null;
    return { rows, spent: st.spent, extras, usable: st.usable, cash: d.cash || 0, avg, fitTier: fits ? fits.tier : 0 };
  };

  /**
   * 品名 → よく入れている金額。自分が過去（他イベント含む）に入れた値の多数決。
   * 「＋新刊」を押したときに価格まで入れてしまうために使う
   */
  S.priceHints = () => {
    if (S._hints) return S._hints;
    const tally = new Map(); // 正規化した品名 → Map(金額 → 回数)
    Object.values(S.state.data).forEach((d) => {
      Object.values(d.entries || {}).forEach((e) => {
        (e.items || []).forEach((i) => {
          const key = U.norm(i.name);
          if (!key) return;
          const unit = i.status === 'bought' && i.paid != null ? Math.round(i.paid / (i.qty || 1)) : i.price;
          if (!unit) return;
          if (!tally.has(key)) tally.set(key, new Map());
          const m = tally.get(key);
          m.set(unit, (m.get(unit) || 0) + 1);
        });
      });
    });
    const out = new Map();
    tally.forEach((m, key) => {
      let best = 0, bestN = 0;
      m.forEach((n, price) => { if (n > bestN || (n === bestN && price > best)) { best = price; bestN = n; } });
      if (best) out.set(key, best);
    });
    S._hints = out;
    return out;
  };
  S.priceHint = (name) => S.priceHints().get(U.norm(name)) || 0;

  /**
   * いまいる場所の近くで、まだ回っていない計画サークル（近い順）
   * @param maxDist 配置図の座標での距離のしきい値（島ひとつ分がだいたい60〜70）
   */
  S.nearby = (cid, n = 3, maxDist = 130) => {
    const ev = S.ev();
    if (!ev) return [];
    const L = ev.layout;
    const here = Lay.pointOf(L, S.circle(cid));
    if (!here) return [];
    const d = S.d();
    const out = [];
    d.order.forEach((x) => {
      if (x === cid) return;
      const e = d.entries[x];
      if (!e || !(e.status === 'todo' || e.status === 'later')) return;
      const p = Lay.pointOf(L, S.circle(x));
      if (!p) return;
      const dist = Lay.dist(L, here, p);
      if (dist <= maxDist) out.push({ cid: x, dist });
    });
    return out.sort((a, b) => a.dist - b.dist).slice(0, n);
  };

  /**
   * 当日の時間まわり。基準は「開場時刻」、無ければ「いま開始」を押した時刻。
   * どちらも無ければ base=0（経過は出さない）
   */
  /** 'HH:MM' を今日のその時刻（ミリ秒）に。6時間以上先なら前日扱い（深夜に開いたとき用） */
  const atTime = (hhmm, now) => {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    const day = new Date(now);
    day.setHours(h, m, 0, 0);
    if (day.getTime() - now > 6 * 3600000) day.setDate(day.getDate() - 1);
    return day.getTime();
  };

  /** 開場・終了時刻とタイムテーブル（イベントの既定値を、この端末の設定で上書きできる） */
  S.times = (id = S.state.eventId) => {
    const d = S.d(id), ev = S.ev(id) || {};
    return { openAt: d.openAt || ev.openAt || '', endAt: d.endAt || ev.endAt || '', schedule: ev.schedule || [] };
  };

  /** 'HH:MM' → 0時からのミリ秒 */
  const hm2ms = (hhmm) => {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return -1;
    const [h, m] = hhmm.split(':').map(Number);
    return (h * 60 + m) * 60000;
  };

  /** 開催日（'YYYY-MM-DD'）。イベント側の指定が無ければこの端末で入れた日付 */
  S.eventDate = (id = S.state.eventId) => {
    const ev = S.ev(id) || {};
    return ev.date || S.d(id).date || '';
  };

  S.clock = (now = Date.now()) => {
    const d = S.d();
    const T = S.times();
    const dateStr = S.eventDate();
    // 開催日が入っていれば、その日の時刻として数える（別の日に開いても「終了しました」にならないように）
    const dayRaw = dateStr ? new Date(dateStr + 'T00:00:00').getTime() : NaN;
    const dayBase = Number.isNaN(dayRaw) ? 0 : dayRaw;
    const o = hm2ms(T.openAt), e = hm2ms(T.endAt);
    const today0 = new Date(now).setHours(0, 0, 0, 0);
    let base = 0, end = 0, state = 'none', days = 0;
    if (dayBase) {
      end = e >= 0 ? dayBase + e : 0;
      if (today0 < dayBase) {          // 開催日より前
        state = 'before';
        base = o >= 0 ? dayBase + o : dayBase;
        days = Math.round((dayBase - today0) / 86400000);
      } else if (today0 > dayBase) {   // 開催日より後
        state = 'after';
        base = o >= 0 ? dayBase + o : dayBase;
      } else {                         // 開催日の当日
        base = o >= 0 ? dayBase + o : d.startedAt || 0;
      }
    } else {
      base = atTime(T.openAt, now);
      end = atTime(T.endAt, now);
    }
    if (!base && d.startedAt) base = d.startedAt;
    if (base && end && end < base) end += 86400000; // 日付をまたぐ開催
    if (state === 'none') state = !base ? 'none' : now < base ? 'before' : (end && now > end) ? 'after' : 'live';
    const elapsed = base && state !== 'before' ? now - base : 0;
    const st = S.stats();
    // 完了ペースからの終了見込み（2件以上終わっていて、経過が5分以上のときだけ）
    let eta = 0, perMs = 0;
    if (state === 'live' && st.doneCount >= 2 && elapsed > 5 * 60000 && st.activeCount > 0) {
      perMs = elapsed / st.doneCount;
      const rest = perMs * st.activeCount;
      if (rest < 8 * 3600000) eta = now + rest; // 8時間より先は当てにならないので出さない
    }
    // 終了時刻までの残り。未訪問1件あたりの持ち時間も出す（急かすためではなく配分の目安）
    const left = end && state === 'live' ? end - now : 0;
    const perLeft = left > 0 && st.activeCount > 0 ? left / st.activeCount : 0;
    return { now, base, end, state, days, date: dateStr, elapsed, eta, perMs, left, perLeft, endAt: T.endAt, openAt: T.openAt, before: state === 'before' };
  };

  /** 巡回順を自動生成（未完了分のみ並べ替え） */
  S.optimize = (mode = S.state.settings.routeMode, fromCurrent = false) =>
    S.mutate('ルート作成', (d) => {
      const ev = S.ev();
      const L = ev.layout;
      const active = [], fixed = [];
      d.order.forEach((cid) => {
        const e = d.entries[cid];
        if (!e) return;
        (e.status === 'todo' || e.status === 'later' ? active : fixed).push(cid);
      });
      let start = S.startPoint();
      if (fromCurrent) {
        const last = fixed
          .map((cid) => d.entries[cid])
          .filter((e) => e.doneAt)
          .sort((a, b) => b.doneAt - a.doneAt)[0];
        const p = last && Lay.pointOf(L, S.circle(last.cid));
        if (p) start = p;
      }
      const groups =
        mode === 'short' ? [active]
          : mode === 'tier' ? [1, 2, 3, 4].map((p) => active.filter((cid) => d.entries[cid].pri === p))
            : [active.filter((cid) => d.entries[cid].pri === 1), active.filter((cid) => d.entries[cid].pri !== 1)];
      const seq = [];
      let cur = start;
      groups.forEach((g) => {
        const withP = [], noP = [];
        g.forEach((cid) => {
          const p = Lay.pointOf(L, S.circle(cid));
          (p ? withP : noP).push({ id: cid, p });
        });
        const ids = Lay.route(L, withP, cur);
        seq.push(...ids, ...noP.map((x) => x.id));
        const lastP = ids.length && withP.find((x) => x.id === ids[ids.length - 1]);
        if (lastP) cur = lastP.p;
      });
      d.order = [...fixed, ...seq];
      d.focus = null;
    });

  S.startPoint = () => {
    const L = S.ev().layout;
    const d = S.d();
    const st = L.starts.find((s) => s.id === d.start);
    if (st) return st;
    if (d.start && L.bySid.get(d.start)) {
      const c = L.bySid.get(d.start);
      return { x: c.sx, y: c.sy };
    }
    return L.starts[0];
  };

  /** 残りルートの移動量（全体比較用の目安） */
  S.remainingPath = () => {
    const L = S.ev().layout;
    const q = S.queue();
    const pts = [S.startPoint()];
    [...q.todo, ...q.later].forEach((cid) => {
      const p = Lay.pointOf(L, S.circle(cid));
      if (p) pts.push(p);
    });
    return Lay.pathLength(L, pts);
  };

  // ------------------------------------------------------------------ お気に入り・過去の購入
  S.keysOf = (c) => {
    const k = [];
    if (c.tw) k.push('tw:' + c.tw.toLowerCase());
    if (c.name) k.push('nm:' + U.norm(c.name));
    return k;
  };
  S.isFav = (c) => S.keysOf(c).some((k) => S.state.favorites[k]);
  S.toggleFav = (c) => {
    const keys = S.keysOf(c);
    const on = S.isFav(c);
    keys.forEach((k) => { if (on) delete S.state.favorites[k]; });
    if (!on) S.state.favorites[keys[0]] = { name: c.name, tw: c.tw, t: Date.now() };
    S.save();
    U.emit('change', {});
    return !on;
  };

  /** 他イベントでの購入履歴 {key -> [{eventId, name, spent, status}]} */
  S.history = () => {
    if (S._hist) return S._hist;
    const idx = {};
    const names = Object.fromEntries(S.allEvents().map((e) => [e.id, e.short || e.name]));
    Object.entries(S.state.data).forEach(([eid, d]) => {
      if (eid === S.state.eventId) return;
      Object.values(d.entries || {}).forEach((e) => {
        if (!e.snap) return;
        const rec = { eventId: eid, event: names[eid] || eid, spent: S.entrySpent(e), status: e.status };
        S.keysOf(e.snap).forEach((k) => (idx[k] = idx[k] || []).push(rec));
      });
    });
    S._hist = idx;
    return idx;
  };
  U.on('change', (m) => { if (m && (m.event || m.undo)) S._hist = null; });

  S.historyOf = (c) => {
    const h = S.history();
    const seen = new Set();
    const out = [];
    S.keysOf(c).forEach((k) => (h[k] || []).forEach((r) => {
      if (seen.has(r.eventId)) return;
      seen.add(r.eventId);
      out.push(r);
    }));
    return out;
  };

  // ------------------------------------------------------------------ 手動追加サークル
  S.addCircle = ({ space, name, tw }) => {
    const m = U.toHalf(space).trim().match(/^([A-Za-z]{1,2})\s*-?\s*(.+)$/);
    const nums = m && P.parseNums(m[2]);
    if (!nums) return { error: 'スペース番号を「G23」「A01-02」の形で入力してください' };
    const block = m[1].toUpperCase();
    const c = { id: block + U.pad2(nums[0]), block, nums, space: P.spaceLabel(block, nums), name: name || '（名称未設定）', tw: P.twitterHandle(tw || ''), px: '', web: '' };
    if (S.ev().byId.has(c.id) && !S.d().addCircles.some((x) => x.id === c.id)) return { error: `${c.space} はすでに登録されています` };
    S.mutate('サークル追加', (d) => {
      d.addCircles = d.addCircles.filter((x) => x.id !== c.id).concat(c);
    }, { circles: true });
    return { circle: c };
  };

  // ------------------------------------------------------------------ 入出力
  /* 共有リンク（QRに載せたいので短くしたい）用に、既定値と復元できる情報を落とす。
     落としたぶんは読み込み側の fatten() で戻す */
  const slimItem = (i) => {
    const o = { n: i.name };
    if (i.price) o.p = i.price;
    if (i.qty > 1) o.q = i.qty;
    if (i.status !== 'todo') o.s = i.status;
    if (i.paid != null) o.a = i.paid;
    if (i.pay) o.y = i.pay;
    if (i.planned === false) o.x = 1;
    if (i.t) o.tt = i.t;   // 買った時刻（記録をそのまま持ち帰れるように）
    return o;
  };
  const fatItem = (o) =>
    typeof o === 'object' && o && 'n' in o
      ? { id: U.uid(), name: o.n, price: o.p || 0, qty: o.q || 1, status: o.s || 'todo', paid: o.a != null ? o.a : null, pay: o.y || null, planned: !o.x, t: o.tt || null }
      : { ...S.newItem(), ...o };

  const slimEntry = (e, known) => {
    const o = { c: e.cid, r: e.pri, i: e.items.map(slimItem) };
    if (e.memo) o.m = e.memo;
    if (e.menu) o.u = e.menu;
    if (e.status !== 'todo') o.s = e.status;
    if (e.noItems) o.ni = 1;
    // サークル名などは読み込み側でイベントの一覧から引けるので、引けない時だけ持たせる
    if (e.snap && !known.has(e.cid)) o.k = [e.snap.name, e.snap.tw || '', e.snap.space || ''];
    if (e.doneAt) o.da = e.doneAt;
    return o;
  };
  const fatEntry = (o, byId) => {
    if (!o || !('c' in o)) return o; // すでに通常形式
    const c = byId.get(o.c);
    const snap = c ? { name: c.name, tw: c.tw, space: c.space } : { name: (o.k || [])[0] || o.c, tw: (o.k || [])[1] || '', space: (o.k || [])[2] || o.c };
    return { cid: o.c, pri: o.r || 3, items: (o.i || []).map(fatItem), memo: o.m || '', menu: o.u || '', status: o.s || 'todo', noItems: !!o.ni, doneAt: o.da || null, snap, addedAt: Date.now() };
  };

  /** 読み込んだ計画データを通常形式へ戻す（スリム形式・通常形式のどちらでも通る） */
  const fatten = (data, byId = new Map()) => {
    const d = { ...defaultData(), ...data };
    const entries = {};
    Object.entries(d.entries || {}).forEach(([cid, e]) => {
      const fat = fatEntry(e, byId);
      entries[cid] = { ...fat, cid: fat.cid || cid };
      entries[cid].items = (fat.items || []).map((i) => (i && i.id ? i : fatItem(i)));
    });
    d.entries = entries;
    d.order = (d.order || []).filter((cid) => entries[cid]);
    Object.keys(entries).forEach((cid) => { if (!d.order.includes(cid)) d.order.push(cid); });
    return d;
  };

  /**
   * 計画の書き出し
   * @param {string} id イベントID
   * @param {{slim?: boolean}} opt slim=true で共有リンク用に圧縮（既定値・snap・IDを省く）
   */
  S.exportPlan = (id = S.state.eventId, opt = {}) => {
    const custom = S.state.customEvents[id];
    const d = S.d(id);
    const data = opt.slim
      ? {
          ...(d.budget ? { budget: d.budget } : {}),
          ...(d.cash ? { cash: d.cash } : {}),
          ...(d.reserve ? { reserve: d.reserve } : {}),
          ...(d.start ? { start: d.start } : {}),
          ...(d.openAt ? { openAt: d.openAt } : {}),
          ...(d.endAt ? { endAt: d.endAt } : {}),
          ...(d.openAt ? { openAt: d.openAt } : {}),
          ...(d.endAt ? { endAt: d.endAt } : {}),
          ...(d.extras && d.extras.length ? { extras: d.extras } : {}),
          ...(d.addCircles && d.addCircles.length ? { addCircles: d.addCircles } : {}),
          order: d.order.filter((cid) => d.entries[cid]),
          entries: Object.fromEntries(Object.entries(d.entries).map(([cid, e]) => [cid, slimEntry(e, S.ev(id)?.byId || new Map())])),
        }
      : d;
    return {
      app: 'kurunavi',
      kind: 'plan',
      v: VERSION,
      ...(opt.slim ? {} : { exportedAt: new Date().toISOString() }),
      eventId: id,
      event: custom || null,
      data,
      // お気に入りは判定にキーしか使わない（S.isFav）ので、スリム形式ではキーだけ送る
      ...(opt.slim ? { favKeys: Object.keys(S.state.favorites) } : { favorites: S.state.favorites }),
    };
  };

  S.exportAll = () => ({ app: 'kurunavi', kind: 'backup', v: VERSION, exportedAt: new Date().toISOString(), state: S.state });

  S.backupNow = () => {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ t: Date.now(), state: S.state })); } catch (_) { /* noop */ }
  };
  S.restoreBackup = () => {
    try {
      const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
      if (!b) return false;
      S.state = migrate(b.state);
      S.invalidate();
      S.flush();
      U.emit('change', { event: true });
      return b.t;
    } catch (_) { return false; }
  };
  S.backupTime = () => {
    try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null')?.t || 0; } catch (_) { return 0; }
  };

  /** 読み込み。戻り値は結果メッセージ */
  S.importObject = (obj) => {
    if (!obj || obj.app !== 'kurunavi') throw new Error('クルナビのデータではありません');
    S.backupNow();
    if (obj.kind === 'backup') {
      S.state = migrate(obj.state);
      S.invalidate();
      undoStack.length = 0;
      S.flush();
      U.emit('change', { event: true });
      return '全データを復元しました';
    }
    if (obj.kind === 'plan') {
      const id = obj.eventId;
      if (obj.event && !S.state.customEvents[id] && !(HC.bundled || []).some((e) => e.id === id)) {
        S.state.customEvents[id] = obj.event;
      } else if (obj.event && S.state.customEvents[id]) {
        S.state.customEvents[id] = { ...S.state.customEvents[id], ...obj.event };
      }
      if (!S.allEvents().some((e) => e.id === id)) throw new Error('対応するイベントが見つかりません');
      // 手動追加サークルを含めた一覧を作ってから、スリム形式を通常形式へ戻す
      S.state.data[id] = { ...defaultData(), ...obj.data, entries: {}, order: [] };
      S.invalidate(id);
      S.state.data[id] = fatten(obj.data, S.ev(id)?.byId || new Map());
      if (obj.favorites) S.state.favorites = { ...S.state.favorites, ...obj.favorites };
      if (obj.favKeys) obj.favKeys.forEach((k) => { if (!S.state.favorites[k]) S.state.favorites[k] = { name: '', tw: '', t: 0 }; });
      S.state.eventId = id;
      S.invalidate();
      undoStack.length = 0;
      S.flush();
      U.emit('change', { event: true });
      const n = Object.keys(S.state.data[id].entries).length;
      return `${S.ev(id).name} の計画（${n}サークル）を読み込みました`;
    }
    throw new Error('不明なデータ形式です');
  };

  /** 当日記録だけリセット（計画は残す）— リハーサル後などに */
  S.resetDay = () =>
    S.mutate('当日記録リセット', (d) => {
      Object.values(d.entries).forEach((e) => {
        e.status = 'todo';
        e.doneAt = null;
        e.items = e.items.filter((i) => i.planned !== false);
        e.items.forEach((i) => { i.status = 'todo'; i.paid = null; i.pay = null; i.t = null; });
      });
      d.extras = [];
      d.focus = null;
    });

  S.clearEventData = () => S.mutate('計画を全消去', (d) => { Object.assign(d, defaultData(), { budget: d.budget, cash: d.cash, reserve: d.reserve, start: d.start }); });

  /** 購入ログ（時系列） */
  S.log = () => {
    const d = S.d();
    const rows = [];
    Object.values(d.entries).forEach((e) => {
      const c = S.circle(e.cid) || e.snap;
      e.items.forEach((i) => {
        if (i.status === 'bought') rows.push({ t: i.t || e.doneAt || 0, space: c.space, circle: c.name, name: i.name, qty: i.qty, cost: S.itemCost(i), pay: i.pay || S.state.settings.defaultPay, planned: i.planned !== false, cid: e.cid });
      });
    });
    d.extras.forEach((x) => rows.push({ t: x.t, space: '', circle: '（サークル外）', name: x.name, qty: x.qty || 1, cost: x.cost, pay: x.pay || S.state.settings.defaultPay, planned: false, xid: x.id }));
    return rows.sort((a, b) => a.t - b.t);
  };

  S.csv = () => {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const d = S.d();
    const head = ['順番', 'スペース', 'サークル', '優先度', '状態', '品名', '予定単価', '数量', '支払額', '支払方法', '購入時刻', 'メモ'];
    const lines = [head.map(q).join(',')];
    d.order.forEach((cid, i) => {
      const e = d.entries[cid];
      if (!e) return;
      const c = S.circle(cid) || e.snap;
      const items = e.items.length ? e.items : [null];
      items.forEach((it) => {
        lines.push([
          i + 1, c.space, c.name, S.PRI[e.pri].label, S.STATUS[e.status].label,
          it ? it.name : '', it ? it.price : '', it ? it.qty : '',
          it && it.status === 'bought' ? S.itemCost(it) : '',
          it && it.status === 'bought' ? (it.pay === 'card' ? 'キャッシュレス' : '現金') : '',
          it && it.t ? U.time(it.t) : '', e.memo,
        ].map(q).join(','));
      });
    });
    d.extras.forEach((x) => lines.push(['', '', '（サークル外）', '', '購入済', x.name, '', x.qty || 1, x.cost, x.pay === 'card' ? 'キャッシュレス' : '現金', U.time(x.t), ''].map(q).join(',')));
    return '﻿' + lines.join('\r\n');
  };

  // タブを閉じる・裏に回る瞬間に確実に保存
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.flush(); });
  window.addEventListener('pagehide', () => S.flush());
})();
