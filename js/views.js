/* 画面の描画。データ変更は HC.actions / HC.store 経由で行い、ここは HTML を組み立てるだけ */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const P = HC.parser;
  const V = (HC.views = {});
  const esc = U.esc;
  const S = () => HC.store;

  // ------------------------------------------------------------------ 共通部品
  V.space = (c, cls = '') => {
    if (!c) return '';
    const nums = c.space.slice(c.block.length);
    return `<span class="sp ${cls}"><b>${esc(c.block)}</b>${esc(nums)}</span>`;
  };
  V.pri = (p, extra = '') => `<span class="pri-chip p${p} ${extra}">${S().PRI[p].label}</span>`;
  V.status = (st) => (st && st !== 'todo' ? `<span class="st-chip st-${st}">${S().STATUS[st].label}</span>` : '');
  V.links = (c, e) => {
    const out = [];
    if (c.tw) out.push(`<a class="link-chip x" href="${P.twitterUrl(c.tw)}" target="_blank" rel="noopener">${U.icon('xlogo', 'sm')}@${esc(c.tw)}</a>`);
    if (c.px) out.push(`<a class="link-chip px" href="${esc(P.pixivUrl(c.px))}" target="_blank" rel="noopener">pixiv</a>`);
    if (c.web) out.push(`<a class="link-chip web" href="${esc(c.web)}" target="_blank" rel="noopener">${U.icon('link')}Web</a>`);
    if (e && e.menu) out.push(`<a class="link-chip menu" href="${esc(e.menu)}" target="_blank" rel="noopener">お品書き</a>`);
    return out.join('');
  };
  /** お品書き画像のサムネ列。add=true で「＋追加」ボタンも出す */
  V.shots = (cid, { add = false } = {}) => {
    const Sh = HC.shots;
    if (!Sh || !Sh.ready) return '';
    const list = Sh.list(S().state.eventId, cid);
    if (!list.length && !add) return '';
    return `<div class="shots">${list.map((m) => `
      <button class="shot-thumb" data-act="viewShot" data-id="${esc(m.id)}" data-cid="${esc(cid)}" aria-label="お品書きを開く">
        <img src="${m.thumb}" alt="お品書き" loading="lazy" width="${m.w}" height="${m.h}"></button>`).join('')}
      ${add ? `<button class="shot-add" data-act="addShot" data-cid="${esc(cid)}">${U.icon('image')}<span>画像を追加</span></button>` : ''}</div>`;
  };

  const itemNames = (e) => e.items.map((i) => i.name || '（無題）').join('・');
  const priceTxt = (i) => (i.price ? U.yen(i.price) : S().isFree(i) ? '<span class="free">無料</span>' : '<span class="unk">¥?</span>') + (i.qty > 1 ? `<small>×${i.qty}</small>` : '');

  const emptyState = (icon, title, body, btn) =>
    `<div class="empty">${U.icon(icon)}<h3>${title}</h3><p>${body}</p>${btn || ''}</div>`;

  // ------------------------------------------------------------------ ヘッダー
  V.header = () => {
    const ev = S().ev();
    const st = S().stats();
    U.$('#ev-name').textContent = ev ? ev.name : 'イベント未選択';
    const w = U.$('#top-wallet');
    if (st.budget) {
      w.innerHTML = `<small>残り</small><b class="${st.left < 0 ? 'neg' : ''}">${U.yen(st.left)}</b>`;
    } else {
      w.innerHTML = `<small>使用</small><b>${U.yen(st.spent)}</b>`;
    }
  };

  // ------------------------------------------------------------------ 財布カード
  V.wallet = (st) => {
    if (!st.budget) {
      return `<section class="wallet card no-budget">
        <div class="w-main"><div class="w-label">使った金額</div><div class="w-amount">${U.yen(st.spent)}</div>
        <div class="w-sub">残り予定 ${U.yen(st.plannedLeft)}${st.unknown ? ` ＋ 価格未定${st.unknown}件` : ''}</div></div>
        <button class="btn sm" data-act="budgetEdit">${U.icon('wallet')}予算を設定</button>
      </section>`;
    }
    const base = Math.max(st.usable, st.spent + st.plannedLeft, 1);
    const pSpent = (st.spent / base) * 100;
    const pPlan = (Math.min(st.plannedLeft, Math.max(base - st.spent, 0)) / base) * 100;
    return `<section class="wallet card" data-act="budgetEdit">
      <div class="w-main">
        <div class="w-label">使える残り</div>
        <div class="w-amount ${st.left < 0 ? 'neg' : ''}">${U.yen(st.left)}</div>
        <div class="w-sub">予算 ${U.yen(st.usable)}${st.reserve ? `（別枠 ${U.yen(st.reserve)} 除く）` : ''} ・ 使用 ${U.yen(st.spent)}</div>
      </div>
      <div class="w-side">
        <div><span>残り予定</span><b>${U.yen(st.plannedLeft)}</b></div>
        <div><span>見込み残</span><b class="${st.projected < 0 ? 'neg' : 'pos'}">${U.yen(st.projected)}</b></div>
        ${st.cashLeft != null ? `<div><span>財布の現金</span><b class="w-cash ${st.cashLeft < 0 ? 'neg' : ''}">${U.yen(st.cashLeft)}</b></div>` : ''}
        <button class="link-btn w-wallet" data-act="wallet">${U.icon('wallet', 'sm')}${S().hasCashBreak() ? `金種 ${S().cashCount()}枚` : '金種を登録'}</button>
      </div>
      <div class="w-bar" aria-hidden="true"><i class="spent" style="width:${pSpent}%"></i><i class="plan" style="width:${pPlan}%"></i></div>
      ${st.projected < 0 ? `<div class="w-warn">${U.icon('warn', 'sm')} 予定を全部買うと ${U.yen(-st.projected)} 足りません${st.mustLeft ? `（必須の残り ${U.yen(st.mustLeft)}）` : ''}</div>` : ''}
      ${st.unknown ? `<div class="w-note">価格未定 ${st.unknown}件は見込みに含まれていません</div>` : ''}
    </section>`;
  };

  // ------------------------------------------------------------------ 財布の中身（金種）
  /** 金種ごとの枚数を入れる表。設定と当日タブの両方から開く */
  V.cashEditor = () => {
    const s = S();
    const br = s.d().cashBreak || {};
    const rows = s.DENOMS.map((den) => {
      const n = br[den] || 0;
      return `<div class="den-row${n ? ' has' : ''}">
        <span class="den-label">${U.yen(den)}</span>
        <button class="icon-btn sm" data-act="denomStep" data-d="${den}" data-n="-1" aria-label="${U.yen(den)}を1枚減らす">${U.icon('minus', 'sm')}</button>
        <input class="input den-n" inputmode="numeric" data-f="denom" data-d="${den}" value="${n || ''}" placeholder="0" aria-label="${U.yen(den)}の枚数">
        <button class="icon-btn sm" data-act="denomStep" data-d="${den}" data-n="1" aria-label="${U.yen(den)}を1枚増やす">${U.icon('plus', 'sm')}</button>
        <span class="den-sum">${n ? U.yen(den * n) : ''}</span>
      </div>`;
    }).join('');
    const total = s.cashTotal();
    const count = s.cashCount();
    return `<div class="denoms">
      ${rows}
      <div class="den-foot"><span>合計</span><b>${U.yen(total)}</b><span class="muted">${count}枚</span>
        ${count ? `<button class="link-btn" data-act="cashClear">${U.icon('x', 'sm')}全部消す</button>` : ''}</div>
      <p class="muted small">枚数を入れておくと、支払いのときに出す金種の組み合わせが出ます。記録のときに「財布の中身から引く」を押すと、出した分を引いて、おつりを足し戻します。</p>
    </div>`;
  };

  // ------------------------------------------------------------------ 当日モード
  /*
   * 当日（会場）専用の画面。片手・急いでいる・電波が弱い・明るさがまちまち、を前提に
   * 「いま行くサークル」だけを大きく出し、完了・売切などのボタンは親指の届く画面下に固定する。
   * 文字の拡大と高コントラストは CSS（body.day）で行う
   */
  V.day = {
    allOpen: false,   // 「この後」を全部広げているか
    render(el) {
      const s = S();
      const d = s.d();
      const st = s.stats();
      const q = s.queue();
      let html = V.dayStrip(st);
      if (!d.order.length) {
        html += emptyState('list', 'まだ計画がありません', '計画を作ってから当日モードを使ってください。',
          `<button class="btn primary" data-act="dayOff">${U.icon('x')}当日モードを終える</button>`);
        el.innerHTML = `<div class="go day">${html}</div>`;
        return;
      }
      if (q.current) html += V.dayCard(q.current, q);
      else {
        html += `<section class="card done-card">
          <div class="done-mark">${U.icon('flag')}</div><h3>全部回り終わりました</h3>
          <p>おつかれさまでした。使った金額は <b>${U.yen(st.spent)}</b> です。</p>
          <button class="btn lg" data-act="nav" data-view="log">${U.icon('yen')}購入の記録を見る</button>
        </section>`;
      }
      const rest = [...q.todo, ...q.later].filter((x) => x !== q.current);
      if (rest.length) {
        const shown = this.allOpen ? rest : rest.slice(0, 5);
        html += `<section class="card qcard day-next"><h3>この後 <small>${rest.length}件</small>
            <button class="link-btn" data-act="reroute">${U.icon('route')}ここから組み直す</button></h3>
          <ol class="qlist">${shown.map((cid, i) => V.qrow(cid, d.entries[cid].status === 'later' ? '後' : i + 2)).join('')}</ol>
          ${rest.length > 5 ? `<button class="link-btn more" data-act="dayAll">${this.allOpen ? `${U.icon('up', 'sm')}たたむ` : `${U.icon('down', 'sm')}残り${rest.length - 5}件も表示`}</button>` : ''}
        </section>`;
      }
      if (q.finished.length) {
        const fin = q.finished.map((cid) => d.entries[cid]).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
        html += `<details class="card qcard fin"><summary><h3>終わったところ <small>${fin.length}件</small></h3></summary>
          <ol class="qlist">${fin.map((e) => V.qrow(e.cid, U.time(e.doneAt) || U.icon('check', 'sm'))).join('')}</ol></details>`;
      }
      el.innerHTML = `<div class="go day">${html}</div>`;
    },
  };

  /** 当日モードの上部：時計・残り時間・予算・財布・残り件数 */
  V.dayStrip = (st) => {
    const s = S();
    const c = s.clock();
    const pct = st.total ? Math.round((st.doneCount / st.total) * 100) : 0;
    return `<section class="day-strip">
      <div class="ds-top">
        <b class="ds-now" id="ck-now">${U.clockTime(c.now)}</b>
        <span class="ds-el" id="ck-el" data-day="1">${dayElapsedText(c)}</span>
        <button class="link-btn sm" data-act="clockMenu" aria-label="時刻の設定">${U.icon('timer', 'sm')}</button>
      </div>
      <div class="ds-nums">
        <button data-act="nav" data-view="log"><small>${st.budget ? '予算の残り' : '使った金額'}</small><b class="${st.budget && st.left < 0 ? 'neg' : ''}">${U.yen(st.budget ? st.left : st.spent)}</b></button>
        <button data-act="wallet"><small>財布の現金</small><b class="${st.cashLeft != null && st.cashLeft < 0 ? 'neg' : ''}">${st.cashLeft != null ? U.yen(st.cashLeft) : '未登録'}</b></button>
        <div><small>残り</small><b>${st.activeCount}<small>件</small></b></div>
      </div>
      <div class="prog"><i style="width:${pct}%"></i></div>
    </section>`;
  };

  /** 当日モードの時計の右側（短く） */
  const dayElapsedText = (c) => {
    if (c.state === 'before') return c.days >= 1 ? `開始まで <b>${c.days}日</b>` : `開始まで <b>${U.span(c.base - c.now)}</b>`;
    if (c.state === 'after') return c.date ? '終了しました' : '';
    if (c.state === 'none') return '';
    return c.left > 0 ? `終了まで <b>${U.span(c.left)}</b>` : `経過 <b>${U.span(c.elapsed)}</b>`;
  };

  /** 当日モードの「いま行くサークル」カード */
  V.dayCard = (cid, q) => {
    const s = S();
    const d = s.d();
    const e = d.entries[cid];
    const c = s.circle(cid) || { ...e.snap, block: (e.snap.space || '?')[0] };
    const all = [...q.todo, ...q.later];
    const idx = all.indexOf(cid);
    const planned = s.entryPlanned(e), spent = s.entrySpent(e);
    const hasTodo = e.items.some((i) => i.status === 'todo');
    const near = s.nearby(cid, 3);
    const Sh = HC.shots;
    const shots = Sh && Sh.ready ? Sh.list(s.state.eventId, cid) : [];
    const enter = HC.app.curGuard && Date.now() < HC.app.curGuard ? ' enter' : '';
    return `<section class="card cur day-card p${e.pri} st-${e.status}${enter}">
      <div class="cur-top">
        <span class="order">${idx >= 0 ? `${idx + 1} / ${all.length}` : ''}</span>${V.pri(e.pri)}${V.status(e.status)}
        ${s.isWall(cid) ? '<span class="tag wall">壁</span>' : ''}
        <span class="grow"></span>
        <button class="btn sm" data-act="dayMap">${U.icon('map')}道順</button>
        <button class="icon-btn" data-act="openCircle" data-cid="${cid}" aria-label="詳細・編集">${U.icon('edit')}</button>
      </div>
      <button class="dc-space" data-act="dayMap">${V.space(c, 'xxl')}</button>
      <div class="cur-name">${esc(c.name)}</div>
      ${e.memo ? `<div class="cur-memo">${esc(e.memo).replace(/\n/g, '<br>')}</div>` : ''}
      ${shots.length ? `<div class="dc-shots">
          <button class="dc-shot" data-act="viewShot" data-id="${esc(shots[0].id)}" data-cid="${esc(cid)}" aria-label="お品書きを大きく見る">
            <img data-shot="${esc(shots[0].id)}" src="${shots[0].thumb}" alt="お品書き"><span class="dc-zoom">${U.icon('zoomIn', 'sm')}拡大</span></button>
          ${shots.length > 1 ? `<div class="shots">${shots.slice(1).map((m) => `<button class="shot-thumb" data-act="viewShot" data-id="${esc(m.id)}" data-cid="${esc(cid)}" aria-label="お品書きを開く"><img src="${m.thumb}" alt="お品書き"></button>`).join('')}</div>` : ''}
        </div>` : (Sh && Sh.ready && !e.noShot ? '<p class="dc-noshot">お品書き画像は登録されていません</p>' : '')}
      ${e.items.length ? `<ul class="items">${V.itemRows(cid, e)}</ul>`
        : (s.isPending(e)
          ? `<p class="cur-pend">${U.icon('clock', 'sm')}買うものは登録されていません。買ったものは下の「追加で買ったもの」から記録できます</p>`
          : '<p class="muted small">買うものは登録していません</p>')}
      <div class="dc-sub">
        <button class="btn" data-act="extraBuy" data-cid="${cid}">${U.icon('plus')}追加で買ったもの</button>
        <button class="btn" data-act="editMemo" data-cid="${cid}">${U.icon('note')}${e.memo ? 'メモを直す' : 'メモ'}</button>
      </div>
      ${V.payReady(planned - spent)}
      <div class="cur-sum"><span>予定 ${U.yen(planned)}</span><span>支払 <b>${U.yen(spent)}</b></span></div>
      ${near.length ? `<div class="near"><span class="near-l">${U.icon('compass', 'sm')}この近く</span>
        ${near.map((x) => {
          const nc = s.circle(x.cid) || d.entries[x.cid].snap;
          return `<button class="near-chip" data-act="focus" data-cid="${x.cid}">${V.space(nc)}<span>${esc(nc.name)}</span></button>`;
        }).join('')}</div>` : ''}
      <div class="cur-links">${V.links(c, e)}</div>
      <div class="day-actions">
        ${hasTodo || !e.items.length
          ? `<button class="btn primary xl block" data-act="completeAll" data-cid="${cid}">${U.icon('check')}${e.items.length ? `全部買えた${U.icon('right', 'sm')}次へ` : '金額を入れて完了'}</button>`
          : `<button class="btn primary xl block" data-act="setStatus" data-st="done" data-cid="${cid}">${U.icon('check')}完了${U.icon('right', 'sm')}次へ</button>`}
        <div class="btn-grid3">
          <button class="btn" data-act="setStatus" data-st="soldout" data-cid="${cid}">${U.icon('ban')}売り切れ</button>
          <button class="btn" data-act="setStatus" data-st="later" data-cid="${cid}">${U.icon('clock')}あとで</button>
          <button class="btn" data-act="setStatus" data-st="skip" data-cid="${cid}">${U.icon('skip')}見送り</button>
        </div>
      </div>
    </section>`;
  };

  /** 通常モードの当日タブに出す、当日モード・デモへの入口 */
  V.dayEntry = () => `<section class="card day-entry">
      <div class="de-text"><b>${U.icon('go', 'sm')}当日モード</b><small>文字とボタンを大きくし、当日に使う画面だけにします。デモでは、記録を残さずに本番どおりの操作を試せます。</small></div>
      <div class="de-btns">
        <button class="btn primary" data-act="dayOn">当日モードにする</button>
        <button class="btn" data-act="demoStart">デモで練習</button>
      </div>
    </section>`;

  /** デモ中の帯（画面上部に常に出す） */
  V.demoBar = () => {
    const el = U.$('#demo-bar');
    if (!el) return;
    const s = S();
    if (!s.isDemo()) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<span class="db-l"><b>デモ中</b><span class="db-now" id="demo-now">${U.clockTime(s.now())}</span></span>
      <small class="db-note">記録は終了すると元に戻ります</small>
      <button class="db-btn" data-act="demoFwd" data-m="10">+10分</button>
      <button class="db-btn end" data-act="demoEnd">終了</button>`;
  };

  // ------------------------------------------------------------------ 記録（当日モードのタブ）
  V.log = {
    render(el) {
      const s = S();
      const st = s.stats();
      const log = s.log().reverse();
      el.innerHTML = `<div class="log-view">
        <section class="card log-sum">
          <div><span>使った金額</span><b>${U.yen(st.spent)}</b></div>
          ${st.budget ? `<div><span>予算の残り</span><b class="${st.left < 0 ? 'neg' : ''}">${U.yen(st.left)}</b></div>` : ''}
          <div><span>財布の現金</span><b class="${st.cashLeft != null && st.cashLeft < 0 ? 'neg' : ''}">${st.cashLeft != null ? U.yen(st.cashLeft) : '未登録'}</b></div>
          <div><span>買ったもの</span><b>${log.length}<small>件</small></b></div>
        </section>
        <div class="btn-grid2 log-btns">
          <button class="btn lg" data-act="outsideBuy">${U.icon('plus')}サークル外の支出</button>
          <button class="btn lg" data-act="wallet">${U.icon('wallet')}財布の中身</button>
        </div>
        <section class="card">
          <h3>${U.icon('yen')}購入の記録 <small>新しい順</small></h3>
          ${log.length ? `<ol class="log big">${log.map((r) => `<li>
            <span class="t">${U.time(r.t)}</span>
            ${r.cid ? `<button class="w" data-act="openCircle" data-cid="${esc(r.cid)}">` : '<span class="w">'}<span class="wl">${r.space ? `<b>${esc(r.space)}</b> ` : ''}${esc(r.circle)}</span><small>${esc(r.name)}${r.qty > 1 ? ' ×' + r.qty : ''}${r.planned ? '' : ' ・追加'}${r.pay === 'card' ? ' ・キャッシュレス' : ''}</small>${r.cid ? '</button>' : '</span>'}
            <span class="c">${U.yen(r.cost)}</span>
            ${r.xid ? `<button class="icon-btn sm" data-act="removeExtra" data-xid="${r.xid}" aria-label="削除">${U.icon('trash')}</button>` : ''}
          </li>`).join('')}</ol>` : '<p class="muted">まだ記録はありません。買ったらサークルのカードで「全部買えた」を押すと、ここに並びます。</p>'}
        </section>
      </div>`;
    },
  };

  /** 当日モードの「メニュー」タブ（設定の代わりに、当日に使うものだけ大きく並べる） */
  V.dayMenu = (el) => {
    const s = S();
    const T = s.times();
    const demo = s.state.demo;
    const tile = (act, icon, label, extra = '') => `<button class="menu-tile" data-act="${act}" ${extra}>${U.icon(icon)}<span>${label}</span></button>`;
    el.innerHTML = `<div class="more-view day-menu">
      ${demo ? `<section class="card demo-card">
        <h3>${U.icon('timer')}デモ中 <small>時計は ${esc(U.md(s.now()))} ${esc(U.time(s.now()))}</small></h3>
        <p class="small">デモで付けた記録と財布の変化は、終了すると始める前の状態に戻ります。デモ中は同期を止めています。</p>
        <div class="btn-grid2">
          <button class="btn" data-act="demoFwd" data-m="10">+10分 進める</button>
          <button class="btn" data-act="demoFwd" data-m="60">+1時間 進める</button>
          <button class="btn" data-act="demoRestart">最初からやり直す</button>
          <button class="btn primary" data-act="demoEnd">デモを終了する</button>
        </div>
      </section>` : ''}
      <section class="card">
        <h3>${U.icon('go')}当日に使うもの</h3>
        <div class="menu-tiles">
          ${tile('wallet', 'wallet', '財布の中身')}
          ${tile('outsideBuy', 'yen', 'サークル外の支出')}
          ${tile('reroute', 'route', 'ここから組み直す')}
          ${T.schedule.length ? tile('schedule', 'cal', '進行表') : ''}
          ${tile('clockMenu', 'timer', '時刻の設定')}
          ${tile('nav', 'list', '計画のリスト', 'data-view="list"')}
          ${tile('nav', 'search', 'サークルを探す', 'data-view="circles"')}
          ${HC.sync.configured() ? tile('shotsPull', 'download', 'お品書き画像を受け取る') : ''}
        </div>
      </section>
      ${demo ? '' : `<section class="card">
        <h3>${U.icon('timer')}デモで練習</h3>
        <p class="small">いまの計画のまま、時計を開催日の開始時刻に合わせて本番どおりに操作できます。付けた記録は、終了すると元に戻ります。</p>
        <button class="btn block" data-act="demoStart">デモを始める</button>
      </section>`}
      <div class="btn-grid2">
        <button class="btn lg" data-act="fullSettings">${U.icon('more')}すべての設定</button>
        <button class="btn lg danger ghost" data-act="dayOff">${U.icon('x')}当日モードを終える</button>
      </div>
    </div>`;
  };

  // ------------------------------------------------------------------ 当日（ナビ）
  V.go = {
    render(el) {
      if (S().state.settings.dayMode) return V.day.render(el);
      const s = S();
      const d = s.d();
      const st = s.stats();
      const q = s.queue();
      const ev = s.ev();
      let html = V.clockbar() + V.wallet(st);

      if (!d.order.length) {
        html += emptyState('list', 'まだ計画がありません', '「サークル」タブで欲しいサークルを追加すると、ここに回る順番と予算が表示されます。',
          `<button class="btn primary" data-act="nav" data-view="circles">${U.icon('search')}サークルを探す</button>`);
        el.innerHTML = `<div class="go">${html}</div>`;
        return;
      }

      html += V.dayEntry();
      // 開催前（と、まだ1件も回っていない間）は準備の抜けを出す
      const ck = s.clock();
      if (ck.state === 'before' || ck.state === 'none' || !st.doneCount) html += V.prep(ck);

      const pct = st.total ? Math.round((st.doneCount / st.total) * 100) : 0;
      html += `<div class="progress-row">
        <div class="prog"><i style="width:${pct}%"></i></div>
        <span><b>${st.doneCount}</b>/${st.total} 完了</span>
        ${st.mustTotal ? `<span class="must ${st.mustDone === st.mustTotal ? 'ok' : ''}">必須 ${st.mustDone}/${st.mustTotal}</span>` : ''}
      </div>`;

      if (q.current) {
        html += V.currentCard(q.current, q);
      } else {
        html += `<section class="card done-card">
          <div class="done-mark">${U.icon('flag')}</div><h3>全部回り終わりました</h3>
          <p>おつかれさまでした。使った金額は <b>${U.yen(st.spent)}</b> です。</p>
          <button class="btn" data-act="nav" data-view="more" data-scroll="log">購入記録を見る</button>
        </section>`;
      }

      const nextIds = q.todo.filter((x) => x !== q.current);
      if (nextIds.length) {
        html += `<section class="card qcard"><h3>この後 <small>${nextIds.length}件</small>
          <button class="link-btn" data-act="reroute">${U.icon('route')}ここから組み直す</button></h3>
          <ol class="qlist">${nextIds.slice(0, 6).map((cid, i) => V.qrow(cid, i + 2)).join('')}</ol>
          ${nextIds.length > 6 ? `<button class="link-btn more" data-act="nav" data-view="list">残り${nextIds.length - 6}件をリストで見る</button>` : ''}
        </section>`;
      }
      const laterIds = q.later.filter((x) => x !== q.current);
      if (laterIds.length) {
        html += `<section class="card qcard later"><h3>${U.icon('clock')}あとで回る <small>${laterIds.length}件</small></h3>
          <ol class="qlist">${laterIds.map((cid) => V.qrow(cid, '後')).join('')}</ol></section>`;
      }
      if (q.finished.length) {
        const fin = q.finished.map((cid) => d.entries[cid]).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
        html += `<details class="card qcard fin"><summary><h3>終わったところ <small>${fin.length}件</small></h3></summary>
          <ol class="qlist">${fin.map((e) => V.qrow(e.cid, U.time(e.doneAt) || U.icon('check', 'sm'))).join('')}</ol></details>`;
      }
      html += `<div class="go-foot">
        <button class="btn ghost" data-act="outsideBuy">${U.icon('yen')}サークル外の支出を記録</button>
        <button class="btn ghost" data-act="nav" data-view="list" data-scroll="sim">${U.icon('wallet')}この先いくら必要か</button>
      </div>`;
      el.innerHTML = `<div class="go">${html}</div>`;
    },
  };

  /**
   * 当日までの準備。抜けているものだけボタン付きで出し、全部済んだら1行にたたむ。
   * 当日の朝に電波のあるうちに見直す、という使い方を想定している
   */
  V.prep = (ck) => {
    const s = S();
    const d = s.d();
    const active = d.order.filter((cid) => d.entries[cid] && ['todo', 'later'].includes(d.entries[cid].status));
    const unknownCids = active.filter((cid) => d.entries[cid].items.some((i) => i.status === 'todo' && i.planned !== false && s.isUnknown(i)));
    const pend = s.pendingCids().length;
    const addedAfter = d.routedAt ? active.filter((cid) => (d.entries[cid].addedAt || 0) > d.routedAt).length : 0;
    const sw = 'serviceWorker' in navigator && location.protocol === 'https:';
    const sync = s.state.sync;
    const rows = [
      { ok: !!s.eventDate(), label: '開催日', note: s.eventDate() ? U.md(new Date(s.eventDate() + 'T00:00:00').getTime()) : '未設定のときは、今日を開催日として時刻を計算します', act: 'setEventDate', btn: '設定' },
      { ok: !!d.budget, label: '予算', note: d.budget ? U.yen(d.budget) : '未設定のため、残りと見込みを計算できません', act: 'budgetEdit', btn: '設定' },
      { ok: !pend, label: 'お品書き待ち', note: pend ? `買うものを登録していないサークルが${pend}件あります` : 'すべて登録済みです', act: 'nav', data: 'data-view="list" data-scroll="pend"', btn: '見る' },
      { ok: !unknownCids.length, label: '価格未定', note: unknownCids.length ? `金額が未定の品物があるサークルが${unknownCids.length}件あります` : 'すべての品物に金額があります', act: 'openCircle', data: `data-cid="${esc(unknownCids[0] || '')}"`, btn: '登録' },
      { ok: !!d.routedAt && !addedAfter, label: 'ルート', note: !d.routedAt ? 'まだ作っていません' : addedAfter ? `ルートを作ったあとに${addedAfter}サークル追加しています` : `${U.md(d.routedAt)} ${U.time(d.routedAt)} に作成`, act: 'routeMenu', btn: '作る' },
      { ok: s.hasCashBreak(), label: '財布の中身', note: s.hasCashBreak() ? `${U.yen(s.cashTotal())}（${s.cashCount()}枚）` : '金種ごとの枚数を登録すると、支払いで出す硬貨とお札を案内します', act: 'wallet', btn: '登録', optional: true },
      sw ? { ok: !!navigator.serviceWorker.controller, label: 'オフライン保存', note: navigator.serviceWorker.controller ? '圏外でも開けます' : 'まだ保存されていません', act: 'offlineRefresh', btn: '保存' } : null,
      sync.url && sync.phrase ? { ok: !sync.dirty, label: '同期', note: sync.dirty ? 'まだ送っていない変更があります' : '送信済み', act: 'syncNow', btn: '送る' } : null,
      HC.shots && HC.shots.ready ? (() => {
        const n = s.noShotCids().length;
        return { ok: !n, label: 'お品書き画像の登録', note: n ? `画像を登録していないサークルが${n}件あります` : 'すべて登録済みです', act: 'nav', data: 'data-view="list" data-scroll="noimg"', btn: '見る' };
      })() : null,
      sync.url && sync.phrase && HC.shots && HC.shots.ready && HC.shots.unsent().length
        ? { ok: false, label: '画像の受け渡し', note: `${HC.shots.unsent().length}枚をまだ送っていません`, act: 'shotsPush', btn: '送る' } : null,
      sync.url && sync.phrase && HC.shots && HC.shots.ready && !HC.shots.unsent().length
        ? { ok: false, optional: true, label: '画像の受け渡し', note: `この端末 ${HC.shots.all().length}枚${sync.shotsAt ? ` ・ 最終の受け渡し ${U.md(sync.shotsAt)} ${U.time(sync.shotsAt)}` : ' ・ ほかの端末で追加した画像は「受け取る」で取り込めます'}`, act: 'shotsPull', btn: '受け取る' } : null,
      HC.app.updateReady ? { ok: false, label: '新しい版', note: '更新してから出かけると安心です', act: 'applyUpdate', btn: '更新' } : null,
    ].filter(Boolean);
    const left = rows.filter((r) => !r.ok && !r.optional).length;
    const live = ck.state === 'live' || ck.state === 'after';
    if (live && !left) return '';   // 始まってからは、抜けがあるときだけ出す
    const when = ck.state === 'before' && ck.days >= 1 ? `あと${ck.days}日` : ck.state === 'before' ? '今日' : '';
    // 開け閉めは本人の操作を覚えておく（描き直すたびに開き直さないように）
    // 始まってからは当日カードを押し下げないよう、たたんで出す
    const open = V.prepOpen != null ? V.prepOpen : left > 0 && !live;
    return `<details class="card prep${left ? ' todo' : ''}" id="sec-prep"${open ? ' open' : ''}>
      <summary><h3>${U.icon(left ? 'warn' : 'check')}当日までの準備 <small>${when ? when + ' ・ ' : ''}${left ? `残り${left}件` : 'できています'}</small></h3></summary>
      <ul class="prep-list">${rows.map((r) => `<li class="${r.ok ? 'ok' : r.optional ? 'opt' : 'ng'}">
        <span class="pk">${U.icon(r.ok ? 'check' : r.optional ? 'minus' : 'warn', 'sm')}</span>
        <span class="pl"><b>${esc(r.label)}</b><small>${esc(r.note)}</small></span>
        ${r.ok ? '' : `<button class="btn sm" data-act="${r.act}" ${r.data || ''}>${esc(r.btn)}</button>`}
      </li>`).join('')}</ul>
      ${sw ? '<p class="muted small">当日の朝、電波のあるうちに一度開いておくと確実です。</p>' : ''}
    </details>`;
  };

  /**
   * 当日の時計。1秒ごとに V.tickClock() が中の文字だけ書き換える（描画し直さない）
   */
  V.clockbar = () => {
    const c = S().clock();
    return `<div class="clockbar" id="clockbar">
      <span class="ck-now">${U.icon('clock', 'sm')}<b id="ck-now">${U.clockTime(c.now)}</b></span>
      <span class="ck-el" id="ck-el">${clockElapsedText(c)}</span>
      <span class="grow"></span>
      ${S().times().schedule.length ? `<button class="link-btn sm" data-act="schedule">${U.icon('cal', 'sm')}進行</button>` : ''}
      ${c.base ? `<button class="link-btn sm" data-act="clockMenu">${U.icon('timer', 'sm')}時刻</button>`
        : `<button class="link-btn sm" data-act="clockStart">${U.icon('timer', 'sm')}経過を計り始める</button>`}
    </div>`;
  };
  /** 時計バーの右側。開催前・開催中・終了後で出し分ける */
  const clockElapsedText = (c) => {
    const parts = [];
    if (c.state === 'none') return '<span class="muted">開始時刻か「経過を計り始める」で経過を表示</span>';
    if (c.state === 'before') {
      // 当日より前なら日数、当日なら開始までの時間
      parts.push(c.days >= 1
        ? `<span class="ck-day">${U.md(c.base)} ${U.time(c.base)} 開始</span> あと <b>${c.days}日</b>`
        : `開始まで <b>${U.span(c.base - c.now)}</b>`);
      if (c.end && c.days < 1) parts.push(`<span class="ck-eta">${U.time(c.end)} 終了</span>`);
      return parts.join(' ');
    }
    if (c.state === 'after') {
      // 開催日が分かっているときだけ「終了」と言い切る（日付未設定なら単に今日の時間帯を過ぎただけ）
      return c.date
        ? `<span class="ck-day">${U.md(c.base)} 終了</span> <span class="ck-eta">記録は残っています</span>`
        : `<span class="muted">開催日を設定すると、当日の経過時間と残り時間が表示されます</span>`;
    }
    parts.push(`経過 <b>${U.span(c.elapsed)}</b>`);
    if (c.left > 0) parts.push(`<span class="ck-left">終了まで <b>${U.span(c.left)}</b></span>`);
    if (c.perLeft) parts.push(`<span class="ck-eta">未訪問1件あたり ${Math.max(1, Math.round(c.perLeft / 60000))}分</span>`);
    else if (c.eta) parts.push(`<span class="ck-eta">このペースなら ${U.time(c.eta)} ごろ</span>`);
    return parts.join(' ');
  };
  /** 1秒ごとの更新（文字の差し替えだけ） */
  V.tickClock = () => {
    const dn = U.$('#demo-now');
    if (dn) dn.textContent = U.clockTime(S().now());
    const el = U.$('#ck-now');
    if (!el) return !!dn;
    const c = S().clock();
    el.textContent = U.clockTime(c.now);
    const e2 = U.$('#ck-el');
    if (e2) e2.innerHTML = e2.dataset.day ? dayElapsedText(c) : clockElapsedText(c);
    return true;
  };

  V.qrow = (cid, badge) => {
    const s = S();
    const e = s.entry(cid);
    const c = s.circle(cid) || e.snap;
    const cost = e.status === 'done' ? s.entrySpent(e) : s.entryPlanned(e);
    return `<li class="qrow p${e.pri} st-${e.status}">
      <button data-act="focus" data-cid="${cid}">
        <span class="qn">${badge}</span>${V.space(c)}<span class="qname">${esc(c.name)}</span>
        <span class="qcost">${cost ? U.yen(cost) : ''}</span>
      </button></li>`;
  };

  /** 並んでいる間に用意しておく金種（当日カード）。金種を入れていないときは何も出さない */
  V.payReady = (amount) => {
    const s = S();
    if (!s.hasCashBreak() || !(amount > 0) || amount > 200000) return '';
    const plan = s.payPlan(amount);
    if (!plan) return '';
    if (plan.short) return `<div class="pay-ready short">${U.icon('warn', 'sm')}現金があと ${U.yen(amount - s.cashTotal())} 足りません</div>`;
    const b = plan.best;
    const coins = s.DENOMS.filter((d) => b.use[d]).map((d) => `<span>${U.num(d)}<small>×${b.use[d]}</small></span>`).join('');
    return `<div class="pay-ready">${U.icon('wallet', 'sm')}<span class="pr-l">用意する現金</span>
      <div class="ph-coins">${coins}</div>
      <b>${b.exact ? 'ちょうど' : `おつり ${U.yen(b.change)}`}</b></div>`;
  };

  V.currentCard = (cid, q) => {
    const s = S();
    const d = s.d();
    const e = d.entries[cid];
    const c = s.circle(cid) || { ...e.snap, block: (e.snap.space || '?')[0] };
    const idx = [...q.todo, ...q.later].indexOf(cid);
    const near = s.nearby(cid, 3);
    const planned = s.entryPlanned(e), spent = s.entrySpent(e);
    const hasTodo = e.items.some((i) => i.status === 'todo');
    const items = V.itemRows(cid, e);
    return V.curCardBody(cid, q, e, c, idx, near, planned, spent, hasTodo, items);
  };

  /** 当日カードの品物の行（通常・当日モード共通） */
  V.itemRows = (cid, e) => e.items.map((i) => `
      <li class="item it-${i.status}${i.planned === false ? ' extra' : ''}">
        <button class="item-main" data-act="toggleItem" data-cid="${cid}" data-iid="${i.id}">
          <span class="cb">${i.status === 'bought' ? U.icon('check') : i.status === 'soldout' ? '売' : i.status === 'skip' ? '－' : ''}</span>
          <span class="nm">${esc(i.name || '（無題）')}${i.planned === false ? '<small>追加</small>' : ''}</span>
          <span class="pr">${i.status === 'bought' && i.paid != null ? U.yen(i.paid) : priceTxt(i)}</span>
        </button>
        <button class="icon-btn" data-act="itemMenu" data-cid="${cid}" data-iid="${i.id}" aria-label="この品物の操作">${U.icon('more')}</button>
      </li>`).join('');

  V.curCardBody = (cid, q, e, c, idx, near, planned, spent, hasTodo, items) => {
    const s = S();
    const d = s.d();
    // 直前に完了して切り替わったところなら、しばらく押せないようにする（連打の保険）
    const enter = HC.app.curGuard && Date.now() < HC.app.curGuard ? ' enter' : '';
    return `<section class="card cur p${e.pri} st-${e.status}${enter}">
      <div class="cur-top">
        <span class="order">${idx >= 0 ? `残り${q.todo.length + q.later.length}件の${idx + 1}件目` : ''}</span>${V.pri(e.pri)}${V.status(e.status)}
        ${s.isWall(cid) ? '<span class="tag wall">壁</span>' : ''}
        <span class="grow"></span>
        <button class="icon-btn" data-act="showOnMap" data-cid="${cid}" aria-label="地図で見る">${U.icon('map')}</button>
        <button class="icon-btn" data-act="openCircle" data-cid="${cid}" aria-label="編集">${U.icon('edit')}</button>
      </div>
      <button class="cur-space" data-act="showOnMap" data-cid="${cid}">${V.space(c, 'xl')}</button>
      <div class="cur-name">${esc(c.name)}</div>
      <div class="cur-links">${V.links(c, e)}</div>
      ${V.shots(cid)}
      ${e.memo ? `<div class="cur-memo">${esc(e.memo).replace(/\n/g, '<br>')}</div>` : ''}
      ${e.items.length ? `<ul class="items">${items}</ul>`
        : (s.isPending(e)
          ? `<p class="cur-pend">${U.icon('clock', 'sm')}お品書き待ち。買ったものはこの場で記録できます</p>`
          : '<p class="muted small">買うものは登録していません</p>')}
      <button class="add-extra" data-act="extraBuy" data-cid="${cid}">${U.icon('plus')}追加で買ったものを記録</button>
      ${near.length ? `<div class="near"><span class="near-l">${U.icon('compass', 'sm')}この近く</span>
        ${near.map((x) => {
          const nc = s.circle(x.cid) || d.entries[x.cid].snap;
          return `<button class="near-chip" data-act="openCircle" data-cid="${x.cid}">${V.space(nc)}<span>${esc(nc.name)}</span></button>`;
        }).join('')}</div>` : ''}
      <button class="cur-memo-add" data-act="editMemo" data-cid="${cid}">${U.icon('note', 'sm')}${e.memo ? 'メモを書き直す' : 'その場でメモ'}</button>
      ${V.payReady(planned - spent)}
      <div class="cur-sum"><span>予定 ${U.yen(planned)}</span><span>支払 <b>${U.yen(spent)}</b></span></div>
      ${hasTodo || !e.items.length
        ? `<button class="btn primary xl block" data-act="completeAll" data-cid="${cid}">${U.icon('check')}${e.items.length ? `全部買えた${U.icon('right', 'sm')}次へ` : '金額を入れて完了'}</button>`
        : `<button class="btn primary xl block" data-act="setStatus" data-st="done" data-cid="${cid}">${U.icon('check')}完了${U.icon('right', 'sm')}次へ</button>`}
      <div class="btn-grid3">
        <button class="btn" data-act="setStatus" data-st="soldout" data-cid="${cid}">${U.icon('ban')}売り切れ</button>
        <button class="btn" data-act="setStatus" data-st="later" data-cid="${cid}">${U.icon('clock')}あとで</button>
        <button class="btn" data-act="setStatus" data-st="skip" data-cid="${cid}">${U.icon('skip')}見送り</button>
      </div>
    </section>`;
  };

  // ------------------------------------------------------------------ リスト（計画）
  V.list = {
    filter: 'all',
    render(el) {
      const s = S();
      const d = s.d();
      const st = s.stats();
      const f = this.filter;
      const noimg = s.noShotCids();
      const noimgSet = new Set(noimg);
      const rows = d.order.filter((cid) => {
        const e = d.entries[cid];
        if (!e) return false;
        if (f === 'todo') return e.status === 'todo' || e.status === 'later';
        if (f === 'done') return !(e.status === 'todo' || e.status === 'later');
        if (f === 'must') return e.pri === 1;
        if (f === 'pend') return s.isPending(e);
        if (f === 'noimg') return noimgSet.has(cid);
        return true;
      });
      const mustTotal = U.sum(Object.values(d.entries).filter((e) => e.pri === 1), (e) => s.entryPlanned(e));
      const diff = st.usable - st.plannedTotal - U.sum(d.extras, (x) => x.cost);
      const pend = s.pendingCids();
      let html = `<section class="card plan-sum">
        <div><span>サークル</span><b>${Object.keys(d.entries).length}</b></div>
        <div><span>予定合計</span><b>${U.yen(st.plannedTotal)}</b></div>
        <div><span>うち必須</span><b>${U.yen(mustTotal)}</b></div>
        ${st.budget ? `<div><span>予算との差</span><b class="${diff < 0 ? 'neg' : 'pos'}">${diff >= 0 ? '+' : ''}${U.yen(diff)}</b></div>` : `<div><button class="link-btn" data-act="budgetEdit">予算を設定</button></div>`}
      </section>
      ${V.pending(pend)}
      ${V.noShot(noimg)}
      ${V.sim()}
      <div class="toolbar">
        <div class="seg sm">${[['all', '全部'], ['todo', '未完了'], ['must', '必須'], ['pend', `待ち${pend.length ? ' ' + pend.length : ''}`], ...(HC.shots && HC.shots.ready ? [['noimg', `画像なし${noimg.length ? ' ' + noimg.length : ''}`]] : []), ['done', '完了']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-act="listFilter" data-f="${k}">${l}</button>`).join('')}</div>
        <span class="grow"></span>
        <button class="btn sm primary" data-act="routeMenu">${U.icon('route')}ルート作成</button>
      </div>`;
      if (!d.order.length) {
        html += emptyState('list', '計画は空っぽです', '「サークル」タブで欲しいサークルの「＋」を押すと追加されます。PCで作って、スマホに送るのがおすすめ。',
          `<button class="btn primary" data-act="nav" data-view="circles">${U.icon('search')}サークルを探す</button>`);
      } else if (!rows.length) {
        html += `<p class="muted center pad">該当するサークルはありません</p>`;
      } else {
        const canDrag = f === 'all';
        html += `<ol class="plist ${canDrag ? 'draggable' : ''}">${rows.map((cid) => V.prow(cid, d.order.indexOf(cid) + 1, canDrag)).join('')}</ol>
        ${canDrag ? '<p class="muted small center">左端のつまみをドラッグで並べ替え（PCはマウスでもOK）</p>' : ''}`;
      }
      el.innerHTML = `<div class="list-view">${html}</div>`;
    },
  };

  // まとめカードのサークル一覧。多いときは14件までにして、押すとカードの中で全部を広げる
  const CHIP_MAX = 14;
  V.chipOpen = {};   // { noimg: true, pend: true } 広げているカード
  V.chipList = (cids, k) => (V.chipOpen[k] ? cids : cids.slice(0, CHIP_MAX));
  V.chipMore = (cids, k) => {
    if (cids.length <= CHIP_MAX) return '';
    return V.chipOpen[k]
      ? `<button class="link-btn" data-act="chipMore" data-k="${k}">${U.icon('up', 'sm')}たたむ</button>`
      : `<button class="link-btn" data-act="chipMore" data-k="${k}">${U.icon('down', 'sm')}残り${cids.length - CHIP_MAX}件も表示</button>`;
  };

  /**
   * お品書き画像をまだ登録していないサークルのまとめ（当日は圏外でも画像を見たいので、出かける前に埋めておく）
   */
  V.noShot = (cids) => {
    if (!cids || !cids.length) return '';
    const s = S();
    const chips = V.chipList(cids, 'noimg').map((cid) => {
      const c = s.circle(cid) || s.entry(cid).snap;
      return `<button class="pend-chip img" data-act="openCircle" data-cid="${esc(cid)}">${V.space(c)}<span>${esc(c.name)}</span></button>`;
    }).join('');
    const pc = matchMedia('(pointer: fine)').matches;
    return `<section class="card pend-card img-card" id="sec-noimg">
      <h3>${U.icon('image')}お品書き画像が未登録 <small>${cids.length}サークル</small></h3>
      <p class="muted small">お品書き画像をまだ登録していないサークルです。サークルを開いて画像を追加してください。${pc ? 'PCでは、画像をコピーして Ctrl+V で貼り付けることもできます。' : ''}登録した画像は、当日圏外でも見られます。</p>
      <div class="pend-list">${chips}</div>
      ${V.chipMore(cids, 'noimg')}
    </section>`;
  };

  /**
   * お品書きがまだ出ていないサークルのまとめ。
   * 公開されたらここから開いて買うものを登録する、という使い方を想定している
   */
  V.pending = (cids) => {
    if (!cids || !cids.length) return '';
    const s = S();
    const chips = V.chipList(cids, 'pend').map((cid) => {
      const c = s.circle(cid) || s.entry(cid).snap;
      return `<button class="pend-chip" data-act="openCircle" data-cid="${esc(cid)}">${V.space(c)}<span>${esc(c.name)}</span></button>`;
    }).join('');
    return `<section class="card pend-card" id="sec-pend">
      <h3>${U.icon('clock')}お品書き待ち <small>${cids.length}サークル</small></h3>
      <p class="muted small">買うものをまだ登録していないサークルです。お品書きが公開されたら、サークルを開いて買うものを登録してください。登録するまでは予定の合計に含まれません。</p>
      <div class="pend-list">${chips}</div>
      ${V.chipMore(cids, 'pend')}
    </section>`;
  };

  /**
   * 予算の試算表。「必須だけ／優先まで／通常まで／全部」で、
   * いくらになるか・予算と現金がいくら残るかを並べて見せる
   */
  V.sim = () => {
    const s = S();
    const d = s.d();
    if (!Object.keys(d.entries).length) return '';
    const sim = s.simulate();
    const hasBudget = sim.usable > 0;
    const hasCash = sim.cash > 0;
    const money = (v, invert) => `<b class="${v == null ? '' : (invert ? (v < 0 ? 'neg' : 'pos') : '')}">${v == null ? '—' : U.yen(v)}</b>`;
    // その優先度のサークルが1件も無い段は、同じ数字が並ぶだけなので出さない
    const shown = sim.rows.filter((r, i) => r.count > 0 || i === 0 || r.tier === sim.fitTier);
    const rows = (shown.length ? shown : sim.rows.slice(0, 1)).map((r) => `
      <tr class="${r.tier === sim.fitTier ? 'fit' : ''}${r.cumCount === 0 ? ' none' : ''}">
        <td class="lb">${r.tier === sim.fitTier ? U.icon('check', 'sm') : ''}${esc(r.label)}<small>${r.cumCount}サークル</small></td>
        <td class="mo">${U.yen(r.total)}</td>
        ${hasBudget ? `<td class="mo">${money(r.budgetLeft, true)}</td>` : ''}
        ${hasCash ? `<td class="mo">${money(r.cashLeft, true)}</td>` : ''}
      </tr>`).join('');
    const last = sim.rows[3];
    const pend = s.pendingCids().length;
    const fit = sim.fitTier ? sim.rows[sim.fitTier - 1] : null;
    const notes = [];
    if (sim.spent) notes.push(`合計には支払い済みの ${U.yen(sim.spent)}${sim.extras ? `（うちサークル外 ${U.yen(sim.extras)}）` : ''} を含みます。`);
    if (last.unknown) notes.push(`価格未定が ${last.unknown}件。平均 ${U.yen(sim.avg)} とみて <b>${U.yen(last.unknownEst)}</b> ほど増える見込みです。`);
    if (pend) notes.push(`<b class="pend-ink">お品書き待ちが ${pend}サークル。決まればここに乗ります。</b>`);
    if (!hasBudget) notes.push('<button class="link-btn" data-act="budgetEdit">予算を設定すると、残りも表示されます</button>');
    else if (!fit) notes.push('<b class="neg">必須だけでも予算を超えます。</b>');
    else if (fit.cumCount >= last.cumCount) notes.push('<b class="pos">計画を全部買っても予算に収まります。</b>');
    else notes.push(`予算に収まるのは <b>${esc(fit.label)}</b> までです。`);
    return `<section class="card sim" id="sec-sim">
      <h3>${U.icon('yen')}予算の見通し <small>優先度の高い順に足していった場合</small></h3>
      <table class="simtable">
        <thead><tr><th>どこまで買うか</th><th>合計</th>${hasBudget ? '<th>予算の残り</th>' : ''}${hasCash ? '<th>現金の残り</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small">${notes.join(' ')}</p>
    </section>`;
  };

  /** 地図の区間ナビ（◀ 3/12 G23 → G24 ▶）。inst.segIndex が null なら隠す */
  V.mapSeg = () => {
    const el = U.$('#mapseg');
    if (!el) return;
    const inst = V.map.inst;
    if (!inst || inst.segIndex == null) { el.hidden = true; el.innerHTML = ''; return; }
    const legs = inst.legs();
    if (!legs.length) { el.hidden = true; el.innerHTML = ''; inst.segIndex = null; inst.paint(); return; }   // 全部回り終えたら区間表示はやめる
    const i = Math.min(inst.segIndex, legs.length - 1);
    if (i !== inst.segIndex) { inst.segIndex = i; inst.paint(); }   // 完了で区間が減ったぶんを詰める
    const leg = legs[i];
    const e = S().entry(leg.cid);
    el.hidden = false;
    el.innerHTML = `
      <button class="icon-btn solid" data-act="mapSegMove" data-d="-1" aria-label="前の区間"${i === 0 ? ' disabled' : ''}>${U.icon('up')}</button>
      <button class="seg-body" data-act="openCircle" data-cid="${esc(leg.cid)}">
        <span class="seg-no">${i + 1}/${legs.length}</span>
        <span class="seg-route">${esc(leg.fromName || 'スタート')} ${U.icon('right', 'sm')} <b>${esc(leg.toName)}</b></span>
        <span class="seg-name">${esc(leg.toCircle.name)}${e ? ' ' + V.pri(e.pri) : ''}</span>
      </button>
      <button class="icon-btn solid" data-act="mapSegMove" data-d="1" aria-label="次の区間"${i === legs.length - 1 ? ' disabled' : ''}>${U.icon('down')}</button>
      <button class="icon-btn solid" data-act="mapSegOff" aria-label="全体を見る">${U.icon('fit')}</button>`;
  };

  /** リストの行に出す画像の印（あれば枚数、無ければ「画像なし」） */
  V.shotMark = (cid, e) => {
    const Sh = HC.shots;
    if (!Sh || !Sh.ready) return '';
    const n = Sh.list(S().state.eventId, cid).length;
    if (n) return ` ・ <span class="shot-n">${U.icon('image', 'sm')}${n}</span>`;
    if (e.noShot || !(e.status === 'todo' || e.status === 'later')) return '';
    return ` ・ <span class="noimg">${U.icon('image', 'sm')}画像なし</span>`;
  };

  V.prow = (cid, n, canDrag) => {
    const s = S();
    const e = s.entry(cid);
    const c = s.circle(cid) || e.snap;
    const planned = s.entryPlanned(e), spent = s.entrySpent(e);
    const unknown = e.items.filter((i) => S().isUnknown(i) && i.status === 'todo').length;
    const money = e.status === 'done' || spent ? `<b>${U.yen(spent)}</b>${planned && planned !== spent ? `<small>/${U.yen(planned)}</small>` : ''}` : `${U.yen(planned)}${unknown ? '<small>+?</small>' : ''}`;
    return `<li class="prow p${e.pri} st-${e.status}" data-cid="${cid}">
      ${canDrag ? `<span class="drag" aria-label="ドラッグして並べ替え">${U.icon('grip')}</span>` : ''}
      <span class="ord">${n}</span>
      <button class="prow-main" data-act="openCircle" data-cid="${cid}">
        <span class="l1">${V.space(c)}<span class="nm">${esc(c.name)}</span></span>
        <span class="l2">${s.isPending(e)
          ? `<span class="pend">${U.icon('clock', 'sm')}お品書き待ち</span>`
          : (e.items.length ? esc(itemNames(e)) : '<i>買うもの未登録</i>')}${e.memo ? ` ・ ${U.icon('note', 'sm')}` : ''}${V.shotMark(cid, e)}</span>
      </button>
      <span class="prow-side">
        <button class="pri-btn" data-act="priMenu" data-cid="${cid}">${V.pri(e.pri)}</button>
        <span class="money">${money}</span>
        ${V.status(e.status)}
      </span>
    </li>`;
  };

  // ------------------------------------------------------------------ サークル一覧
  V.circles = {
    q: '',
    f: 'all',
    mounted: false,
    render(el) {
      const s = S();
      const ev = s.ev();
      if (!this.mounted || el.dataset.ev !== ev.id) {
        el.dataset.ev = ev.id;
        el.innerHTML = `<div class="circles-view">
          <div class="search-bar">
            <div class="search-box">${U.icon('search')}<input id="csearch" type="search" placeholder="サークル名・スペース(G23・24)・メモ" autocomplete="off" value="${esc(this.q)}" enterkeyhint="search"><button class="icon-btn clear" data-act="clearSearch" aria-label="クリア">${U.icon('x')}</button></div>
            <div class="chips scroll" id="cfilters"></div>
          </div>
          <div id="clist" class="clist"></div>
          <div class="clist-foot"><button class="btn ghost" data-act="addCircleManual">${U.icon('plus')}一覧にないサークルを手動追加</button></div>
        </div>`;
        const inp = U.$('#csearch', el);
        const re = U.debounce(() => { this.q = inp.value; this.renderList(); }, 90);
        inp.addEventListener('input', re);
        this.mounted = true;
      }
      this.renderFilters();
      this.renderList();
    },
    renderFilters() {
      const s = S();
      const ev = s.ev();
      const f = this.f;
      const d = s.d();
      const chip = (k, label) => `<button class="chip ${f === k ? 'on' : ''}" data-act="cfilter" data-f="${k}">${label}</button>`;
      U.$('#cfilters').innerHTML = [
        chip('all', 'すべて'),
        chip('plan', `${U.icon('star', 'sm')}計画中 ${Object.keys(d.entries).length}`),
        chip('fav', `${U.icon('heart', 'sm')}お気に入り`),
        chip('hist', '前回購入'),
        ...ev.blocks.map((b) => chip('b:' + b, b)),
      ].join('');
    },
    matches() {
      const s = S();
      const ev = s.ev();
      const d = s.d();
      const q = this.q.trim();
      const nq = U.norm(q);
      const sq = P.parseSpaceQuery(q);     // 「G23」「g 23」
      const numQ = P.parseNumQuery(q);     // 「24」「23-24」＝番号だけ
      const idQ = /^[@＠]/.test(q) ? U.toHalf(q).slice(1).toLowerCase() : ''; // 「@id」と書いたときだけID検索
      const f = this.f;
      return ev.circles.filter((c) => {
        const e = d.entries[c.id];
        if (f === 'plan' && !e) return false;
        if (f === 'fav' && !s.isFav(c)) return false;
        if (f === 'hist' && !s.historyOf(c).length) return false;
        if (f.startsWith('b:') && c.block !== f.slice(2)) return false;
        if (!q) return true;
        // 「@id」と書いたときだけ X の ID を探す（ふだんは ID を引っかけない）
        if (idQ) return !!(c.tw && c.tw.toLowerCase().includes(idQ));
        if (sq) return c.block === sq.block && (c.nums.includes(sq.num) || String(c.nums[0]).startsWith(String(sq.num)));
        // 数字だけのときはスペース番号。24 なら A24・N24… をブロック横断で出す
        if (numQ) return c.nums.some((n) => n >= numQ.from && n <= numQ.to);
        if (U.norm(c.name).includes(nq)) return true;
        if (U.norm(c.space) === nq) return true;
        if (e && (U.norm(e.memo).includes(nq) || e.items.some((i) => U.norm(i.name).includes(nq)))) return true;
        if (c.tw && c.tw.toLowerCase().includes(nq)) return true; // 名前で見つからないときの保険
        return false;
      });
    },
    renderList() {
      const s = S();
      const list = this.matches();
      const d = s.d();
      const grouped = !this.q.trim() && (this.f === 'all');
      let last = '';
      const out = [];
      list.forEach((c) => {
        if (grouped && c.block !== last) {
          last = c.block;
          out.push(`<div class="cgroup">${esc(c.block)}<small>${s.isWall(c.id) ? '壁' : ''}</small></div>`);
        }
        const e = d.entries[c.id];
        const hist = s.historyOf(c);
        const fav = s.isFav(c);
        const sub = [
          c.tw ? `@${esc(c.tw)}` : '',
          fav ? `<span class="fav">${U.icon('heart', 'sm')}</span>` : '',
          hist.length ? `<span class="hist">${hist.map((h) => `${esc(h.event)}${h.spent ? ' ' + U.yen(h.spent) : ''}`).join(' / ')}</span>` : '',
          e && s.isPending(e) ? `<span class="pend">${U.icon('clock', 'sm')}お品書き待ち</span>`
            : (e && e.items.length ? `<span class="it">${esc(itemNames(e))}</span>` : ''),
        ].filter(Boolean).join(' ・ ');
        out.push(`<div class="crow ${e ? `planned p${e.pri} st-${e.status}` : ''}">
          <button class="crow-main" data-act="openCircle" data-cid="${c.id}">${V.space(c)}<span class="crow-text"><span class="nm">${esc(c.name)}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</span></button>
          <button class="add-btn ${e ? 'on' : ''}" data-act="quickAdd" data-cid="${c.id}" aria-label="${e ? '編集' : '計画に追加'}">${e ? V.pri(e.pri) : U.icon('plus')}</button>
        </div>`);
      });
      const el = U.$('#clist');
      el.innerHTML = out.length ? out.join('') : `<p class="muted center pad">見つかりませんでした${this.q ? `<br><button class="btn sm" data-act="addCircleManual" data-name="${esc(this.q)}">「${esc(this.q)}」を手動追加</button>` : ''}</p>`;
      el.dataset.count = list.length;
    },
  };

  // ------------------------------------------------------------------ サークル詳細（シート）
  V.circleSheet = (cid) => {
    const s = S();
    const c = s.circle(cid);
    if (!c) return '<p>サークルが見つかりません</p>';
    const e = s.entry(cid);
    const hist = s.historyOf(c);
    const fav = s.isFav(c);
    let html = `<div class="cd">
      <div class="cd-head">
        ${V.space(c, 'xl')}
        <div class="cd-name">${esc(c.name)}${c.added ? '<small class="tag">手動追加</small>' : ''}</div>
        <div class="cd-links">${V.links(c, e)}
          <button class="link-chip fav-btn ${fav ? 'on' : ''}" data-act="fav" data-cid="${cid}">${U.icon('heart')}${fav ? 'お気に入り' : 'お気に入り登録'}</button>
        </div>
        ${hist.length ? `<div class="cd-hist">${U.icon('clock')}${hist.map((h) => `${esc(h.event)}：${h.spent ? U.yen(h.spent) + ' 購入' : s.STATUS[h.status]?.label || ''}`).join(' ／ ')}</div>` : ''}
      </div>`;
    if (!e) {
      html += `<div class="field"><label>計画に追加（優先度を選ぶ）</label>
        <div class="pri-pick">${[1, 2, 3, 4].map((p) => `<button class="pri-big p${p}" data-act="addPlan" data-cid="${cid}" data-pri="${p}"><b>${s.PRI[p].label}</b><small>${['絶対に買う', 'できれば買う', '余裕があれば', '見るだけ・予備'][p - 1]}</small></button>`).join('')}</div></div>
        <div class="cd-actions"><button class="btn" data-act="showOnMap" data-cid="${cid}">${U.icon('map')}地図で見る</button></div>`;
      return html + '</div>';
    }
    const planned = s.entryPlanned(e), spent = s.entrySpent(e);
    html += `
      <div class="field"><label>優先度</label>
        <div class="seg pri-seg">${[1, 2, 3, 4].map((p) => `<button class="p${p} ${e.pri === p ? 'on' : ''}" data-act="setPri" data-cid="${cid}" data-pri="${p}">${s.PRI[p].label}</button>`).join('')}</div></div>
      ${s.isPending(e) ? `<div class="pend-note">${U.icon('clock', 'sm')}
        <div><b>お品書き待ち</b><small>お品書きが公開されたら、下の「買うもの」に登録してください。登録するまでは予定の合計に含まれません。</small></div>
        <button class="btn sm ghost" data-act="noItems" data-cid="${cid}" data-on="1">登録しない</button></div>`
        : (e.noItems ? `<div class="pend-note done">${U.icon('check', 'sm')}
        <div><b>このサークルは買うものを登録しない設定です</b><small>お品書き待ちの一覧には出ません。</small></div>
        <button class="btn sm ghost" data-act="noItems" data-cid="${cid}" data-on="0">戻す</button></div>` : '')}
      <div class="field"><label>買うもの <small class="cd-sum">予定 ${U.yen(planned)}${spent ? ` ・ 支払済 ${U.yen(spent)}` : ''}</small></label>
        <div class="ie-list">${e.items.map((i) => `
          <div class="ie-row it-${i.status}${i.planned === false ? ' extra' : ''}">
            <input class="input ie-name" data-f="iname" data-cid="${cid}" data-iid="${i.id}" value="${esc(i.name)}" placeholder="品名" enterkeyhint="next">
            <div class="ie-price"><span>¥</span><input class="input" data-f="iprice" data-cid="${cid}" data-iid="${i.id}" value="${i.price || ''}" inputmode="numeric" placeholder="価格" enterkeyhint="done"></div>
            <div class="stepper sm"><button class="icon-btn" data-act="qty" data-cid="${cid}" data-iid="${i.id}" data-d="-1">${U.icon('minus', 'sm')}</button><b>${i.qty}</b><button class="icon-btn" data-act="qty" data-cid="${cid}" data-iid="${i.id}" data-d="1">${U.icon('plus', 'sm')}</button></div>
            <button class="icon-btn" data-act="itemMenu" data-cid="${cid}" data-iid="${i.id}" aria-label="操作">${U.icon('more')}</button>
            ${i.status !== 'todo' ? `<div class="ie-st">${i.status === 'bought' ? `購入済 ${U.yen(s.itemCost(i))}${i.t ? ' ' + U.time(i.t) : ''}` : s.STATUS[i.status === 'soldout' ? 'soldout' : 'skip'].label}</div>` : ''}
          </div>`).join('')}
        </div>
        <div class="chips wrap">${s.ITEM_PRESETS.map((p) => {
          const hint = s.priceHint(p);
          return `<button class="chip sm" data-act="addItem" data-cid="${cid}" data-name="${esc(p)}">${U.icon('plus', 'sm')}${esc(p)}${hint ? `<small>${U.yen(hint)}</small>` : ''}</button>`;
        }).join('')}<button class="chip sm" data-act="addItem" data-cid="${cid}" data-name="">${U.icon('plus', 'sm')}自由入力</button>
        <button class="chip sm ghost" data-act="bulkItems" data-cid="${cid}">${U.icon('note', 'sm')}まとめて登録</button></div>
      </div>
      <div class="field"><label>メモ <small>（売切れ注意・特典・列の様子など）</small></label>
        <textarea class="input" rows="2" data-f="memo" data-cid="${cid}" placeholder="例：新刊は午前中に完売しがち／セット特典あり">${esc(e.memo)}</textarea></div>
      <div class="field"><label>お品書きURL</label>
        <input class="input" type="url" data-f="menu" data-cid="${cid}" value="${esc(e.menu)}" placeholder="https://x.com/..."></div>
      ${HC.shots && HC.shots.ready ? `<div class="field"><label>お品書きの画像 <small>（端末に保存。当日オフラインでも見られます）</small></label>
        ${!HC.shots.has(s.state.eventId, cid) && !e.noShot ? `<div class="pend-note img">${U.icon('image', 'sm')}
          <div><b>お品書き画像が未登録です</b><small>「画像を追加」から登録してください。お品書きが無いサークルは「登録しない」にすると、未登録の一覧から外れます。</small></div>
          <button class="btn sm ghost" data-act="noShot" data-cid="${cid}" data-on="1">登録しない</button></div>`
          : (e.noShot ? `<div class="pend-note done">${U.icon('check', 'sm')}
          <div><b>このサークルは画像を登録しない設定です</b><small>画像が未登録の一覧には出ません。</small></div>
          <button class="btn sm ghost" data-act="noShot" data-cid="${cid}" data-on="0">戻す</button></div>` : '')}
        ${V.shots(cid, { add: true })}
        <p class="shot-tip muted small">${U.icon('image', 'sm')}画像をコピーして <kbd>Ctrl</kbd>+<kbd>V</kbd> で貼り付けるか、画像ファイルをここへドロップしても追加できます。${HC.sync.configured() ? 'スマホへは「設定 → 同期 → 画像を送る」で送れます。' : ''}</p></div>` : ''}
      <div class="field"><label>当日の状態</label>
        <div class="seg st-seg">${['todo', 'later', 'done', 'soldout', 'skip'].map((k) => `<button class="${e.status === k ? 'on' : ''}" data-act="setStatus" data-st="${k}" data-cid="${cid}" data-keep="1">${s.STATUS[k].label}</button>`).join('')}</div></div>
      <div class="cd-actions">
        <button class="btn" data-act="showOnMap" data-cid="${cid}">${U.icon('map')}地図で見る</button>
        <button class="btn" data-act="goNow" data-cid="${cid}">${U.icon('go')}次にここへ行く</button>
        <button class="btn" data-act="move" data-cid="${cid}" data-d="-1" aria-label="順番を上へ">${U.icon('up')}</button>
        <button class="btn" data-act="move" data-cid="${cid}" data-d="1" aria-label="順番を下へ">${U.icon('down')}</button>
        <button class="btn danger ghost" data-act="removePlan" data-cid="${cid}">${U.icon('trash')}計画から外す</button>
      </div>
    </div>`;
    return html;
  };

  // ------------------------------------------------------------------ マップ
  V.map = {
    inst: null,
    sel: null,
    render(el) {
      const s = S();
      if (!this.inst || !el.contains(this.inst.container)) {
        el.innerHTML = `<div class="map-view">
          <div class="map-box" id="mapbox"></div>
          <div class="map-ctrl">
            <button class="icon-btn solid" data-act="mapNext" title="次の目的地">${U.icon('target')}</button>
            <button class="icon-btn solid" data-act="mapZoom" data-k="1.6" title="拡大">${U.icon('plus')}</button>
            <button class="icon-btn solid" data-act="mapZoom" data-k="0.625" title="縮小"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
            <button class="icon-btn solid" data-act="mapFit" title="全体">${U.icon('fit')}</button>
            <button class="icon-btn solid" data-act="mapSeg" title="区間ごとに見る">${U.icon('right')}</button>
            <button class="icon-btn solid" data-act="mapRoute" title="ルート線">${U.icon('route')}</button>
            <button class="icon-btn solid" data-act="mapImage" title="公式配置図に切替">${U.icon('image')}</button>
          </div>
          <div class="map-legend"><span class="lg p1">必須</span><span class="lg p2">優先</span><span class="lg p3">通常</span><span class="lg p4">余裕</span><span class="lg done">済</span><span class="lg next">次</span></div>
          <button class="route-off" id="route-off" data-act="mapRoute" hidden>${U.icon('route', 'sm')}ルート線は非表示です。押すと表示します</button>
          <div class="map-seg" id="mapseg" hidden></div>
          <div class="map-card" id="mapcard" hidden></div>
        </div>`;
        this.inst = HC.map.mount(U.$('#mapbox', el), {
          onTap: (cid) => { this.select(cid); },
        });
      } else if (this.inst.evId !== s.state.eventId) {
        this.sel = null;
        this.inst.build();
      } else {
        this.inst.paint();
      }
      U.$$('.map-ctrl [data-act="mapRoute"]', el).forEach((b) => b.classList.toggle('on', s.state.settings.showRoute));
      const off = U.$('#route-off', el);
      if (off) off.hidden = !!s.state.settings.showRoute || !s.queue().todo.length && !s.queue().later.length;
      U.$$('[data-act="mapImage"]', el).forEach((b) => {
        b.classList.toggle('on', s.state.settings.mapMode === 'image');
        b.hidden = !s.ev().layout.image;
      });
      V.mapSeg();   // 回り終えたぶん区間が減っていることがあるので、ここでも合わせる
      this.renderCard();
    },
    select(cid) {
      this.sel = cid;
      if (this.inst) this.inst.select(cid);
      this.renderCard();
    },
    renderCard() {
      const card = U.$('#mapcard');
      if (!card) return;
      const s = S();
      const cid = this.sel;
      const c = cid && s.circle(cid);
      if (!c) { card.hidden = true; return; }
      const e = s.entry(cid);
      card.hidden = false;
      card.innerHTML = `
        <div class="mc-head">${V.space(c, 'lg')}<div class="mc-name">${esc(c.name)}<div class="mc-sub">${e ? `${V.pri(e.pri)} ${V.status(e.status)} ${e.items.length ? esc(itemNames(e)) : ''}` : c.tw ? '@' + esc(c.tw) : ''}</div></div>
        <button class="icon-btn" data-act="mapClose" aria-label="閉じる">${U.icon('x')}</button></div>
        <div class="mc-actions">
          <button class="btn sm" data-act="openCircle" data-cid="${cid}">${U.icon('edit')}詳細</button>
          ${e ? `<button class="btn sm primary" data-act="goNow" data-cid="${cid}">${U.icon('go')}次にここへ</button>`
            : `<button class="btn sm primary" data-act="addPlan" data-cid="${cid}" data-pri="3">${U.icon('plus')}計画に追加</button>`}
          ${e ? '' : `<button class="btn sm" data-act="addPlan" data-cid="${cid}" data-pri="1">必須で追加</button>`}
        </div>`;
    },
  };

  // ------------------------------------------------------------------ その他（設定・データ・記録）
  V.more = {
    full: false,   // 当日モードで「すべての設定」を開いているか
    render(el) {
      if (S().state.settings.dayMode && !this.full) return V.dayMenu(el);
      const s = S();
      const ev = s.ev();
      const d = s.d();
      const set = s.state.settings;
      const st = s.stats();
      const L = ev.layout;
      const seg = (key, opts) => `<div class="seg sm">${opts.map(([v, l]) => `<button class="${String(set[key]) === String(v) ? 'on' : ''}" data-act="setting" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
      const toggle = (key, label, hint) => `<label class="toggle-row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" data-f="setting" data-k="${key}" ${set[key] ? 'checked' : ''}><i></i></label>`;
      const log = s.log();
      const custom = s.state.customEvents[ev.id];

      el.innerHTML = `<div class="more-view">
        ${set.dayMode ? `<div class="btn-row"><button class="btn" data-act="fullSettingsOff">${U.icon('up')}当日モードのメニューに戻る</button></div>` : ''}
        <section class="card">
          <h3>${U.icon('go')}当日モード・デモ</h3>
          <p class="muted small">当日モードは、文字とボタンを大きくし、当日に使う画面（いま・地図・記録・メニュー）だけにします。開催日にアプリを開くと、切り替えるかどうかを聞きます。デモでは、時計を開催日の開始時刻に合わせて本番どおりに操作でき、付けた記録は終了すると元に戻ります。</p>
          <div class="btn-row wrap">
            ${set.dayMode ? `<button class="btn" data-act="dayOff">${U.icon('x')}当日モードを終える</button>` : `<button class="btn primary" data-act="dayOn">${U.icon('go')}当日モードにする</button>`}
            ${s.isDemo() ? `<button class="btn" data-act="demoEnd">デモを終了する</button>` : `<button class="btn" data-act="demoStart">${U.icon('timer')}デモで練習</button>`}
          </div>
        </section>
        <section class="card">
          <h3>${U.icon('cal')}イベント</h3>
          <div class="ev-cur"><b>${esc(ev.name)}</b>${ev.date || d.date ? `<span>${esc(ev.date || d.date)}</span>` : ''}<small>${ev.circles.length}サークル${ev.spec ? '' : '・簡易マップ'}</small></div>
          <div class="btn-row wrap">
            <button class="btn" data-act="eventMenu">${U.icon('list')}イベント切替</button>
            <button class="btn primary" data-act="newEvent">${U.icon('plus')}新しいイベントを作る</button>
            ${custom ? `<button class="btn" data-act="editEvent">${U.icon('edit')}編集</button>` : ''}
          </div>
          <label class="field-inline"><span>開催日</span><input class="input" type="date" data-f="evdate" value="${esc(ev.date || d.date || '')}"></label>
          <div class="field-inline2">
            <label class="field-inline"><span>開始（入場）</span><input class="input" type="time" data-f="openAt" value="${esc(d.openAt || ev.openAt || '')}"></label>
            <label class="field-inline"><span>終了</span><input class="input" type="time" data-f="endAt" value="${esc(d.endAt || ev.endAt || '')}"></label>
          </div>
          <p class="muted small">当日タブに現在時刻（秒まで）・開始からの経過・終了までの残りが出ます。${ev.schedule && ev.schedule.length ? '公式の進行表は当日タブの「進行」から見られます。' : ''}</p>
        </section>

        <section class="card">
          <h3>${U.icon('wallet')}予算</h3>
          <div class="grid2">
            <label class="field"><span>予算（総額）</span><div class="yen-input"><span>¥</span><input class="input" inputmode="numeric" data-f="budget" value="${d.budget || ''}" placeholder="30000"></div></label>
            <label class="field"><span>別枠（交通・食費など）</span><div class="yen-input"><span>¥</span><input class="input" inputmode="numeric" data-f="reserve" value="${d.reserve || ''}" placeholder="0"></div></label>
            <label class="field"><span>持っていく現金 <small>${S().hasCashBreak() ? '下の金種から計算' : '任意'}</small></span><div class="yen-input"><span>¥</span><input class="input" inputmode="numeric" data-f="cash" value="${d.cash || ''}" placeholder="財布の残りを表示" ${S().hasCashBreak() ? 'readonly' : ''}></div></label>
            <div class="field"><span>支払いの初期値</span>${seg('defaultPay', [['cash', '現金'], ['card', 'キャッシュレス']])}</div>
          </div>
          <div class="field wallet-field"><span>財布の中身（金種ごとの枚数）</span>${V.cashEditor()}</div>
        </section>

        <section class="card">
          <h3>${U.icon('route')}ルート</h3>
          <div class="field"><span>スタート地点</span>
            <select class="input" data-f="start">${L.starts.map((p) => `<option value="${p.id}" ${d.start === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
              ${d.start && !L.starts.some((p) => p.id === d.start) ? `<option value="${esc(d.start)}" selected>${esc(d.start)} の前</option>` : ''}</select>
            <input class="input" data-f="startSid" placeholder="またはスペース番号（例：G23）" value="">
          </div>
          <div class="field"><span>自動ルートの組み方</span>${seg('routeMode', [['must', '必須→残り'], ['tier', '優先度順'], ['short', '最短のみ']])}</div>
          ${toggle('wallFirst', '壁サークルを先に回る', '列が長くなりやすいので早めに')}
          <p class="muted small">「必須→残り」は必須サークルを最短で回り切ってから、残りを最短で回ります。</p>
        </section>

        <section class="card" id="sec-layout">
          <h3>${U.icon('grid')}配置図 <small>${s.hasCustomLayout(ev.id) ? '自分で編集したもの' : (ev.spec ? '同梱の配置図' : '簡易マップ')}</small></h3>
          <p class="muted small">入口の位置や机の並びを実際の会場に合わせたいときは、エディタで直せます。公式の配置図画像を取り込んで、その上に置いていく形です。</p>
          <div class="btn-row wrap">
            <button class="btn" data-act="editLayout">${U.icon('edit')}配置図エディタを開く</button>
            ${s.hasCustomLayout(ev.id) ? `<button class="btn ghost" data-act="resetLayout">${U.icon('undo')}元に戻す</button>` : ''}
          </div>
        </section>

        <section class="card">
          <h3>${U.icon('star')}表示・操作</h3>
          <div class="field"><span>テーマ</span>${seg('theme', [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']])}</div>
          <div class="field"><span>文字の大きさ</span>${seg('font', [['0.9', '小'], ['1', '標準'], ['1.12', '大'], ['1.25', '特大']])}</div>
          <div class="field"><span>地図の向き</span>${seg('mapOrient', [['auto', '自動'], ['land', '横'], ['port', '縦']])}</div>
          ${toggle('wakeLock', '画面を消さない', '当日・地図タブを開いている間')}
          ${toggle('haptics', 'タップ時に振動', 'Android のみ')}
        </section>

        <section class="card" id="sec-transfer">
          <h3>${U.icon('share')}スマホへ送る・バックアップ</h3>
          <p class="muted small">PCで作った計画をスマホに移すには、QRコード（下の「共有リンク」）をスマホのカメラで読むか、ファイルに書き出してスマホへ送り、スマホ側で「読み込み」します。</p>
          <div class="btn-grid2">
            <button class="btn primary" data-act="shareLink">${U.icon('link')}共有リンクをコピー</button>
            <button class="btn" data-act="exportPlan">${U.icon('download')}計画をファイルに書き出し</button>
            <button class="btn" data-act="importFile">${U.icon('upload')}ファイルから読み込み</button>
            <button class="btn" data-act="importText">${U.icon('upload')}リンク／テキストを貼って読み込み</button>
            <button class="btn" data-act="printPlan">${U.icon('print')}巡回表を印刷</button>
            <button class="btn" data-act="exportAll">${U.icon('download')}全データのバックアップ</button>
            <button class="btn" data-act="restoreBackup">${U.icon('undo')}読み込み前の状態に戻す</button>
          </div>
        </section>

        ${(() => {
          const c = s.state.sync;
          const on = !!(c.url && c.phrase);
          const st = HC.sync.state;
          return `<section class="card" id="sec-sync">
            <h3>${U.icon('share')}PCとスマホで同期 <small>${on ? (c.dirty ? '未送信の変更あり' : '同期中') : '未設定'}</small></h3>
            ${on ? `
              <div class="sync-row">
                <span>${U.icon(c.dirty ? 'upload' : 'check', 'sm')}${c.dirty ? 'まだ送っていない変更があります' : 'この端末の内容は送信済みです'}</span>
                ${c.lastAt ? `<small>最終 ${esc(U.time(c.lastAt))}</small>` : ''}
              </div>
              ${st.error ? `<p class="warn small">${U.icon('warn', 'sm')} ${esc(st.error)}</p>` : ''}
              <label class="toggle-row"><span>自動で送る<small>変更の数秒後に送ります</small></span><input type="checkbox" data-f="syncAuto" ${c.auto ? 'checked' : ''}><i></i></label>
              <div class="btn-grid2">
                <button class="btn" data-act="syncNow">${U.icon('upload')}いま送る</button>
                <button class="btn" data-act="syncPull">${U.icon('download')}取り込む</button>
                <button class="btn" data-act="syncQr">${U.icon('share')}設定をスマホへ（QR）</button>
                <button class="btn ghost" data-act="syncSetup">${U.icon('edit')}URL・合言葉を変える</button>
              </div>
              <p class="muted small">自動で送るのは計画・購入記録・お気に入り・自作の配置図です。テーマなどの画面設定は端末ごとに残ります。</p>
              ${HC.shots && HC.shots.ready ? (() => {
                const Sh = HC.shots;
                const all = Sh.all(), unsent = Sh.unsent().length, got = all.filter((m) => m.remote).length;
                return `<div class="shot-sync">
                  <h4>${U.icon('image', 'sm')}お品書き画像 <small>この端末 ${all.length}枚（受け取った ${got}枚）${c.shotsAt ? ` ・ 最終 ${esc(U.md(c.shotsAt))} ${esc(U.time(c.shotsAt))}` : ''}</small></h4>
                  <p class="muted small">画像はデータが大きいため、自動では送りません。PCで画像を追加したら「画像を送る」を、スマホでは「画像を受け取る」を押してください。まだ届いていない画像だけが移ります。電波のある場所で行ってください。</p>
                  <div class="btn-grid2">
                    <button class="btn${unsent ? ' primary' : ''}" data-act="shotsPush">${U.icon('upload')}画像を送る${unsent ? ` <small>${unsent}枚</small>` : ''}</button>
                    <button class="btn" data-act="shotsPull">${U.icon('download')}画像を受け取る</button>
                  </div></div>`;
              })() : ''}
              <button class="btn danger ghost block" data-act="syncOff">${U.icon('x')}同期をやめる</button>
            ` : `
              <p class="muted small">Google Apps Script に置いた自分用の保管場所を通して、PCとスマホで計画・記録を行き来させます。費用はかかりません。用意のしかたは <code>tools/gas/コード.gs</code> の先頭に書いてあります。</p>
              <div class="btn-row wrap"><button class="btn primary" data-act="syncSetup">${U.icon('share')}同期を設定する</button></div>
            `}
          </section>`;
        })()}

        <section class="card" id="sec-offline">
          <h3>${U.icon('wifi')}オフライン</h3>
          <p class="muted small">${location.protocol === 'https:'
            ? '一度このURLを開いておけば、会場で電波が切れても計画・記録・地図・お品書き画像はそのまま使えます。外部リンク（X・pixiv）だけは電波が必要です。'
            : 'いまはファイル（またはlocalhost）で開いているため、オフライン保存は使いません。スマホで使うときは公開URLで開いてください。'}</p>
          <div class="btn-row wrap">
            <button class="btn" data-act="offlineStatus">${U.icon('check')}保存されているか確認</button>
            <button class="btn" data-act="offlineRefresh">${U.icon('download')}オフライン用に取り込み直す</button>
          </div>
          <p class="muted small">当日の朝、電波のあるうちに一度「取り込み直す」を押しておくと確実です。</p>
        </section>

        <section class="card" id="sec-log">
          <h3>${U.icon('yen')}購入記録 <small>${log.length}件 ・ ${U.yen(st.spent)}</small></h3>
          ${log.length ? `<ol class="log">${log.map((r) => `<li><span class="t">${U.time(r.t)}</span><span class="w">${r.space ? `<b>${esc(r.space)}</b> ` : ''}${esc(r.circle)}<small>${esc(r.name)}${r.qty > 1 ? ' ×' + r.qty : ''}${r.planned ? '' : ' ・追加'}${r.pay === 'card' ? ' ・電子' : ''}</small></span><span class="c">${U.yen(r.cost)}</span>${r.xid ? `<button class="icon-btn sm" data-act="removeExtra" data-xid="${r.xid}" aria-label="削除">${U.icon('trash')}</button>` : ''}</li>`).join('')}</ol>` : '<p class="muted small">まだ記録はありません</p>'}
          <div class="btn-row wrap"><button class="btn" data-act="outsideBuy">${U.icon('plus')}サークル外の支出</button><button class="btn" data-act="exportCsv">${U.icon('download')}CSVで書き出し</button></div>
        </section>

        ${HC.shots && HC.shots.ready ? (() => {
          const u = HC.shots.usage(s.state.eventId);
          return `<section class="card" id="sec-shots">
            <h3>${U.icon('image')}お品書きの画像 <small>${u.n}枚 ・ ${(u.bytes / 1048576).toFixed(1)}MB</small></h3>
            <p class="muted small">サークル詳細から追加できます（PCは貼り付け・ドロップも可）。共有リンクやバックアップには含まれません。別の端末へは「同期 → 画像を送る／受け取る」で移せます。</p>
            ${u.n ? `<div class="btn-row wrap"><button class="btn danger ghost" data-act="clearShots">${U.icon('trash')}このイベントの画像を全部削除</button></div>` : ''}
          </section>`;
        })() : ''}

        <section class="card">
          <h3>${U.icon('trash')}リセット</h3>
          <div class="btn-row wrap">
            <button class="btn" data-act="resetDay">当日の記録だけリセット</button>
            <button class="btn danger ghost" data-act="clearPlan">この計画を全消去</button>
          </div>
          <p class="muted small">「当日の記録だけリセット」は計画を残したまま、購入済・売切などを未購入に戻します。使い方を試したあと、本番前に戻すときに。</p>
        </section>

        <section class="card" id="sec-version">
          <h3>${U.icon('check')}バージョン <small>この端末で動いているのは v${HC.VERSION}</small></h3>
          <p class="muted small">更新してもデータは消えません（計画・記録はこの端末のブラウザ内に残ります）。
            入力の途中なら、いったん入力欄の外を押してから更新してください。</p>
          <p class="ver-state muted small" id="ver-state"></p>
          <div class="btn-row wrap">
            <button class="btn" data-act="checkUpdate">${U.icon('download')}更新を確認</button>
            <button class="btn ghost" data-act="reloadApp">${U.icon('undo')}読み込み直す</button>
          </div>
        </section>
      </div>`;
    },
  };
})();
