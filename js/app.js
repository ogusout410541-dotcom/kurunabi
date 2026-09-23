/* 起動・画面切替・ユーザー操作（data-act）の処理 */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const S = HC.store;
  const V = HC.views;
  const UI = HC.ui;
  const P = HC.parser;

  HC.VERSION = '1.0.0';

  const VIEWS = ['go', 'list', 'map', 'circles', 'more'];
  const app = (HC.app = { view: 'go', dirty: new Set(VIEWS), sheetCid: null, clockTick: () => {} });

  // ------------------------------------------------------------------ 画面
  app.show = (view, opt = {}) => {
    if (!VIEWS.includes(view)) view = 'go';
    const changed = app.view !== view;
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
  };

  const renderView = (v) => {
    const el = U.$('#v-' + v);
    V[v].render(el);
    app.dirty.delete(v);
  };

  app.refresh = () => {
    V.header();
    VIEWS.forEach((v) => app.dirty.add(v));
    renderView(app.view);
    refreshCircleSheet();
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
    root.style.setProperty('--fs', String(set.font || 1));
    const dark = set.theme === 'dark' || (set.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = U.$('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#12151c' : '#ffffff';
  };

  // ------------------------------------------------------------------ 画面を消さない
  let wake = null;
  const updateWake = async () => {
    const want = S.state.settings.wakeLock && (app.view === 'go' || app.view === 'map') && document.visibilityState === 'visible';
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
    const q = S.queue();
    const next = q.current ? S.circle(q.current) : null;
    UI.toast(`${label}：${circleLabel(cid)}${next ? ` ／ 次は ${next.space}` : ''}`, { undo: true });
    if (app.view === 'go') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const numpadForItem = (cid, it) => {
    const unit = it.paid != null ? Math.round(it.paid / (it.qty || 1)) : it.price;
    UI.numpad({
      title: `${it.name || 'アイテム'} の支払額`,
      showName: false,
      amount: unit || '',
      qty: it.qty,
      pay: it.pay,
      okLabel: '購入済にする',
      onOk: (r) => {
        S.recordPurchase(cid, { iid: it.id, amount: r.amount, qty: r.qty, pay: r.pay });
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
    UI.toast(`追加：${circleLabel(ds.cid)}`, { undo: true, action: { label: '買うものを入れる', fn: () => openCircle(ds.cid) } });
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
    if (ds.keep) { UI.toast(`${S.STATUS[st].label}にしました`, { undo: true }); return; }
    afterFinish(ds.cid, S.STATUS[st].label);
  };

  A.completeAll = (ds) => {
    const cid = ds.cid;
    const e = S.entry(cid);
    if (!e) return;
    const c = S.circle(cid) || e.snap;
    if (!e.items.length) {
      UI.numpad({
        title: `${c.space} ${c.name} の支払額`,
        name: '',
        okLabel: '記録して完了',
        onOk: (r) => {
          S.mutate('購入完了', (d) => {
            const en = d.entries[cid];
            const now = Date.now();
            en.items.push(S.newItem(r.name || '購入品', r.unit, r.qty, { status: 'bought', paid: r.amount, pay: r.pay, planned: false, t: now }));
            en.status = 'done';
            en.doneAt = now;
            if (d.focus === cid) d.focus = null;
          });
          afterFinish(cid, '完了');
        },
      });
      return;
    }
    const unknown = e.items.filter((i) => i.status === 'todo' && !i.price);
    if (unknown.length) {
      UI.numpad({
        title: `価格未定「${unknown.map((i) => i.name || '無題').join('・')}」の支払額`,
        showName: false,
        okLabel: '記録して完了',
        onOk: (r) => {
          S.mutate('購入完了', (d) => {
            const en = d.entries[cid];
            const now = Date.now();
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
    if (it.status === 'todo' && !it.price) return numpadForItem(ds.cid, it);
    if (it.status === 'soldout' || it.status === 'skip') { S.setItemStatus(ds.cid, ds.iid, 'todo'); return; }
    S.toggleItem(ds.cid, ds.iid);
    U.vibrate(8);
    if (it.status === 'bought') checkAllChecked(ds.cid); // toggleItem は同じ参照を書き換えている
  };

  A.itemMenu = (ds) => {
    const e = S.entry(ds.cid);
    const it = e && e.items.find((i) => i.id === ds.iid);
    if (!it) return;
    UI.menu(it.name || 'アイテム', [
      { label: it.status === 'bought' ? '支払額を修正' : '支払額を入れて購入済に', icon: 'yen', act: () => numpadForItem(ds.cid, it) },
      it.status === 'bought'
        ? { label: '未購入に戻す', icon: 'undo', act: () => S.setItemStatus(ds.cid, ds.iid, 'todo') }
        : { label: '予定価格で購入済に', icon: 'check', act: () => { S.toggleItem(ds.cid, ds.iid); checkAllChecked(ds.cid); } },
      { label: 'このアイテムは売り切れ', icon: 'ban', act: () => { S.setItemStatus(ds.cid, ds.iid, 'soldout'); UI.toast('売切にしました', { undo: true }); } },
      { label: '今回は買わない', icon: 'skip', act: () => S.setItemStatus(ds.cid, ds.iid, 'skip') },
      { label: 'アイテムを削除', icon: 'trash', danger: true, act: () => { S.mutate('アイテム削除', (d) => { const en = d.entries[ds.cid]; en.items = en.items.filter((i) => i.id !== ds.iid); }); UI.toast('削除しました', { undo: true }); } },
    ]);
  };

  A.extraBuy = (ds) => {
    const c = S.circle(ds.cid) || S.entry(ds.cid)?.snap;
    UI.numpad({
      title: `${c.space} 追加購入`,
      onOk: (r) => {
        S.recordPurchase(ds.cid, { name: r.name, amount: r.amount, qty: r.qty, pay: r.pay });
        U.vibrate();
        UI.toast(`追加購入 ${U.yen(r.amount)} を記録`, { undo: true });
      },
    });
  };

  A.outsideBuy = () => {
    UI.numpad({
      title: 'サークル外の支出（企業ブース・飲食など）',
      onOk: (r) => {
        S.recordPurchase(null, { name: r.name || 'その他', amount: r.amount, qty: r.qty, pay: r.pay });
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
    app.show('map');
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

  /** 「買うものは入れなくてよい」の切り替え（お品書き待ちの一覧から外す） */
  A.noItems = (ds) => {
    const on = ds.on === '1';
    S.mutate(on ? 'お品書き待ちから外す' : 'お品書き待ちに戻す', (d) => {
      if (d.entries[ds.cid]) d.entries[ds.cid].noItems = on;
    });
    UI.toast(on ? 'お品書き待ちの一覧から外しました' : 'お品書き待ちに戻しました', { undo: true });
  };

  /** 品目を1行足す。過去に入れた金額が分かっていれば価格も入れておく */
  const addItemRow = (cid, name, opt = {}) => {
    const hint = name ? S.priceHint(name) : 0;
    let newId = null;
    S.mutate('アイテム追加', (d) => {
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
      title: `${it.name || 'アイテム'} の予定価格`,
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

  /** 買うものをまとめて入力 */
  A.bulkItems = async (ds) => {
    const e = S.entry(ds.cid);
    if (!e) return;
    const cur = e.items.filter((i) => i.status === 'todo' && i.planned !== false)
      .map((i) => `${i.name}${i.price ? ' ' + i.price : ''}${i.qty > 1 ? ' x' + i.qty : ''}`).join('\n');
    const v = await UI.prompt('買うものをまとめて入力', {
      value: cur,
      multiline: true,
      ok: '置き換える',
      placeholder: '新刊 1000\nアクスタ 1500 x2\n無料配布',
    });
    if (v == null) return;
    const list = P.parseItemLines(v);
    S.mutate('買うものをまとめて入力', (d) => {
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
        <td class="sp">${U.esc(c.space)}</td>
        <td>${U.esc(c.name)}${e.memo ? `<div class="mm">${U.esc(e.memo)}</div>` : ''}</td>
        <td class="pri">${S.PRI[e.pri].label}</td>
        <td class="it">${items || '—'}</td>
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
    if (!(await UI.confirm('新しい版に切り替えます。計画・記録はそのまま残ります。\n入力の途中なら、いったん入力欄から離れてから実行してください。', { ok: '更新する' }))) return;
    S.flush();
    location.reload();
  };
  A.checkUpdate = async () => {
    if (!('serviceWorker' in navigator) || !/^https:$/.test(location.protocol)) {
      return UI.toast(`いま v${HC.VERSION} です（この開き方では更新確認は使えません）`);
    }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return UI.toast(`いま v${HC.VERSION} です（オフライン保存はまだ有効になっていません）`);
    UI.toast('新しい版がないか見ています…');
    try { await reg.update(); } catch (_) { /* 圏外など */ }
    setTimeout(() => {
      if (reg.waiting || reg.installing) {
        showUpdateChip();
        UI.toast(`新しい版があります（いまは v${HC.VERSION}）`, { ms: 10000, action: { label: '更新する', fn: () => location.reload() } });
      } else {
        UI.toast(`v${HC.VERSION} が最新です`);
      }
    }, 1500);
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

  U.on('sync', (m) => {
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
    S.mutate('経過の計測開始', (d) => { d.startedAt = Date.now(); });
    UI.toast('ここからの経過時間を表示します');
  };

  const askTime = async (title, cur, fallback) => {
    const v = await UI.prompt(title, { value: cur || fallback, placeholder: fallback, type: 'time' });
    if (v == null) return null;
    const t = U.toHalf(v).trim();
    if (t && !/^\d{1,2}:\d{2}$/.test(t)) { UI.toast('「12:00」のように入れてください', { error: true }); return null; }
    return t;
  };

  A.clockMenu = () => {
    const T = S.times();
    UI.menu('時刻の設定', [
      { label: '開始（入場）の時刻', icon: 'cal', hint: T.openAt ? `いま ${T.openAt}` : '未設定', act: async () => {
        const t = await askTime('自分が入場する時刻', S.d().openAt, T.openAt || '12:00');
        if (t != null) S.mutate('開始時刻', (x) => { x.openAt = t; });
      } },
      { label: '終了の時刻', icon: 'clock', hint: T.endAt ? `いま ${T.endAt}` : '未設定', act: async () => {
        const t = await askTime('即売会が終わる時刻', S.d().endAt, T.endAt || '16:00');
        if (t != null) S.mutate('終了時刻', (x) => { x.endAt = t; });
      } },
      { label: 'いまから計り直す', icon: 'timer', hint: '開始時刻を使わず、押した時点からの経過にする', act: () => A.clockStart() },
      { label: '経過表示をやめる', icon: 'x', act: () => S.mutate('経過表示オフ', (x) => { x.openAt = ''; x.startedAt = 0; }) },
    ]);
  };

  /** イベントのタイムテーブル（いま何が起きている時間かを出す） */
  A.schedule = () => {
    const T = S.times();
    const c = S.clock();
    const now = new Date();
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
    const want = app.view === 'go' && document.visibilityState === 'visible';
    if (want && !clockTimer) {
      clockTimer = setInterval(() => { if (!V.tickClock()) stopClock(); }, 1000);
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
    if (!files.length) return;
    let n = 0, err = '';
    for (const f of files) {
      try { await HC.shots.add(S.state.eventId, ds.cid, f); n++; } catch (e) { err = (e && e.message) || String(e); }
    }
    if (n) { UI.toast(`お品書きを${n}枚 追加しました`); app.refresh(); }
    if (err) UI.toast('保存できませんでした：' + err, { error: true });
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
  A.mapRoute = () => { S.setSetting('showRoute', !S.state.settings.showRoute); renderView('map'); };
  A.mapImage = () => {
    S.setSetting('mapMode', S.state.settings.mapMode === 'image' ? 'simple' : 'image');
    const inst = ensureMap();
    const vb = inst && inst.vb && { ...inst.vb };
    inst.build();
    if (vb) inst.setVB(vb);
    renderView('map');
    UI.toast(S.state.settings.mapMode === 'image' ? '公式配置図の上に表示中' : 'シンプル表示');
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
        <label class="field"><span>持っていく現金（任意・財布の残りを表示）</span><div class="yen-input"><span>¥</span><input class="input" inputmode="numeric" name="cash" value="${d.cash || ''}" placeholder="0"></div></label>
        <button class="btn primary block" data-ok>保存</button></div>`,
      onMount: (el) => {
        setTimeout(() => U.$('input', el).focus(), 60);
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
      res.textContent = `解析：${sm.count}サークル（${Object.entries(sm.blocks).map(([b, n]) => `${b}:${n}`).join(' ')}）`;
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
        if (!list.length) return UI.toast('サークル一覧を解析できませんでした。貼り付け内容を確認してください', { error: true });
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
            if (!list.length) return UI.toast('サークル一覧を解析できませんでした', { error: true });
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

  A.shareLink = async () => {
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
    const ev = S.ev();
    U.download(`kurunavi_${ev.short}_${stamp()}.json`, JSON.stringify(S.exportPlan()));
    UI.toast('書き出しました');
  };
  A.exportAll = () => {
    U.download(`kurunavi_backup_${stamp()}.json`, JSON.stringify(S.exportAll()));
    UI.toast('全データを書き出しました');
  };
  A.exportCsv = () => {
    U.download(`kurunavi_${S.ev().short}_${stamp()}.csv`, S.csv(), 'text/csv');
  };

  const importObj = async (obj) => {
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
    try { onFieldChange(f, el, ds); } finally { app.quiet = false; }
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
      if (k === 'showRoute' || k === 'mapMode') V.map.inst && V.map.inst.paint();
    });

    let initial = 'go';
    try { initial = localStorage.getItem('kurunavi.view') || (Object.keys(S.d().entries).length ? 'go' : 'circles'); } catch (_) { /* noop */ }
    V.header();
    app.show(initial);

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
      if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      } else {
        navigator.serviceWorker.register('sw.js').then((reg) => {
          if (reg.waiting) showUpdateChip();   // 前回のうちに届いていた版
          setTimeout(() => reg.update().catch(() => {}), 3000); // 起動のたびに新しい版を見に行く
          // 新しい版が入ったら知らせる（当日に古い画面のまま気づかない、を防ぐ）
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateChip();
                UI.toast(`新しい版があります（いまは v${HC.VERSION}）`, { ms: 10000, action: { label: '更新する', fn: () => location.reload() } });
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
