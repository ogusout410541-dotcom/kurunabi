/* 起動・画面切替・ユーザー操作（data-act）の処理 */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const S = HC.store;
  const V = HC.views;
  const UI = HC.ui;
  const P = HC.parser;

  HC.VERSION = '1.3.2';

  const VIEWS = ['go', 'list', 'map', 'log', 'circles', 'more'];
  const app = (HC.app = { view: 'go', dirty: new Set(VIEWS), sheetCid: null, clockTick: () => {} });

  // ------------------------------------------------------------------ 画面
  app.show = (view, opt = {}) => {
    if (!VIEWS.includes(view)) view = 'go';
    const changed = app.view !== view;
    if (changed && view === 'more' && V.more.full) { V.more.full = false; app.dirty.add('more'); }
    app.view = view;
    VIEWS.forEach((v) => {
      U.$('#v-' + v).hidden = v !== view;
    });
    U.$$('.tabbar [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    document.body.dataset.view = view;
    if (app.dirty.has(view) || view === 'map') renderView(view);
    if (changed && !opt.keepScroll) window.scrollTo(0, 0);
    try { localStorage.setItem('kurunavi.view', view); } catch (_) { /* noop */ }
    updateWake();
    app.clockTick();
    if (view === 'map' && !opt.noLeg) autoLeg();
  };

  const renderView = (v) => {
    const el = U.$('#v-' + v);
    V[v].render(el);
    app.dirty.delete(v);
    if (v === 'go') hydrateShots(el);
    if (v === 'more') app.paintVersion();   // 「いま動いている版／保存されている版」を後から埋める
  };

  app.refresh = () => {
    V.header();
    V.demoBar();
    if (app.noRender) {   // 金種の入力中：いま出ている画面は作り直さず、数字だけ差し替える
      VIEWS.forEach((v) => app.dirty.add(v));
      app.dirty.delete(app.view);
      app.paintDenoms && app.paintDenoms();
      return;
    }
    VIEWS.forEach((v) => app.dirty.add(v));
    renderView(app.view);
    refreshCircleSheet();
    app.paintDenoms && app.paintDenoms();   // 財布のシートを開いたまま変わったとき用
  };

  const refreshCircleSheet = () => {
    if (!UI.isOpen('circle') || !app.sheetCid) return;
    if (app.quiet) {
      // シート内の入力から来た変更：DOMを作り直すとタップが失われるので合計だけ更新
      const e = S.entry(app.sheetCid);
      const el = U.$('[data-sheet="circle"] .cd-sum');
      if (e && el) {
        const sp = S.entrySpent(e);
        el.textContent = `予定 ${U.yen(S.entryPlanned(e))}${sp ? ` ・ 支払済 ${U.yen(sp)}` : ''}`;
      }
      return;
    }
    const wrap = U.$('[data-sheet="circle"]');
    const body = wrap && U.$('.sheet-body', wrap);
    const top = body ? body.scrollTop : 0;
    openCircle(app.sheetCid);
    if (body) body.scrollTop = top;
  };

  // ------------------------------------------------------------------ 外観
  const applyLook = () => {
    const set = S.state.settings;
    const root = document.documentElement;
    if (set.theme === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = set.theme;
    root.style.setProperty('--fs', String((set.font || 1) * (set.dayMode ? 1.12 : 1)));
    document.body.classList.toggle('day', !!set.dayMode);
    document.body.classList.toggle('demo', S.isDemo());
    const dark = set.theme === 'dark' || (set.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = U.$('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#12151c' : '#ffffff';
  };

  // ------------------------------------------------------------------ 画面を消さない
  let wake = null;
  const updateWake = async () => {
    const want = S.state.settings.wakeLock && (S.state.settings.dayMode || app.view === 'go' || app.view === 'map') && document.visibilityState === 'visible';
    if (want && !wake && 'wakeLock' in navigator) {
      try {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      } catch (_) { wake = null; }
    } else if (!want && wake) {
      try { await wake.release(); } catch (_) { /* noop */ }
      wake = null;
    }
  };
  document.addEventListener('visibilitychange', updateWake);

  // ------------------------------------------------------------------ 共通処理
  const circleLabel = (cid) => {
    const c = S.circle(cid) || S.entry(cid)?.snap;
    return c ? `${c.space} ${c.name}` : cid;
  };

  const openCircle = (cid) => {
    const c = S.circle(cid);
    if (!c) return;
    app.sheetCid = cid;
    UI.sheet({
      id: 'circle',
      side: true,
      title: S.isPlanned(cid) ? 'サークル詳細・計画' : 'サークル詳細',
      html: V.circleSheet(cid),
      onClose: () => { app.sheetCid = null; },
    });
  };
  app.openCircle = openCircle;

  const afterFinish = (cid, label) => {
    U.vibrate(18);
    app.curGuard = Date.now() + 700;   // 次のカードのボタンを連打で押してしまわないように
    if (app.view === 'go') renderView('go');
    setTimeout(() => U.$$('.card.cur.enter').forEach((x) => x.classList.remove('enter')), 720);
    const q = S.queue();
    const next = q.current ? S.circle(q.current) : null;
    // チェックだけで終えたときも、現金で払ったぶんは財布の中身から自動で引く（おつりは金種に戻す）
    settleCash(cid);
    UI.toast(`${label}：${circleLabel(cid)}${next ? ` ／ 次は ${next.space}` : ''}`, { undo: true });
    if (app.view === 'go') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** テンキーに出す「現金の出し方」。金種を入れていないときは何も出さない */
  const payHint = (amount) => {
    if (!S.hasCashBreak() || !amount) return '';
    const plan = S.payPlan(amount);
    if (!plan) return '';
    if (plan.short) return `<div class="np-hint-in short">${U.icon('warn', 'sm')}手持ちの現金では足りません（あと ${U.yen(amount - S.cashTotal())}）</div>`;
    const fmt = (use) => S.DENOMS.filter((d) => use[d]).map((d) => `<span>${U.num(d)}<small>×${use[d]}</small></span>`).join('');
    const b = plan.best;
    return `<div class="np-hint-in">
      <div class="ph-row"><b>${b.exact ? 'ちょうど出せます' : `${U.yen(b.pay)} を出す（おつり ${U.yen(b.change)}）`}</b><div class="ph-coins">${fmt(b.use)}</div></div>
      ${plan.alt ? `<div class="ph-row alt"><b>小銭を減らすなら</b><div class="ph-coins">${fmt(plan.alt.use)}</div></div>` : ''}
    </div>`;
  };
  app.payHint = payHint;

  /**
   * 現金で払ったら、財布の中身（金種）から自動で引く。
   * 多めに出しておつりをもらっても、財布の合計は代金ぶんだけ減るので、本人に「引く」操作はさせない。
   * 取り消し（元に戻す）は直前の購入の記録とまとめて戻る
   */
  const deductCash = (r, cid) => {
    if (!r || r.pay !== 'cash' || !(r.amount > 0) || !S.hasCashBreak()) return;
    const plan = S.payPlan(r.amount);
    if (plan && plan.best) S.applyPay(plan.best, cid, { noUndo: true });
  };
  app.deductCash = deductCash;

  /** そのサークルで、まだ財布から引いていない現金をまとめて引く（チェックだけで完了したとき） */
  const settleCash = (cid) => {
    const amount = S.cashUnpaid(cid);
    if (!(amount > 0) || !S.hasCashBreak()) return;
    const plan = S.payPlan(amount);
    if (plan && plan.best) S.applyPay(plan.best, cid, { noUndo: true });
  };

  const numpadForItem = (cid, it) => {
    const unit = it.paid != null ? Math.round(it.paid / (it.qty || 1)) : it.price;
    UI.numpad({
      hint: payHint,
      title: `${it.name || '品物'} の支払額`,
      showName: false,
      amount: unit || '',
      qty: it.qty,
      pay: it.pay,
      okLabel: '購入済にする',
      allowZero: true,   // 無料でもらったものは 0 円で記録できる
      onOk: (r) => {
        S.recordPurchase(cid, { iid: it.id, amount: r.amount, qty: r.qty, pay: r.pay });
        deductCash(r, cid);
        U.vibrate();
        checkAllChecked(cid);
      },
    });
  };

  const checkAllChecked = (cid) => {
    const e = S.entry(cid);
    if (e && e.status === 'todo' && e.items.length && !e.items.some((i) => i.status === 'todo')) {
      UI.toast('全部チェックしました', {
        undo: true,
        action: { label: '完了して次へ', fn: () => { S.setStatus(cid, 'done', '購入完了'); afterFinish(cid, '完了'); } },
      });
    } else {
      UI.toast('記録しました', { undo: true });
    }
  };

  const ensureMap = () => {
    const inst = V.map.inst;
    if (inst && !inst.L) inst.ensure();
    return inst;
  };

  // ------------------------------------------------------------------ アクション
  const A = (HC.actions = {});

  A.nav = (ds) => {
    app.show(ds.view);
    if (ds.scroll) setTimeout(() => U.$('#sec-' + ds.scroll)?.scrollIntoView({ behavior: 'smooth' }), 60);
  };

  A.eventMenu = () => {
    const cur = S.state.eventId;
    UI.menu('イベントを選ぶ', [
      ...S.allEvents().map((e) => ({
        label: e.name, hint: [e.date, e.custom ? '作成' : '同梱'].filter(Boolean).join(' ・ '), active: e.id === cur, icon: e.id === cur ? 'check' : 'cal',
        act: () => { S.switchEvent(e.id); UI.toast(`${e.name} に切り替えました`); },
      })),
      { label: '新しいイベントを作る', icon: 'plus', act: () => A.newEvent() },
    ]);
  };

  A.openCircle = (ds) => openCircle(ds.cid);

  A.quickAdd = (ds) => {
    if (S.isPlanned(ds.cid)) return openCircle(ds.cid);
    S.addToPlan(ds.cid, 3);
    U.vibrate();
    UI.toast(`追加：${circleLabel(ds.cid)}`, { undo: true, action: { label: '買うものを登録', fn: () => openCircle(ds.cid) } });
  };

  A.addPlan = (ds) => {
    S.addToPlan(ds.cid, +ds.pri || 3);
    U.vibrate();
    UI.toast(`${S.PRI[+ds.pri || 3].label}で追加：${circleLabel(ds.cid)}`, { undo: true });
  };

  A.setPri = (ds) => S.mutate('優先度変更', (d) => { if (d.entries[ds.cid]) d.entries[ds.cid].pri = +ds.pri; });

  A.priMenu = (ds) => {
    const e = S.entry(ds.cid);
    UI.menu(`優先度：${circleLabel(ds.cid)}`, [1, 2, 3, 4].map((p) => ({
      label: S.PRI[p].label, active: e && e.pri === p, icon: e && e.pri === p ? 'check' : 'star',
      act: () => A.setPri({ cid: ds.cid, pri: p }),
    })));
  };

  A.setStatus = (ds) => {
    const e = S.entry(ds.cid);
    if (!e) return;
    const st = ds.st;
    if (e.status === st) return;
    S.setStatus(ds.cid, st);
    if (ds.keep) {
      if (st === 'done') settleCash(ds.cid);   // 詳細から購入済にしたときも財布を合わせる
      UI.toast(`${S.STATUS[st].label}にしました`, { undo: true });
      return;
    }
    afterFinish(ds.cid, S.STATUS[st].label);
  };

  A.completeAll = (ds) => {
    const cid = ds.cid;
    const e = S.entry(cid);
    if (!e) return;
    const c = S.circle(cid) || e.snap;
    if (!e.items.length) {
      UI.numpad({
        hint: payHint,
        title: `${c.space} ${c.name} の支払額`,
        name: '',
        okLabel: '記録して完了',
        allowZero: true,
        onOk: (r) => {
          S.mutate('購入完了', (d) => {
            const en = d.entries[cid];
            const now = S.now();
            en.items.push(S.newItem(r.name || '購入品', r.unit, r.qty, { status: 'bought', paid: r.amount, pay: r.pay, planned: false, t: now }));
            en.status = 'done';
            en.doneAt = now;
            if (d.focus === cid) d.focus = null;
          });
          deductCash(r, cid);
          afterFinish(cid, '完了');
        },
      });
      return;
    }
    const unknown = e.items.filter((i) => i.status === 'todo' && S.isUnknown(i));
    if (unknown.length) {
      UI.numpad({
        hint: payHint,
        title: `価格未定「${unknown.map((i) => i.name || '無題').join('・')}」の支払額`,
        showName: false,
        okLabel: '記録して完了',
        allowZero: true,
        onOk: (r) => {
          S.mutate('購入完了', (d) => {
            const en = d.entries[cid];
            const now = S.now();
            let first = true;
            en.items.forEach((i) => {
              if (i.status !== 'todo') return;
              i.status = 'bought';
              i.pay = r.pay;
              i.t = now;
              if (!i.price) { i.paid = first ? r.amount : 0; first = false; }
            });
            en.status = 'done';
            en.doneAt = now;
            if (d.focus === cid) d.focus = null;
          });
          deductCash(r, cid);
          afterFinish(cid, '完了');
        },
      });
      return;
    }
    S.completeAll(cid);
    afterFinish(cid, '完了');
  };

  A.toggleItem = (ds) => {
    const e = S.entry(ds.cid);
    const it = e && e.items.find((i) => i.id === ds.iid);
    if (!it) return;
    if (it.status === 'todo' && S.isUnknown(it)) return numpadForItem(ds.cid, it);
    if (it.status === 'soldout' || it.status === 'skip') { S.setItemStatus(ds.cid, ds.iid, 'todo'); return; }
    S.toggleItem(ds.cid, ds.iid);
    U.vibrate(8);
    if (it.status === 'bought') checkAllChecked(ds.cid); // toggleItem は同じ参照を書き換えている
  };

  A.itemMenu = (ds) => {
    const e = S.entry(ds.cid);
    const it = e && e.items.find((i) => i.id === ds.iid);
    if (!it) return;
    UI.menu(it.name || '品物', [
      { label: it.status === 'bought' ? '支払額を修正' : '支払額を入れて購入済に', icon: 'yen', act: () => numpadForItem(ds.cid, it) },
      it.status === 'bought'
        ? { label: '未購入に戻す', icon: 'undo', act: () => S.setItemStatus(ds.cid, ds.iid, 'todo') }
        : { label: '予定価格で購入済に', icon: 'check', act: () => { S.toggleItem(ds.cid, ds.iid); checkAllChecked(ds.cid); } },
      { label: 'これは売り切れ', icon: 'ban', act: () => { S.setItemStatus(ds.cid, ds.iid, 'soldout'); UI.toast('売切にしました', { undo: true }); } },
      { label: '今回は買わない', icon: 'skip', act: () => S.setItemStatus(ds.cid, ds.iid, 'skip') },
      { label: 'この品物を削除', icon: 'trash', danger: true, act: () => { S.mutate('買うものを削除', (d) => { const en = d.entries[ds.cid]; en.items = en.items.filter((i) => i.id !== ds.iid); }); UI.toast('削除しました', { undo: true }); } },
    ]);
  };

  A.extraBuy = (ds) => {
    const c = S.circle(ds.cid) || S.entry(ds.cid)?.snap;
    UI.numpad({
      hint: payHint,
      title: `${c.space} 追加購入`,
      onOk: (r) => {
        S.recordPurchase(ds.cid, { name: r.name, amount: r.amount, qty: r.qty, pay: r.pay });
        deductCash(r, ds.cid);
        U.vibrate();
        UI.toast(`追加購入 ${U.yen(r.amount)} を記録`, { undo: true });
      },
    });
  };

  A.outsideBuy = () => {
    UI.numpad({
      hint: payHint,
      title: 'サークル外の支出（企業ブース・飲食など）',
      onOk: (r) => {
        S.recordPurchase(null, { name: r.name || 'その他', amount: r.amount, qty: r.qty, pay: r.pay });
        deductCash(r);
        UI.toast(`${U.yen(r.amount)} を記録`, { undo: true });
      },
    });
  };

  A.removeExtra = (ds) => { S.removeExtra(ds.xid); UI.toast('削除しました', { undo: true }); };

  A.focus = (ds) => {
    S.focus(ds.cid);
    app.show('go');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  A.goNow = async (ds) => {
    const e = S.entry(ds.cid);
    if (!e) return;
    if (!(e.status === 'todo' || e.status === 'later')) {
      if (!(await UI.confirm(`${circleLabel(ds.cid)} は「${S.STATUS[e.status].label}」です。未購入に戻して向かいますか？`, { ok: '戻して向かう' }))) return;
      S.setStatus(ds.cid, 'todo');
    }
    UI.closeAll();
    S.focus(ds.cid);
    app.show('go');
  };

  A.move = (ds) => S.move(ds.cid, +ds.d);

  A.showOnMap = (ds) => {
    UI.closeAll();
    app.show('map', { noLeg: true });
    const go = () => {
      const inst = ensureMap();
      if (!inst || !inst.L) return setTimeout(go, 50);
      V.map.select(ds.cid);
      inst.focus(ds.cid);
      setTimeout(() => inst.flash(ds.cid), 300);
    };
    requestAnimationFrame(go);
  };

  A.addItem = (ds) => {
    const name = ds.name || '';
    const e = S.entry(ds.cid);
    // 同じ品名が未購入で入っていたら、行を増やさず数量を足す（押し間違いではなく「2冊買う」ことが多い）
    const same = name && e && e.items.find((i) => i.status === 'todo' && U.norm(i.name) === U.norm(name));
    if (same) {
      S.mutate('数量を増やす', (d) => {
        const it = d.entries[ds.cid].items.find((i) => i.id === same.id);
        if (it) it.qty = U.clamp((it.qty || 1) + 1, 1, 99);
      });
      UI.toast(`${name} を ${same.qty + 1}個にしました`, {
        undo: true,
        action: { label: '別の行にする', fn: () => addItemRow(ds.cid, name, { force: true, restore: same.id }) },
      });
      return;
    }
    addItemRow(ds.cid, name);
  };

  /** 「買うものを登録しない」の切り替え（お品書き待ちの一覧から外す） */
  A.noItems = (ds) => {
    const on = ds.on === '1';
    S.mutate(on ? 'お品書き待ちから外す' : 'お品書き待ちに戻す', (d) => {
      if (d.entries[ds.cid]) d.entries[ds.cid].noItems = on;
    });
    UI.toast(on ? 'お品書き待ちの一覧から外しました' : 'お品書き待ちに戻しました', { undo: true });
  };

  /** 「お品書き画像は登録しない」の切り替え（画像が未登録の一覧から外す） */
  A.noShot = (ds) => {
    const on = ds.on === '1';
    S.mutate(on ? '画像を登録しない' : '画像の登録を戻す', (d) => {
      if (d.entries[ds.cid]) d.entries[ds.cid].noShot = on;
    });
    UI.toast(on ? '画像が未登録の一覧から外しました' : '画像が未登録の一覧に戻しました', { undo: true });
  };

  /** 品目を1行足す。過去に入れた金額が分かっていれば価格も入れておく */
  const addItemRow = (cid, name, opt = {}) => {
    const hint = name ? S.priceHint(name) : 0;
    let newId = null;
    S.mutate('買うものを追加', (d) => {
      if (opt.restore) {
        const it = d.entries[cid].items.find((i) => i.id === opt.restore);
        if (it) it.qty = Math.max(1, (it.qty || 2) - 1);
      }
      const it = S.newItem(name, hint);
      newId = it.id;
      d.entries[cid].items.push(it);
    });
    if (hint) UI.toast(`${name} ${U.yen(hint)}（前と同じ金額を入れました）`, { undo: true });
    // 入力を続けやすいところへ移動する
    setTimeout(() => {
      const sel = name ? `[data-f="iprice"][data-iid="${newId}"]` : `[data-f="iname"][data-iid="${newId}"]`;
      const inp = U.$(sel);
      if (inp && !isCoarse()) { inp.focus(); inp.select && inp.select(); }
    }, 60);
  };

  /** 指で操作している端末か（マウスならキーボード入力のまま） */
  const isCoarse = () => matchMedia('(pointer: coarse)').matches;

  // スマホでは価格欄を触ったらアプリのテンキーを出す（OSのキーボードより速く、数量も一緒に決められる）
  document.addEventListener('focusin', (e) => {
    const inp = e.target.closest && e.target.closest('[data-f="iprice"]');
    if (!inp || !isCoarse()) return;
    inp.blur();
    const ds = inp.dataset;
    const e2 = S.entry(ds.cid);
    const it = e2 && e2.items.find((i) => i.id === ds.iid);
    if (!it) return;
    UI.numpad({
      title: `${it.name || '品物'} の予定価格`,
      showName: false,
      showPay: false,
      allowZero: true,
      amount: it.price || '',
      qty: it.qty,
      okLabel: '決定',
      onOk: (r) => S.mutate('価格変更', (d) => {
        const x = d.entries[ds.cid] && d.entries[ds.cid].items.find((i) => i.id === ds.iid);
        if (x) { x.price = r.unit; x.qty = r.qty; }
      }),
    });
  });

  /** 買うものをまとめて登録 */
  A.bulkItems = async (ds) => {
    const e = S.entry(ds.cid);
    if (!e) return;
    const cur = e.items.filter((i) => i.status === 'todo' && i.planned !== false)
      .map((i) => `${i.name}${i.price ? ' ' + i.price : ''}${i.qty > 1 ? ' x' + i.qty : ''}`).join('\n');
    const v = await UI.prompt('買うものをまとめて登録', {
      value: cur,
      multiline: true,
      ok: '置き換える',
      placeholder: '新刊 1000\nアクスタ 1500 x2\n無料配布',
    });
    if (v == null) return;
    const list = P.parseItemLines(v);
    S.mutate('買うものをまとめて登録', (d) => {
      const en = d.entries[ds.cid];
      // 購入済み・当日の追加分は残し、未購入の予定だけ入れ替える
      const keep = en.items.filter((i) => i.status !== 'todo' || i.planned === false);
      en.items = keep.concat(list.map((x) => S.newItem(x.name, x.price || S.priceHint(x.name), x.qty)));
    });
    UI.toast(`${list.length}件にしました`, { undo: true });
  };

  A.qty = (ds) => S.mutate(null, (d) => {
    const it = d.entries[ds.cid]?.items.find((i) => i.id === ds.iid);
    if (it) it.qty = U.clamp((it.qty || 1) + +ds.d, 1, 99);
  });

  A.removePlan = async (ds) => {
    const e = S.entry(ds.cid);
    if (e && e.items.some((i) => i.status === 'bought')) {
      if (!(await UI.confirm('購入記録があるサークルです。計画から外すと記録も消えます。よろしいですか？', { ok: '外す', danger: true }))) return;
    }
    UI.close('circle');
    S.removeFromPlan(ds.cid);
    UI.toast(`計画から外しました：${circleLabel(ds.cid)}`, { undo: true });
  };

  A.fav = (ds) => {
    const c = S.circle(ds.cid);
    if (!c) return;
    const on = S.toggleFav(c);
    UI.toast(on ? 'お気に入りに登録しました（次回以降のイベントでも印が付きます）' : 'お気に入りを解除しました');
  };

  // ---- その場でメモ（当日カードから）
  A.editMemo = async (ds) => {
    const e = S.entry(ds.cid);
    if (!e) return;
    const v = await UI.prompt(`メモ：${circleLabel(ds.cid)}`, { value: e.memo || '', multiline: true, ok: '保存', placeholder: '例：新刊は完売／2列目に並んだ／次は14時に再訪' });
    if (v == null) return;
    S.mutate('メモ', (d) => { if (d.entries[ds.cid]) d.entries[ds.cid].memo = v.trim(); });
  };

  // ---- 巡回表の印刷（電池切れ・電波なしの保険）
  A.printPlan = () => {
    const d = S.d();
    const ev = S.ev();
    const st = S.stats();
    const T = S.times();
    const rows = d.order.map((cid, i) => {
      const e = d.entries[cid];
      if (!e) return '';
      const c = S.circle(cid) || e.snap;
      const items = e.items.map((it) => `${U.esc(it.name || '（無題）')}${it.qty > 1 ? ` ×${it.qty}` : ''}${it.price ? ` ${U.yen(it.price)}` : ''}`).join('、');
      return `<tr>
        <td class="n">${i + 1}</td>
        <td class="sp">${U.esc(c.space)}${S.isWall(cid) ? ' <small>壁</small>' : ''}</td>
        <td>${U.esc(c.name)}${e.memo ? `<div class="mm">${U.esc(e.memo)}</div>` : ''}</td>
        <td class="pri">${S.PRI[e.pri].label}</td>
        <td class="it">${items || (S.isPending(e) ? '<i>お品書き待ち</i>' : '—')}</td>
        <td class="ck"></td>
      </tr>`;
    }).join('');
    const box = document.createElement('div');
    box.id = 'printsheet';
    box.innerHTML = `<h1>${U.esc(ev.name)} 巡回表</h1>
      <p class="sub">${U.esc(ev.date || d.date || '')}　サークル ${d.order.length}件　予定合計 ${U.yen(st.plannedTotal)}${d.budget ? `　予算 ${U.yen(d.budget)}` : ''}${T.openAt ? `　${U.esc(T.openAt)}〜${U.esc(T.endAt || '')}` : ''}</p>
      <table><thead><tr><th>順</th><th>スペース</th><th>サークル・メモ</th><th>優先</th><th>買うもの</th><th>済</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="foot">クルナビで作成 ／ 印刷日 ${U.date(Date.now())}</p>`;
    document.body.appendChild(box);
    document.body.classList.add('printing');
    const cleanup = () => {
      document.body.classList.remove('printing');
      box.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => { window.print(); setTimeout(cleanup, 800); }, 60);
  };

  // ---- 配置図エディタ
  A.editLayout = () => HC.editor.open();
  A.resetLayout = async () => {
    if (!(await UI.confirm('自分で編集した配置図を捨てて、元の配置図に戻します。よろしいですか？', { ok: '戻す', danger: true }))) return;
    S.setLayout(S.state.eventId, null);
    if (V.map.inst) V.map.inst.build();
    UI.toast('元の配置図に戻しました');
  };

  // ---- バージョンの確認（更新が当たったのか分かるように）
  /** 新しい版が届いたら、ヘッダーに押せる印を出しっぱなしにする */
  const showUpdateChip = () => {
    app.updateReady = true;
    const el = U.$('#update-chip');
    if (!el) return;
    el.hidden = false;
    el.innerHTML = `${U.icon('download', 'sm')}更新あり`;
  };
  app.showUpdateChip = showUpdateChip;

  A.applyUpdate = async () => {
    if (!(await UI.confirm('新しい版に切り替えます。計画・記録はそのまま残ります。\n入力の途中なら、いったん入力欄の外を押してから実行してください。', { ok: '更新する' }))) return;
    S.flush();
    location.reload();
  };
  /**
   * いま配信されている版（Service Worker が持っているキャッシュ名）を聞く。
   * 本体は install のときに skipWaiting で即入れ替わるので、reg.waiting では判定できない。
   * 「画面で動いている版」と「保存されている版」を突き合わせるのが確実
   */
  const storedVersion = async () => {
    const st = await app.swAsk('status');
    const m = st && String(st.cache || '').match(/kurunavi-v([\d.]+)/);
    return m ? m[1] : '';
  };

  /**
   * 設定の「バージョン」欄に、画面で動いている版と、端末に保存されている版の両方を出す。
   * 更新したのに変わらない／新しくなったのか分からない、を画面で確かめられるようにするため
   */
  app.paintVersion = async () => {
    const el = U.$('#ver-state');
    if (!el) return;
    const mark = (cls, text) => { el.className = 'ver-state ' + cls; el.innerHTML = text; };
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      mark('muted small', 'この開き方では、保存されている版は確認できません（公開したURLで開くと出ます）');
      return;
    }
    mark('muted small', '保存されている版を確認中…');
    const v = await storedVersion();
    if (!v) { mark('muted small', '保存されている版を確認できませんでした'); return; }
    if (v === HC.VERSION) mark('ok small', `${U.icon('check', 'sm')}保存されている版も v${v}。最新の状態です`);
    else mark('warn small', `${U.icon('warn', 'sm')}保存されている版は v${v}（画面は v${HC.VERSION}）。読み込み直すと切り替わります`);
  };

  A.checkUpdate = async () => {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || navigator.serviceWorker.controller)) {
      return UI.toast(`いま v${HC.VERSION} です（この開き方では更新確認は使えません）`);
    }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return UI.toast(`いま v${HC.VERSION} です（オフライン用の取り込みがまだです）`);
    UI.toast('新しい版がないか見ています…');
    try { await reg.update(); } catch (_) { /* 圏外など */ }
    await new Promise((r) => setTimeout(r, 2500));
    const v = await storedVersion();
    if ((v && v !== HC.VERSION) || reg.waiting || reg.installing) {
      showUpdateChip();
      UI.toast(`新しい版 ${v ? 'v' + v : ''} があります（いまの画面は v${HC.VERSION}）`, {
        ms: 10000, action: { label: '更新する', fn: () => location.reload() },
      });
    } else {
      UI.toast(`v${HC.VERSION} が最新です`);
    }
  };

  A.reloadApp = () => location.reload();

  // ---- PCとスマホの同期
  const syncMsg = (r) => (r && r.error ? '同期できませんでした：' + r.error : '');

  A.syncSetup = async () => {
    const c = S.state.sync;
    const url = await UI.prompt('同期用のURL（GASウェブアプリの .../exec）', {
      value: c.url, placeholder: 'https://script.google.com/macros/s/.../exec',
      ok: '次へ', type: 'url',
    });
    if (url == null) return;
    const phrase = await UI.prompt('合言葉（PCとスマホで同じものを入れます）', {
      value: c.phrase, placeholder: '例：holocle-12th-ogu',
      ok: '保存',
    });
    if (phrase == null) return;
    c.url = String(url).trim();
    c.phrase = String(phrase).trim();
    c.syncedAt = 0;
    c.dirty = true;
    S.save();
    app.refresh();
    if (!c.url || !c.phrase) return UI.toast('URLと合言葉の両方が要ります', { error: true });
    UI.toast('保存しました。いまの内容を送ります…');
    const r = await HC.sync.push({ force: true });
    UI.toast(r.ok ? '同期の準備ができました' : syncMsg(r), { error: !r.ok });
    app.refresh();
  };

  A.syncNow = async () => {
    if (!HC.sync.configured()) return A.syncSetup();
    UI.toast('送っています…');
    const r = await HC.sync.push();
    if (r.conflict) return askConflict(r.server);
    UI.toast(r.ok ? '送りました' : (r.skipped === 'offline' ? 'オフラインです。つながったら自動で送ります' : syncMsg(r)), { error: !!r.error });
    app.refresh();
  };

  A.syncPull = async () => {
    if (!HC.sync.configured()) return A.syncSetup();
    UI.toast('取り込んでいます…');
    const r = await HC.sync.pull();
    if (r.conflict) return askConflict(r.server);
    UI.toast(r.ok ? (r.empty ? 'まだ何も置かれていません' : (r.same ? '最新の状態です' : '取り込みました')) : syncMsg(r), { error: !!r.error });
    app.refresh();
  };

  /** 両方で変更があったとき、どちらを残すか選んでもらう */
  const askConflict = (server) => {
    UI.sheet({
      id: 'sync-conflict',
      center: true,
      title: '同期：どちらを残しますか',
      html: `<p class="small">別の端末（${U.esc(server.device || '不明')}）で ${U.esc(U.time(server.updated))} に保存された内容があり、この端末にも未送信の変更があります。<br>
        <b>どちらか一方だけが残ります。</b></p>
        <div class="btn-row wrap">
          <button class="btn primary" data-take-server>${U.icon('download')}向こうを取り込む</button>
          <button class="btn" data-take-local>${U.icon('upload')}こちらで上書き</button>
        </div>
        <p class="muted small">迷ったら、先に「設定 → 全データのバックアップ」で今の状態をファイルに残してから選んでください。</p>`,
      onMount: (el) => {
        U.$('[data-take-server]', el).onclick = async () => {
          UI.close('sync-conflict');
          const r = await HC.sync.takeServer();
          UI.toast(r.ok ? '向こうの内容を取り込みました' : syncMsg(r), { error: !!r.error });
          app.refresh();
        };
        U.$('[data-take-local]', el).onclick = async () => {
          UI.close('sync-conflict');
          const r = await HC.sync.overwrite();
          UI.toast(r.ok ? 'この端末の内容で上書きしました' : syncMsg(r), { error: !!r.error });
          app.refresh();
        };
      },
    });
  };

  /** 同期の設定をQRでスマホへ渡す（長いURLを打たずに済む） */
  A.syncQr = async () => {
    if (!HC.sync.configured()) return A.syncSetup();
    const packed = await U.pack(HC.sync.exportConfig());
    const url = `${appUrl()}#import=${packed}`;
    const svg = HC.qr && HC.qr.svg(url, { ecl: 'L', px: 280, quiet: 3 });
    UI.sheet({
      id: 'sync-qr',
      center: true,
      title: '同期の設定をスマホへ',
      html: `<p class="small">スマホのカメラでこのQRを読むと、同じ合言葉で同期できるようになります。</p>
        ${svg ? `<div class="qrbox">${svg}</div>` : '<p class="warn small">QRを作れませんでした</p>'}
        <p class="muted small">このQRには合言葉が入っています。人に見せないでください。</p>
        <div class="btn-row"><button class="btn" data-copy>${U.icon('link')}リンクをコピー</button></div>`,
      onMount: (el) => { U.$('[data-copy]', el).onclick = async () => UI.toast((await U.copy(url)) ? 'コピーしました' : 'コピーできませんでした'); },
    });
  };

  A.syncOff = async () => {
    if (!(await UI.confirm('同期をやめます。この端末のデータはそのまま残ります。', { ok: 'やめる', danger: true }))) return;
    S.state.sync = { ...S.state.sync, url: '', phrase: '', syncedAt: 0, dirty: false };
    S.save();
    app.refresh();
    UI.toast('同期をやめました');
  };

  // ---- お品書き画像の受け渡し（PCで入れて、スマホで受け取る）
  const shotStep = (verb) => (i, n) => { if (n) UI.toast(`画像を${verb}います… ${i}/${n}`, { ms: 120000 }); };

  A.shotsPush = async () => {
    if (!HC.sync.configured()) return A.syncSetup();
    UI.toast('サーバーの画像を確認しています…', { ms: 60000 });
    const r = await HC.sync.shotsPush(shotStep('送って'));
    if (r.error) UI.toast((r.sent ? `${r.sent}枚送ったところで止まりました：` : '送れませんでした：') + r.error, { error: true, ms: 8000 });
    else UI.toast(r.sent || r.removed ? `${r.sent}枚送りました${r.removed ? `（消した${r.removed}枚はサーバーからも削除）` : ''}。スマホで「画像を受け取る」を押してください` : '送る画像はありません（すべて送信済み）', { ms: 6000 });
    app.refresh();
  };

  A.shotsPull = async () => {
    if (!HC.sync.configured()) return A.syncSetup();
    UI.toast('サーバーの画像を確認しています…', { ms: 60000 });
    const r = await HC.sync.shotsPull(shotStep('受け取って'));
    if (r.error) UI.toast((r.got ? `${r.got}枚受け取ったところで止まりました：` : '受け取れませんでした：') + r.error, { error: true, ms: 8000 });
    else UI.toast(r.got || r.removed ? `${r.got}枚受け取りました${r.removed ? `（送り元で消えた${r.removed}枚を削除）` : ''}。圏外でも見られます` : '新しい画像はありません', { ms: 5000 });
    app.refresh();
  };

  /** 画像ファイルをサークルに入れる（貼り付け・ドロップ・ファイル選択の共通） */
  const addShotFiles = async (cid, files) => {
    const imgs = files.filter((f) => /^image\//.test(f.type || ''));
    if (!imgs.length) return UI.toast('画像ファイルではありません', { error: true });
    if (!HC.shots || !HC.shots.ready) return UI.toast('この開き方では画像を保存できません（公開URLかlocalhostで開いてください）', { error: true });
    let n = 0, err = '';
    for (const f of imgs) {
      try { await HC.shots.add(S.state.eventId, cid, f); n++; } catch (e) { err = (e && e.message) || String(e); }
    }
    if (n) {
      UI.toast(`お品書きを${n}枚 追加しました：${circleLabel(cid)}`, HC.sync.configured() ? { action: { label: 'スマホへ送る', fn: () => A.shotsPush() } } : {});
      app.refresh();
    }
    if (err) UI.toast('保存できませんでした：' + err, { error: true });
  };

  // 貼り付け（Ctrl+V）：サークル詳細を開いているとき、そのサークルに入れる
  document.addEventListener('paste', (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.items) || [])
      .filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return;   // 文字の貼り付けはそのまま
    e.preventDefault();
    if (!UI.isOpen('circle') || !app.sheetCid) return UI.toast('サークル詳細を開いた状態で貼り付けると、そのサークルのお品書きとして追加されます');
    addShotFiles(app.sheetCid, files);
  });

  // ドラッグ＆ドロップ：サークル詳細・リストの行・サークル一覧の行に落とすと、そのサークルに入れる
  const dropTarget = (el) => {
    const sheet = el.closest && el.closest('[data-sheet="circle"]');
    if (sheet) return app.sheetCid ? { el: U.$('.sheet', sheet), cid: app.sheetCid } : null;
    const row = el.closest && el.closest('.prow[data-cid], .crow');
    if (!row) return null;
    const cid = row.dataset.cid || U.$('[data-cid]', row)?.dataset.cid;
    return cid ? { el: row, cid } : null;
  };
  const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).some((t) => t === 'Files' || t === 'text/uri-list');
  let dropOn = null;
  const markDrop = (el) => {
    if (dropOn === el) return;
    if (dropOn) dropOn.classList.remove('drop-on');
    dropOn = el;
    if (el) el.classList.add('drop-on');
  };
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || e.target.closest?.('.plist.draggable .drag')) return;
    e.preventDefault();   // 落としたときにブラウザが画像を開いてしまわないように
    const t = dropTarget(e.target);
    e.dataTransfer.dropEffect = t ? 'copy' : 'none';
    markDrop(t ? t.el : null);
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) markDrop(null); });
  document.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    markDrop(null);
    const t = dropTarget(e.target);
    if (!t) return UI.toast('サークル詳細か、リスト・サークル一覧の行の上にドロップしてください');
    let files = Array.from(e.dataTransfer.files || []);
    if (!files.length) {
      // ブラウザの画像を直接ドラッグしたとき（ファイルが付いてこない）はURLから取りに行く
      const url = (e.dataTransfer.getData('text/uri-list') || '').split('\n')[0].trim();
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        if (/^image\//.test(blob.type)) files = [new File([blob], 'menu', { type: blob.type })];
      } catch (_) { /* 読めないサイト */ }
      if (!files.length) return UI.toast('この画像は直接取り込めませんでした。画像を右クリックして「画像をコピー」を選び、Ctrl+V で貼り付けてください', { ms: 6000 });
    }
    addShotFiles(t.cid, files);
  });

  U.on('sync', (m) => {
    if (m && m.shotsNew) UI.toast(`ほかの端末で追加したお品書き画像が ${m.shotsNew}枚あります`, { ms: 10000, action: { label: '受け取る', fn: () => A.shotsPull() } });
    if (m && m.conflict) askConflict(m.conflict);
    if (m && m.pulledNew) UI.toast(`別の端末${m.device ? `（${U.esc(m.device)}）` : ''}の変更を取り込みました`);
    app.dirty.add('more');
    if (app.view === 'more') renderView('more');
  });

  // ---- オフライン（会場の電波が切れても計画と記録はそのまま使える）
  const paintNet = () => {
    const on = navigator.onLine;
    document.body.classList.toggle('offline', !on);
    const el = U.$('#net-state');
    if (el) {
      el.hidden = on;
      el.innerHTML = `${U.icon('offline', 'sm')}オフライン`;
    }
  };
  app.paintNet = paintNet;
  window.addEventListener('online', () => { paintNet(); UI.toast('通信が戻りました'); app.dirty.add('more'); });
  window.addEventListener('offline', () => { paintNet(); UI.toast('オフラインになりました。計画・記録・地図はそのまま使えます', { ms: 4000 }); app.dirty.add('more'); });

  // 圏外のときは外部リンク（X・pixiv・お品書きURL）を開かずに知らせる
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[target="_blank"]');
    if (!a || navigator.onLine) return;
    e.preventDefault();
    UI.toast('オフラインのため開けません。電波が戻ってからどうぞ');
  }, true);

  /** Service Worker にオフライン準備の状態を聞く */
  const swAsk = (msg) =>
    new Promise((res) => {
      const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!sw) return res(null);
      const ch = new MessageChannel();
      const t = setTimeout(() => res(null), 4000);
      ch.port1.onmessage = (e) => { clearTimeout(t); res(e.data); };
      sw.postMessage(msg, [ch.port2]);
    });
  app.swAsk = swAsk;

  A.offlineStatus = async () => {
    const st = await swAsk('status');
    if (!st) return UI.toast('この開き方ではオフライン保存を使えません（Web公開したURLで開いてください）', { error: true });
    UI.toast(`オフライン用に ${st.files}件 保存済み（本体は${st.assets}件）`);
  };

  A.offlineRefresh = async () => {
    if (!navigator.onLine) return UI.toast('オンラインのときに実行してください', { error: true });
    UI.toast('取り込み中…');
    const r = await swAsk('refresh');
    if (!r) return UI.toast('この開き方ではオフライン保存を使えません', { error: true });
    UI.toast(r.ok ? 'オフライン用の取り込みが終わりました' : '取り込みに失敗しました：' + (r.error || ''), { error: !r.ok });
    app.dirty.add('more');
    if (app.view === 'more') app.refresh();
  };

  // ---- 当日の時計（現在時刻・経過）
  A.clockStart = () => {
    S.mutate('経過の計測開始', (d) => { d.startedAt = S.now(); });
    UI.toast('ここからの経過時間を表示します');
  };

  const askTime = async (title, cur, fallback) => {
    const v = await UI.prompt(title, { value: cur || fallback, placeholder: fallback, type: 'time' });
    if (v == null) return null;
    const t = U.toHalf(v).trim();
    if (t && !/^\d{1,2}:\d{2}$/.test(t)) { UI.toast('「12:00」のように入れてください', { error: true }); return null; }
    return t;
  };

  /** 開催日を入れる（未設定だと「今日の時間帯」として扱われるので、当日タブからも直せるように） */
  const setEventDate = async () => {
    const cur = S.eventDate();
    const v = await UI.prompt('開催日', { value: cur, type: 'date', ok: '決定' });
    if (v == null) return;
    const id = S.state.eventId;
    if (S.state.customEvents[id]) S.updateCustomEvent(id, { date: v.trim() });
    else S.mutate('開催日', (d) => { d.date = v.trim(); });
    UI.toast(v.trim() ? `開催日を ${v.trim()} にしました` : '開催日を空にしました');
  };

  A.setEventDate = () => setEventDate();

  A.clockMenu = () => {
    const T = S.times();
    const date = S.eventDate();
    UI.menu('時刻の設定', [
      { label: '開催日', icon: 'cal', hint: date ? `いま ${date}` : '未設定（今日として扱います）', act: setEventDate },
      { label: '開始（入場）の時刻', icon: 'cal', hint: T.openAt ? `いま ${T.openAt}` : '未設定', act: async () => {
        const t = await askTime('自分が入場する時刻', S.d().openAt, T.openAt || '12:00');
        if (t != null) S.mutate('開始時刻', (x) => { x.openAt = t; });
      } },
      { label: '終了の時刻', icon: 'clock', hint: T.endAt ? `いま ${T.endAt}` : '未設定', act: async () => {
        const t = await askTime('即売会が終わる時刻', S.d().endAt, T.endAt || '16:00');
        if (t != null) S.mutate('終了時刻', (x) => { x.endAt = t; });
      } },
      { label: 'いまから計り直す', icon: 'timer', hint: '開始時刻を使わず、押した時点からの経過にする', act: () => A.clockStart() },
      { label: '経過表示をやめる', icon: 'x', act: () => S.mutate('経過表示をやめる', (x) => { x.openAt = ''; x.startedAt = 0; }) },
    ]);
  };

  /** イベントのタイムテーブル（いま何が起きている時間かを出す） */
  A.schedule = () => {
    const T = S.times();
    const c = S.clock();
    const now = new Date(S.now());   // デモ中はデモの時計で「いまここ」を出す
    const hhmm = U.pad2(now.getHours()) + ':' + U.pad2(now.getMinutes());
    // 開催日が別の日なら「いまここ」は出さない（当日だけ色を付ける）
    const sameDay = !c.date || (c.state !== 'before' && c.state !== 'after') || c.days === 0;
    const rows = T.schedule.map((s, i) => {
      const next = T.schedule[i + 1];
      const current = sameDay && s.t <= hhmm && (!next || hhmm < next.t);
      return `<li class="${current ? 'on' : ''}">
        <span class="t">${U.esc(s.t)}</span>
        <span class="l"><b>${U.esc(s.label)}</b>${s.note ? `<small>${U.esc(s.note)}</small>` : ''}</span>
      </li>`;
    }).join('');
    UI.sheet({
      id: 'schedule',
      center: true,
      title: `進行表<small>${U.esc(S.ev().name)}</small>`,
      html: `<ol class="sched">${rows}</ol>
        <p class="muted small">${sameDay ? `いまの時刻（${hhmm}）の行に色が付きます。` : `開催日（${U.esc(U.md(c.base) || c.date || '')}）になると、いまの時間帯に色が付きます。`}自分の入場時刻と終了時刻は「時刻」から変えられます。</p>
        <div class="btn-row"><button class="btn" data-act="clockMenu" data-close>${U.icon('timer')}時刻の設定</button></div>`,
    });
  };

  // 1秒ごとに時計の文字だけ差し替える（当日タブを見ている間だけ動かす）
  let clockTimer = null;
  const clockTick = () => {
    const want = (app.view === 'go' || S.isDemo()) && document.visibilityState === 'visible';
    if (want && !clockTimer) {
      clockTimer = setInterval(() => { if (!V.tickClock() && !S.isDemo()) stopClock(); }, 1000);
      V.tickClock();
    } else if (!want) stopClock();
  };
  const stopClock = () => { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } };
  app.clockTick = clockTick;
  document.addEventListener('visibilitychange', clockTick);

  // ---- お品書き画像（IndexedDB 保存。store を通さないので undo の対象外）
  const pickImages = () =>
    new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.multiple = true;
      inp.className = 'hidden-file';
      document.body.appendChild(inp);
      inp.onchange = () => { res(Array.from(inp.files || [])); inp.remove(); };
      inp.oncancel = () => { res([]); inp.remove(); };
      inp.click();
    });

  A.addShot = async (ds) => {
    const files = await pickImages();
    if (files.length) addShotFiles(ds.cid, files);
  };

  A.viewShot = async (ds) => {
    const url = await HC.shots.url(ds.id);
    if (!url) return UI.toast('画像が見つかりません', { error: true });
    const m = HC.shots.meta(ds.id);
    UI.sheet({
      id: 'shot',
      center: true,
      cls: 'shot-sheet',
      title: `お品書き${m ? `<small>${U.esc(circleLabel(m.cid))}</small>` : ''}`,
      html: `<div class="shot-full"><img src="${url}" alt="お品書き"></div>
        <div class="btn-row"><button class="btn ghost" data-close>閉じる</button><button class="btn danger ghost" data-del>${U.icon('trash')}削除</button></div>`,
      onMount: (el) => {
        U.$('[data-del]', el).onclick = async () => {
          if (!(await UI.confirm('この画像を削除しますか？', { ok: '削除', danger: true }))) return;
          await HC.shots.remove(ds.id);
          UI.close('shot');
          UI.toast('削除しました');
          app.refresh();
        };
      },
      onClose: () => URL.revokeObjectURL(url),
    });
  };

  A.clearShots = async () => {
    const u = HC.shots.usage(S.state.eventId);
    if (!u.n) return;
    if (!(await UI.confirm(`このイベントのお品書き画像 ${u.n}枚 をすべて削除します。元に戻せません。`, { ok: '削除', danger: true }))) return;
    await HC.shots.clear(S.state.eventId);
    UI.toast('削除しました');
    app.refresh();
  };

  const routeLabel = { must: '必須→残り', tier: '優先度順', short: '最短のみ' };
  A.routeMenu = () => {
    const mode = S.state.settings.routeMode;
    UI.menu('ルート作成（未完了分を並べ替え）', [
      ...['must', 'tier', 'short'].map((m) => ({
        label: `${routeLabel[m]}${m === 'must' ? '（おすすめ）' : ''}`, icon: 'route', active: m === mode,
        hint: { must: '必須を先に回り切る', tier: '必須→優先→通常→余裕', short: '優先度を無視して最短' }[m],
        act: () => { S.setSetting('routeMode', m); runRoute(m, false); },
      })),
      { label: '最後に回った場所から組み直す', icon: 'target', hint: '当日の途中で', act: () => runRoute(mode, true) },
      { label: 'スペース番号順に並べる', icon: 'list', act: () => sortBySpace() },
    ]);
  };
  const runRoute = (mode, fromCurrent) => {
    S.optimize(mode, fromCurrent);
    UI.toast(`ルートを作りました（${routeLabel[mode]}）`, { undo: true, action: { label: '地図で見る', fn: () => app.show('map') } });
  };
  const sortBySpace = () => S.mutate('スペース順', (d) => {
    const circ = (cid) => S.circle(cid) || { block: 'Z', nums: [0] };
    const active = d.order.filter((cid) => ['todo', 'later'].includes(d.entries[cid]?.status));
    const fixed = d.order.filter((cid) => !active.includes(cid));
    active.sort((a, b) => { const x = circ(a), y = circ(b); return x.block === y.block ? x.nums[0] - y.nums[0] : x.block < y.block ? -1 : 1; });
    d.order = [...fixed, ...active];
    d.routedAt = Date.now();
  });
  A.reroute = () => runRoute(S.state.settings.routeMode, true);

  A.cfilter = (ds) => {
    V.circles.f = V.circles.f === ds.f && ds.f !== 'all' ? 'all' : ds.f;
    V.circles.renderFilters();
    V.circles.renderList();
    window.scrollTo(0, 0);
  };
  A.clearSearch = () => {
    V.circles.q = '';
    const inp = U.$('#csearch');
    inp.value = '';
    V.circles.renderList();
    inp.focus();
  };
  /** まとめカード（お品書き待ち・画像なし）の「残りも表示」「たたむ」。カードの中で広げる */
  A.chipMore = (ds) => {
    V.chipOpen[ds.k] = !V.chipOpen[ds.k];
    renderView('list');
    if (!V.chipOpen[ds.k]) U.$('#sec-' + ds.k)?.scrollIntoView({ block: 'nearest' });   // たたんだら、カードが見える位置に戻す
  };
  A.listFilter = (ds) => { V.list.filter = ds.f; renderView('list'); };

  A.mapNext = () => {
    const cur = S.queue().current;
    if (!cur) return UI.toast('次の目的地はありません');
    const inst = ensureMap();
    V.map.select(cur);
    inst.focus(cur);
    setTimeout(() => inst.flash(cur), 300);
  };
  A.mapZoom = (ds) => ensureMap()?.zoomBy(+ds.k);
  A.mapFit = () => ensureMap()?.fit();
  /** 地図を「区間ごと」に見る／やめる */
  A.mapSeg = () => {
    const inst = ensureMap();
    if (!inst) return;
    if (inst.segIndex != null) return A.mapSegOff();
    const legs = inst.legs();
    if (!legs.length) return UI.toast('まだ回る先がありません');
    // いま向かう区間から始める
    inst.showLeg(0);
    V.mapSeg();
    UI.toast('区間ごとの表示にしました（上下のボタンで送れます）');
  };

  A.mapSegMove = (ds) => {
    const inst = ensureMap();
    if (!inst || inst.segIndex == null) return;
    const legs = inst.legs();
    const next = U.clamp(inst.segIndex + (+ds.d || 1), 0, legs.length - 1);
    if (next === inst.segIndex) return;
    inst.showLeg(next);
    V.mapSeg();
    U.vibrate(10);
  };

  A.mapSegOff = () => {
    const inst = ensureMap();
    if (!inst) return;
    app.legFor = S.queue().current;   // 全体に戻したら、次の目的地が変わるまで区間表示に戻さない
    inst.clearLeg();
    V.mapSeg();
  };

  A.mapRoute = () => {
    S.setSetting('showRoute', !S.state.settings.showRoute);
    renderView('map');
    UI.toast(S.state.settings.showRoute ? 'ルート線を表示しました' : 'ルート線を非表示にしました（もう一度押すと表示）');
  };
  A.mapImage = () => {
    S.setSetting('mapMode', S.state.settings.mapMode === 'image' ? 'simple' : 'image');
    const inst = ensureMap();
    const vb = inst && inst.vb && { ...inst.vb };
    inst.build();
    if (vb) inst.setVB(vb);
    renderView('map');
    UI.toast(S.state.settings.mapMode === 'image' ? '公式の配置図に重ねました' : 'シンプルな地図に戻しました');
  };
  A.mapClose = () => V.map.select(null);

  A.setting = (ds) => {
    let v = ds.v;
    if (ds.k === 'font') v = parseFloat(v);
    S.setSetting(ds.k, v);
    if (ds.k === 'mapOrient' && V.map.inst) V.map.inst.build();
    applyLook();
    renderView('more');
  };

  // ---- 当日モード・デモ
  /** 当日モードで地図を開いたら、いま向かう区間だけを大きく出す（次の目的地が変わるたびに1回） */
  const autoLeg = (force) => {
    if (!S.state.settings.dayMode) return;
    const cur = S.queue().current;
    if (!cur || (!force && app.legFor === cur)) return;
    const go = (n = 0) => {
      const inst = ensureMap();
      if (!inst || !inst.L) { if (n < 40) setTimeout(() => go(n + 1), 50); return; }
      const legs = inst.legs();
      const i = legs.findIndex((l) => l.cid === cur);
      if (i < 0) return;
      app.legFor = cur;
      inst.showLeg(i);
      V.mapSeg();
    };
    requestAnimationFrame(() => go());
  };

  A.dayMap = () => { app.show('map', { noLeg: true }); autoLeg(true); };
  A.dayAll = () => { V.day.allOpen = !V.day.allOpen; renderView('go'); };

  const setDay = (on) => {
    S.setSetting('dayMode', on);
    applyLook();
    VIEWS.forEach((v) => app.dirty.add(v));
    app.show(on ? 'go' : (app.view === 'log' ? 'go' : app.view));
    renderView(app.view);
    updateWake();
  };
  A.dayOn = () => {
    setDay(true);
    UI.toast('当日モードにしました。通常の画面に戻すときは「メニュー」の「当日モードを終える」を押してください', { ms: 5000 });
  };
  A.dayOff = async () => {
    if (S.isDemo()) {
      if (!(await UI.confirm('デモ中です。当日モードを終えると、デモも終了して記録が元に戻ります。', { ok: '終える' }))) return;
      S.endDemo();
    }
    setDay(false);
    UI.toast('通常の画面に戻しました');
  };
  A.fullSettings = () => { V.more.full = true; renderView('more'); window.scrollTo(0, 0); };
  A.fullSettingsOff = () => { V.more.full = false; renderView('more'); window.scrollTo(0, 0); };

  A.demoStart = async () => {
    if (S.isDemo()) return UI.toast('すでにデモ中です');
    if (!Object.keys(S.d().entries).length) return UI.toast('先に計画を作ってください', { error: true });
    const today = U.today();
    const warn = S.eventDate() === today ? '\n\n今日は開催日です。本番の記録を付ける前に、必ずデモを終了してください。' : '';
    if (!(await UI.confirm(`いまの計画のまま、本番どおりに操作を試します。\n・時計は開催日の開始時刻から進みます（「+10分」で早送り）\n・デモ中に付けた記録や財布の変化は、終了すると元に戻ります\n・デモ中は同期を止めます${warn}`, { ok: 'デモを始める', title: 'デモで練習' }))) return;
    S.startDemo();
    applyLook();
    V.demoBar();
    VIEWS.forEach((v) => app.dirty.add(v));
    app.show('go');
    app.clockTick();
    updateWake();
    UI.toast('デモを始めました。上の帯の「終了」で元に戻ります', { ms: 5000 });
  };
  A.demoEnd = async () => {
    if (!S.isDemo()) return;
    if (!(await UI.confirm('デモを終了して、始める前の計画と財布に戻します。デモで付けた記録は消えます。', { ok: '終了する' }))) return;
    S.endDemo();
    applyLook();
    V.demoBar();
    VIEWS.forEach((v) => app.dirty.add(v));
    app.show(S.state.settings.dayMode ? 'go' : 'go');
    app.clockTick();
    UI.toast('デモを終了して、元の状態に戻しました');
    // 止めていたあいだに溜まった変更があれば送る
    if (HC.sync.configured() && S.state.sync.dirty) HC.sync.push().catch(() => {});
  };
  A.demoRestart = async () => {
    if (!S.isDemo()) return;
    if (!(await UI.confirm('デモの記録を消して、開始時刻からやり直します。', { ok: 'やり直す' }))) return;
    S.endDemo();
    S.startDemo();
    applyLook();
    V.demoBar();
    app.show('go');
    UI.toast('最初からやり直します');
  };
  A.demoFwd = (ds) => {
    S.demoForward((+ds.m || 10) * 60000);
    V.tickClock();
    UI.toast(`時計を${+ds.m >= 60 ? (+ds.m / 60) + '時間' : (+ds.m || 10) + '分'}進めました（${U.time(S.now())}）`);
  };

  /** 当日カードのお品書きは、まずサムネで描いてから本体の画像に差し替える（大きく出してもぼやけないように） */
  const shotUrls = new Map();
  const hydrateShots = (el) => {
    if (!HC.shots || !HC.shots.ready) return;
    U.$$('img[data-shot]', el).forEach(async (img) => {
      const id = img.dataset.shot;
      let url = shotUrls.get(id);
      if (!url) {
        url = await HC.shots.url(id).catch(() => null);
        if (!url) return;
        shotUrls.set(id, url);
      }
      if (img.isConnected) img.src = url;
    });
  };

  /** 開催日に開いたら当日モードを勧める（1日1回）。デモが残っていたら終了を勧める */
  const dayPrompt = async () => {
    const today = U.today();
    if (S.eventDate() !== today || !Object.keys(S.d().entries).length) return;
    if (S.isDemo()) {
      if (await UI.confirm('デモが続いています。今日は開催日なので、デモを終了して本番の状態に戻しますか？', { ok: 'デモを終了する', title: '本番の前に' })) {
        S.endDemo();
        applyLook();
        V.demoBar();
        VIEWS.forEach((v) => app.dirty.add(v));
        app.show('go');
        UI.toast('デモを終了しました');
      }
      return;
    }
    let asked = '';
    try { asked = localStorage.getItem('kurunavi.dayAsk') || ''; } catch (_) { /* noop */ }
    if (S.state.settings.dayMode || asked === today) return;
    try { localStorage.setItem('kurunavi.dayAsk', today); } catch (_) { /* noop */ }
    if (await UI.confirm('今日は開催日です。当日モード（文字とボタンが大きく、当日に使う画面だけ）にしますか？', { ok: '当日モードにする', cancel: 'このまま', title: '当日モード' })) A.dayOn();
  };

  // ---- 財布（金種）
  /** 金種の表をシートで開く（当日タブから。設定タブには直接埋めてある） */
  A.wallet = () => {
    UI.sheet({
      id: 'wallet',
      center: true,
      title: '財布の中身',
      html: `${V.cashEditor()}<div class="btn-row"><button class="btn block" data-close>閉じる</button></div>`,
    });
  };

  /**
   * 金種の欄は、押すたび・打つたびに画面を作り直さない。
   * 作り直すと次に押そうとした＋ボタンや入力欄が一瞬で消えて、タップが空振りするため、
   * 変わるところ（枚数・小計・合計・財布の現金）だけ書き換える
   */
  const paintDenoms = () => {
    const d = S.d();
    const br = d.cashBreak || {};
    U.$$('.den-row').forEach((row) => {
      const inp = U.$('[data-f="denom"]', row);
      if (!inp) return;
      const den = +inp.dataset.d;
      const n = br[den] || 0;
      if (document.activeElement !== inp) inp.value = n || '';
      row.classList.toggle('has', !!n);
      const sum = U.$('.den-sum', row);
      if (sum) sum.textContent = n ? U.yen(den * n) : '';
    });
    const count = S.cashCount();
    U.$$('.den-foot').forEach((foot) => {
      const b = U.$('b', foot);
      if (b) b.textContent = U.yen(S.cashTotal());
      const c = U.$('.muted', foot);
      if (c) c.textContent = count + '枚';
      const clear = U.$('[data-act="cashClear"]', foot);
      if (clear) clear.hidden = !count;
    });
    // 予算欄の「持っていく現金」と、当日タブの金種ボタン
    const cash = U.$('[data-f="cash"]');
    if (cash) {
      cash.value = d.cash || '';
      cash.readOnly = count > 0;
      const note = cash.closest('.field') && U.$('span small', cash.closest('.field'));
      if (note) note.textContent = count > 0 ? '下の金種から計算' : '任意';
    }
    const cashLeft = U.$('.w-cash');
    if (cashLeft) {
      const st = S.stats();
      cashLeft.textContent = U.yen(st.cashLeft);
      cashLeft.classList.toggle('neg', st.cashLeft < 0);
    }
    const btn = U.$('.w-wallet');
    if (btn) btn.innerHTML = `${U.icon('wallet', 'sm')}${count ? `金種 ${count}枚` : '金種を登録'}`;
  };
  app.paintDenoms = paintDenoms;

  A.denomStep = (ds) => {
    const den = Number(ds.d);
    const now = (S.d().cashBreak || {})[den] || 0;
    app.noRender = true;
    try { S.setCashBreak(den, now + Number(ds.n)); } finally { app.noRender = false; }
    U.vibrate(6);
    paintDenoms();
  };

  A.cashClear = async () => {
    if (!(await UI.confirm('財布の金種の枚数を全部消しますか？', { ok: '消す' }))) return;
    S.clearCashBreak();
    UI.toast('消しました', { undo: true });
  };

  A.budgetEdit = () => {
    const d = S.d();
    const id = 'budget';
    UI.sheet({
      id,
      center: true,
      title: '予算の設定',
      html: `<div class="grid1">
        <label class="field"><span>予算（総額）</span><div class="yen-input"><span>¥</span><input class="input" inputmode="numeric" name="budget" value="${d.budget || ''}" placeholder="30000"></div></label>
        <label class="field"><span>別枠（交通・食費など、予算から除く）</span><div class="yen-input"><span>¥</span><input class="input" inputmode="numeric" name="reserve" value="${d.reserve || ''}" placeholder="0"></div></label>
        <label class="field"><span>持っていく現金${S.hasCashBreak() ? `（下の「金種」から計算）` : `（任意・財布の残りを表示）`}</span><div class="yen-input"><span>¥</span><input class="input" inputmode="numeric" name="cash" value="${d.cash || ''}" placeholder="0" ${S.hasCashBreak() ? 'readonly' : ''}></div></label>
        <button class="btn ghost block" data-wallet>${U.icon('wallet')}財布の中身（金種ごとの枚数）</button>
        <button class="btn primary block" data-ok>保存</button></div>`,
      onMount: (el) => {
        setTimeout(() => U.$('input', el).focus(), 60);
        U.$('[data-wallet]', el).onclick = () => { UI.close(id); A.wallet(); };
        U.$('[data-ok]', el).onclick = () => {
          const v = (n) => U.parseYen(U.$(`[name="${n}"]`, el).value);
          S.mutate('予算変更', (dd) => { dd.budget = v('budget'); dd.reserve = v('reserve'); dd.cash = v('cash'); });
          UI.close(id);
          UI.toast('予算を保存しました', { undo: true });
        };
      },
    });
  };

  // ---- イベント作成・編集
  const eventForm = (ev, custom) => {
    const layouts = (HC.bundled || []).filter((b) => b.layout);
    const cur = custom ? custom.layoutFrom : layouts[0]?.id;
    return `<div class="grid1 evform">
      <label class="field"><span>イベント名</span><input class="input" name="name" value="${U.esc(custom ? custom.name : '')}" placeholder="例：ホロクル13th"></label>
      <div class="grid2">
        <label class="field"><span>略称（タブ表示用）</span><input class="input" name="short" value="${U.esc(custom ? custom.short : '')}" placeholder="例：13th"></label>
        <label class="field"><span>開催日</span><input class="input" type="date" name="date" value="${U.esc(custom ? custom.date : '')}"></label>
      </div>
      <label class="field"><span>サークル一覧 ${custom ? '<small>（貼り直すと差し替え。計画はスペースが同じなら残ります）</small>' : '<small>（公式サイトの一覧をまるごとコピーして貼り付け）</small>'}</span>
        <textarea class="input mono" name="text" rows="7" placeholder="* A&#10;01-02&#10;サークル名&#10;[Twitter](https://twitter.com/...)&#10;…&#10;&#10;または 1行1サークル：G23 サークル名 @xxxx"></textarea>
        <small class="parse-result muted">${custom ? '（空欄なら現在の一覧のまま）' : '貼り付けると件数を表示します'}</small></label>
      <div class="field"><span>配置図（地図）</span>
        <select class="input" name="layoutFrom">
          ${layouts.map((b) => `<option value="${b.id}" ${cur === b.id ? 'selected' : ''}>${U.esc(b.name)} の配置図を流用（同じ会場・同じ配置のとき）</option>`).join('')}
          <option value="" ${custom && !custom.layoutFrom ? 'selected' : ''}>簡易マップを自動生成（ブロックごとの縦並び）</option>
        </select>
        <small class="muted">正確な配置図は data/ にレイアウトを追加すると使えます（CLAUDE.md 参照）</small>
      </div>
      ${custom ? '' : `<label class="toggle-row"><span>予算設定を「${U.esc(ev.name)}」から引き継ぐ</span><input type="checkbox" name="copyBudget" checked><i></i></label>`}
      <button class="btn primary block lg" data-ok>${custom ? '保存' : '作成する'}</button>
      ${custom ? '<button class="btn danger ghost block" data-del>このイベントを削除</button>' : ''}
    </div>`;
  };

  const bindEventForm = (el, onSubmit) => {
    const ta = U.$('[name="text"]', el);
    const res = U.$('.parse-result', el);
    ta.addEventListener('input', U.debounce(() => {
      if (!ta.value.trim()) { res.textContent = ''; return; }
      const list = P.parseCircleList(ta.value);
      const sm = P.summary(list);
      res.textContent = `読み取り：${sm.count}サークル（${Object.entries(sm.blocks).map(([b, n]) => `${b}:${n}`).join(' ')}）`;
      res.classList.toggle('bad', !sm.count);
    }, 200));
    U.$('[data-ok]', el).onclick = () => onSubmit({
      name: U.$('[name="name"]', el).value.trim(),
      short: U.$('[name="short"]', el).value.trim(),
      date: U.$('[name="date"]', el).value,
      text: ta.value,
      layoutFrom: U.$('[name="layoutFrom"]', el).value,
      copyBudget: U.$('[name="copyBudget"]', el)?.checked,
    });
  };

  A.newEvent = () => {
    const ev = S.ev();
    UI.sheet({
      id: 'newevent',
      title: '新しいイベントを作る',
      html: eventForm(ev, null),
      onMount: (el) => bindEventForm(el, (f) => {
        if (!f.name) return UI.toast('イベント名を入力してください', { error: true });
        const list = P.parseCircleList(f.text);
        if (!list.length) return UI.toast('サークル一覧を読み取れませんでした。貼り付けた内容を確かめてください', { error: true });
        const prev = S.state.eventId;
        const r = S.createEvent({ ...f, copyBudgetFrom: f.copyBudget ? prev : null });
        UI.close('newevent');
        UI.toast(`${f.name} を作成しました（${r.count}サークル）`);
        app.show('circles');
      }),
    });
  };

  A.editEvent = () => {
    const id = S.state.eventId;
    const custom = S.state.customEvents[id];
    if (!custom) return;
    UI.sheet({
      id: 'editevent',
      title: 'イベントを編集',
      html: eventForm(S.ev(), custom),
      onMount: (el) => {
        bindEventForm(el, (f) => {
          const patch = { name: f.name || custom.name, short: f.short || f.name || custom.short, date: f.date, layoutFrom: f.layoutFrom };
          if (f.text.trim()) {
            const list = P.parseCircleList(f.text);
            if (!list.length) return UI.toast('サークル一覧を読み取れませんでした', { error: true });
            patch.circles = P.toCompact(list);
          }
          S.updateCustomEvent(id, patch);
          if (V.map.inst) V.map.inst.build();
          UI.close('editevent');
          UI.toast('保存しました');
        });
        U.$('[data-del]', el).onclick = async () => {
          if (!(await UI.confirm(`「${custom.name}」と、その計画・記録をすべて削除します。元に戻せません。`, { ok: '削除', danger: true }))) return;
          UI.close('editevent');
          if (HC.shots && HC.shots.ready) await HC.shots.clear(id).catch(() => {});
          S.deleteEvent(id);
          UI.toast('削除しました');
        };
      },
    });
  };

  A.addCircleManual = (ds) => {
    UI.sheet({
      id: 'addcircle',
      center: true,
      title: 'サークルを手動追加',
      html: `<div class="grid1">
        <label class="field"><span>スペース</span><input class="input" name="space" placeholder="例：Q39 / A45-46" autocapitalize="characters"></label>
        <label class="field"><span>サークル名</span><input class="input" name="name" value="${U.esc(ds.name || '')}"></label>
        <label class="field"><span>X(Twitter) ID <small>任意</small></span><input class="input" name="tw" placeholder="@xxxx"></label>
        <button class="btn primary block" data-ok>追加して計画に入れる</button></div>`,
      onMount: (el) => {
        setTimeout(() => U.$('[name="space"]', el).focus(), 60);
        U.$('[data-ok]', el).onclick = () => {
          const r = S.addCircle({ space: U.$('[name="space"]', el).value, name: U.$('[name="name"]', el).value.trim(), tw: U.$('[name="tw"]', el).value });
          if (r.error) return UI.toast(r.error, { error: true });
          UI.close('addcircle');
          S.addToPlan(r.circle.id, 3);
          UI.toast(`追加しました：${r.circle.space} ${r.circle.name}`, { undo: true });
          setTimeout(() => openCircle(r.circle.id), 250);
        };
      },
    });
  };

  // ---- データ入出力
  const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}${U.pad2(d.getMonth() + 1)}${U.pad2(d.getDate())}-${U.pad2(d.getHours())}${U.pad2(d.getMinutes())}`;
  };
  const appUrl = () => location.href.split('#')[0];

  /** デモ中は計画の受け渡しをしない（デモの記録が混ざる／終了時に読み込んだ計画が消えるため） */
  const demoBlock = () => { if (!S.isDemo()) return false; UI.toast('デモ中はできません。デモを終了してから行ってください', { error: true }); return true; };

  A.shareLink = async () => {
    if (demoBlock()) return;
    const packed = await U.pack(S.exportPlan(S.state.eventId, { slim: true }));
    const url = `${appUrl()}#import=${packed}`;
    const isFile = location.protocol === 'file:';
    // QR はスマホのカメラで読む前提。長すぎて入らない場合はリンク／ファイルに誘導する
    const svg = isFile ? null : HC.qr && HC.qr.svg(url, { ecl: 'L', px: 280, quiet: 3 });
    UI.sheet({
      id: 'share',
      center: true,
      title: '共有リンク',
      html: `<p class="small">スマホのカメラでこのQRを読み取ると、今の計画（${Object.keys(S.d().entries).length}サークル）が開きます。</p>
        ${isFile ? `<p class="warn small">${U.icon('warn', 'sm')} いまPC内のファイルとして開いているため、このリンクはスマホで開けません（QRも出せません）。アプリをWeb公開（README参照）してから使うか、「計画をファイルに書き出し」で送ってください。</p>` : ''}
        ${svg ? `<div class="qrbox">${svg}</div>` : (isFile ? '' : `<p class="warn small">${U.icon('warn', 'sm')} 計画が大きくQRコードに入りきりませんでした。リンクをコピーして送るか、ファイルで受け渡してください。</p>`)}
        <details class="mt"><summary class="small">リンクを直接コピーする（${U.num(url.length)}文字）</summary>
          <textarea class="input mono" rows="4" readonly>${U.esc(url)}</textarea></details>
        <div class="btn-row"><button class="btn primary" data-copy>${U.icon('link')}コピー</button>${navigator.share ? `<button class="btn" data-share>${U.icon('share')}共有…</button>` : ''}</div>`,
      onMount: (el) => {
        U.$('[data-copy]', el).onclick = async () => UI.toast((await U.copy(url)) ? 'コピーしました' : 'コピーできませんでした。テキストを長押しでコピーしてください');
        const sh = U.$('[data-share]', el);
        if (sh) sh.onclick = () => navigator.share({ title: 'クルナビの計画', url }).catch(() => {});
      },
    });
  };

  A.exportPlan = () => {
    if (demoBlock()) return;
    const ev = S.ev();
    U.download(`kurunavi_${ev.short}_${stamp()}.json`, JSON.stringify(S.exportPlan()));
    UI.toast('書き出しました');
  };
  A.exportAll = () => {
    if (demoBlock()) return;
    U.download(`kurunavi_backup_${stamp()}.json`, JSON.stringify(S.exportAll()));
    UI.toast('全データを書き出しました');
  };
  A.exportCsv = () => {
    U.download(`kurunavi_${S.ev().short}_${stamp()}.csv`, S.csv(), 'text/csv');
  };

  const importObj = async (obj) => {
    if (demoBlock()) return;
    // 同期の設定（QRで渡されたもの）は、読み込んだらそのまま取り込みに行く
    if (obj && obj.kind === 'sync') {
      if (!(await UI.confirm('同期の設定を受け取りました。この端末でも同じ合言葉で同期しますか？', { ok: '設定する' }))) return;
      try {
        HC.sync.importConfig(obj);
        UI.toast('設定しました。取り込んでいます…');
        const r = await HC.sync.pull({ force: true });
        if (r.ok && r.empty && Object.keys(S.d().entries).length) {
          // 保管場所が空なら、この端末の内容で始める
          const p = await HC.sync.push({ force: true });
          UI.toast(p.ok ? 'この端末の内容で同期を始めました' : ('送れませんでした：' + (p.error || '')), { error: !p.ok });
        } else {
          UI.toast(r.ok ? (r.empty ? '同期の準備ができました（まだデータはありません）' : '取り込みました') : ('取り込めませんでした：' + (r.error || '')), { error: !!r.error });
        }
        app.refresh();
      } catch (e) {
        UI.toast(e.message, { error: true });
      }
      return;
    }
    const what = obj.kind === 'backup' ? '全データ（すべてのイベント）' : `計画（${Object.keys(obj.data?.entries || {}).length}サークル）`;
    if (!(await UI.confirm(`${what}を読み込みます。この端末の${obj.kind === 'backup' ? '全データ' : '同じイベントの計画'}は上書きされます。\n（読み込み前の状態は「読み込み前の状態に戻す」で復元できます）`, { ok: '読み込む' }))) return;
    try {
      const msg = S.importObject(obj);
      UI.toast(msg);
      app.show('go');
    } catch (e) {
      UI.toast(e.message, { error: true });
    }
  };

  A.importFile = async () => {
    const f = await U.pickFile();
    if (!f) return;
    try {
      await importObj(JSON.parse(await U.readFile(f)));
    } catch (e) {
      UI.toast('ファイルを読み込めませんでした', { error: true });
    }
  };

  A.importText = async () => {
    const t = await UI.prompt('共有リンク または 書き出したJSONを貼り付け', { multiline: true, ok: '読み込む' });
    if (!t) return;
    try {
      const m = t.match(/#import=([A-Za-z0-9_-]+)/);
      const obj = m ? await U.unpack(m[1]) : JSON.parse(t);
      await importObj(obj);
    } catch (e) {
      UI.toast('読み込めませんでした。内容を確認してください', { error: true });
    }
  };

  A.restoreBackup = async () => {
    const t = S.backupTime();
    if (!t) return UI.toast('戻せる状態がありません');
    if (!(await UI.confirm(`${U.date(t)} ${U.time(t)}（最後に読み込みをする直前）の状態に戻します。`, { ok: '戻す' }))) return;
    S.restoreBackup();
    UI.toast('戻しました');
  };

  A.resetDay = async () => {
    if (!(await UI.confirm('購入済・売切などの当日記録をすべて未購入に戻します（計画・予算はそのまま）。', { ok: 'リセット', danger: true }))) return;
    S.resetDay();
    UI.toast('当日記録をリセットしました', { undo: true });
  };
  A.clearPlan = async () => {
    if (!(await UI.confirm(`「${S.ev().name}」の計画と記録をすべて消去します。`, { ok: '全消去', danger: true }))) return;
    S.clearEventData();
    UI.toast('消去しました', { undo: true });
  };

  // ------------------------------------------------------------------ イベント配線
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    // 切り替わった直後の当日カードは押しても反応させない（CSS でも止めているが、念のため）
    if (app.curGuard && Date.now() < app.curGuard && el.closest('.card.cur')) { e.preventDefault(); return; }
    const fn = A[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn({ ...el.dataset }, el, e);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.f;
    if (!f) return;
    const ds = el.dataset;
    app.quiet = !!el.closest('[data-sheet="circle"]');
    app.noRender = f === 'denom';   // 金種は打つたびに画面を作り直さない（次のタップが空振りするため）
    try { onFieldChange(f, el, ds); } finally { app.quiet = false; app.noRender = false; }
  });

  const onFieldChange = (f, el, ds) => {
    switch (f) {
      case 'iname':
        S.mutate(null, (d) => { const it = d.entries[ds.cid]?.items.find((i) => i.id === ds.iid); if (it) it.name = el.value.trim(); });
        break;
      case 'iprice':
        S.mutate('価格変更', (d) => { const it = d.entries[ds.cid]?.items.find((i) => i.id === ds.iid); if (it) it.price = U.parseYen(el.value); });
        break;
      case 'memo':
      case 'menu':
        S.mutate(null, (d) => { if (d.entries[ds.cid]) d.entries[ds.cid][f] = el.value.trim(); });
        break;
      case 'denom':
        S.setCashBreak(Number(ds.d), U.parseYen(el.value));
        paintDenoms();
        break;
      case 'budget':
      case 'reserve':
      case 'cash':
        S.mutate('予算変更', (d) => { d[f] = U.parseYen(el.value); });
        break;
      case 'start':
        S.mutate(null, (d) => { d.start = el.value; });
        V.map.inst && V.map.inst.paint();
        break;
      case 'startSid': {
        const sq = P.parseSpaceQuery(el.value);
        const L = S.ev().layout;
        if (sq && L.bySid.get(sq.block + sq.num)) {
          S.mutate(null, (d) => { d.start = sq.block + sq.num; });
          UI.toast(`スタート地点を ${sq.block}${U.pad2(sq.num)} の前にしました`);
        } else if (el.value.trim()) UI.toast('そのスペースは地図にありません', { error: true });
        break;
      }
      case 'evdate': {
        const id = S.state.eventId;
        if (S.state.customEvents[id]) S.updateCustomEvent(id, { date: el.value });
        else S.mutate(null, (d) => { d.date = el.value; });
        break;
      }
      case 'openAt':
        S.mutate(null, (d) => { d.openAt = el.value; });
        break;
      case 'endAt':
        S.mutate(null, (d) => { d.endAt = el.value; });
        break;
      case 'syncAuto':
        S.state.sync.auto = el.checked;
        S.save();
        if (el.checked && S.state.sync.dirty) A.syncNow();
        break;
      case 'setting':
        S.setSetting(ds.k, el.checked);
        updateWake();
        break;
      default:
    }
  };

  // 一覧の「＋」は長押し（PCは右クリック）で優先度を選んで追加できる
  let pressTimer = null, pressed = null;
  const openPriPick = (cid) => {
    if (!cid) return;
    const planned = S.isPlanned(cid);
    UI.menu(circleLabel(cid), [1, 2, 3, 4].map((p) => ({
      label: `${S.PRI[p].label}で${planned ? '変更' : '追加'}`,
      hint: ['絶対に買う', 'できれば買う', '余裕があれば', '見るだけ・予備'][p - 1],
      icon: 'star',
      act: () => (planned ? A.setPri({ cid, pri: p }) : A.addPlan({ cid, pri: p })),
    })).concat([{ label: '詳細を開く', icon: 'edit', act: () => openCircle(cid) }]));
  };
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.add-btn[data-cid]');
    if (!b) return;
    pressed = b.dataset.cid;
    pressTimer = setTimeout(() => { pressTimer = null; U.vibrate(20); openPriPick(pressed); pressed = null; }, 450);
  });
  const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
  ['pointerup', 'pointercancel', 'pointermove', 'scroll'].forEach((ev) => document.addEventListener(ev, cancelPress, true));
  document.addEventListener('contextmenu', (e) => {
    const b = e.target.closest && e.target.closest('.add-btn[data-cid]');
    if (!b) return;
    e.preventDefault();
    openPriPick(b.dataset.cid);
  });

  // 当日までの準備欄の開け閉めを覚えておく
  document.addEventListener('toggle', (e) => {
    if (e.target && e.target.id === 'sec-prep') V.prepOpen = e.target.open;
  }, true);

  // 横スクロールする帯は、マウスホイールでも横に動かせるようにする
  document.addEventListener('wheel', (e) => {
    const box = e.target.closest && e.target.closest('.chips.scroll, .seg.sm, .ed-tools');
    if (!box || box.scrollWidth <= box.clientWidth + 2) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    box.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // Enterで次の入力へ（アイテム編集を連続で打てるように）
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Enter' && t.matches && t.matches('.ie-row input')) {
      e.preventDefault();
      const inputs = U.$$('.ie-row input, .sheet textarea[data-f="memo"]');
      const i = inputs.indexOf(t);
      (inputs[i + 1] || t).focus();
      if (!inputs[i + 1]) t.blur();
      return;
    }
    if (t.matches && t.matches('input,textarea,select')) return;
    if (e.key === '/' && !e.ctrlKey) {
      e.preventDefault();
      app.show('circles');
      setTimeout(() => U.$('#csearch')?.focus(), 30);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      const l = S.undo();
      UI.toast(l ? `「${l}」を取り消しました` : '取り消せる操作はありません');
    }
  });

  // リストのドラッグ並べ替え（マウス・タッチ共通）
  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.plist.draggable .drag');
    if (!h) return;
    e.preventDefault();
    const row = h.closest('.prow');
    const list = row.parentElement;
    const before = [...list.children].map((x) => x.dataset.cid).join(',');
    row.classList.add('dragging');
    try { h.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等 */ }
    let scrollTimer = null;
    let lastY = e.clientY;
    const place = () => {
      const sibs = [...list.children].filter((x) => x !== row);
      let ref = null;
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        if (lastY < r.top + r.height / 2) { ref = s; break; }
      }
      if (ref !== row.nextElementSibling) list.insertBefore(row, ref);
    };
    const move = (ev) => {
      lastY = ev.clientY;
      place();
      clearInterval(scrollTimer);
      const edge = 90;
      const dir = lastY < edge + 56 ? -1 : lastY > innerHeight - edge - 64 ? 1 : 0;
      if (dir) scrollTimer = setInterval(() => { window.scrollBy(0, dir * 12); place(); }, 16);
    };
    const up = () => {
      clearInterval(scrollTimer);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      const ids = [...list.children].map((x) => x.dataset.cid);
      if (ids.join(',') !== before) { S.reorder(ids); U.vibrate(); UI.toast('並べ替えました', { undo: true }); }
    };
    // キャプチャ中でも document に届くので document で受ける
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });

  // ------------------------------------------------------------------ 起動
  const boot = async () => {
    S.load();
    await HC.shots.load(); // お品書き画像のメタ（使えない環境なら ready=false のまま進む）
    await HC.shots.loadFiles(); // 取り込んだ配置図の画像
    applyLook();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLook);

    U.on('change', () => app.refresh());
    U.on('settings', (k) => {
      if (k === 'dayMode') applyLook();
      if (k === 'showRoute' || k === 'mapMode') V.map.inst && V.map.inst.paint();
    });

    let initial = 'go';
    try { initial = localStorage.getItem('kurunavi.view') || (Object.keys(S.d().entries).length ? 'go' : 'circles'); } catch (_) { /* noop */ }
    V.header();
    V.demoBar();
    if (S.state.settings.dayMode && (initial === 'list' || initial === 'circles')) initial = 'go';
    app.show(initial);
    setTimeout(() => dayPrompt(), 600);

    // 共有リンクからの読み込み
    const m = location.hash.match(/^#import=([A-Za-z0-9_-]+)/);
    if (m) {
      history.replaceState(null, '', appUrl());
      try {
        await importObj(await U.unpack(m[1]));
      } catch (e) {
        UI.toast('共有リンクを読み込めませんでした', { error: true });
      }
    }

    // オフライン用 Service Worker（開発中の localhost では古いキャッシュが邪魔なので使わない）
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      // 新しい版が主導権を取ったら、画面の中身は古いままなので「更新あり」を出す
      navigator.serviceWorker.addEventListener('controllerchange', () => showUpdateChip());
      if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      } else {
        navigator.serviceWorker.register('sw.js').then((reg) => {
          if (reg.waiting) showUpdateChip();   // 前回のうちに届いていた版
          // 画面で動いている版と、保存されている版が違えば「更新あり」（skipWaiting で静かに入れ替わるため）
          setTimeout(async () => {
            const v = await storedVersion();
            if (v && v !== HC.VERSION) showUpdateChip();
          }, 4000);
          setTimeout(() => reg.update().catch(() => {}), 3000); // 起動のたびに新しい版を見に行く
          // 新しい版が入ったら知らせる（当日に古い画面のまま気づかない、を防ぐ）
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateChip();
                UI.toast(`新しい版があります（いまの画面は v${HC.VERSION}）`, { ms: 10000, action: { label: '更新する', fn: () => location.reload() } });
              }
            });
          });
        }).catch(() => {});
      }
    }
    // 前回開いたときと版が変わっていたら、更新が当たったことを知らせる
    try {
      const seen = localStorage.getItem('kurunavi.version');
      if (seen && seen !== HC.VERSION) UI.toast(`v${HC.VERSION} に更新されました`, { ms: 6000 });
      localStorage.setItem('kurunavi.version', HC.VERSION);
    } catch (_) { /* noop */ }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    paintNet();
    // 同期は起動をふさがないよう、後ろで様子を見る
    HC.sync.boot().catch(() => {});
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
