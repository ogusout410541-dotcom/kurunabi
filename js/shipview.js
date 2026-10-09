/* 発送モード：代行の発送の作業だけをまとめた画面（当日モードと同じく、端末ごとに切り替える）
   - 「発送」：手順と進み具合（QRタグの印刷 → 購入検品 → 宛先・伝票 → 梱包 → 伝票の同封 → 発送済み）、依頼者ごとの箱
   - 「読み取り」：スマホのカメラで QR タグを読み、検品・梱包を1点ずつ記録する。箱ごとに過不足（足りないもの・入れてはいけないもの）を出す
   - 「メニュー」：印刷・同期・端末・発送モードを終える
   PC でタグと伝票を印刷し、スマホ・iPad で読み取る使い方。記録は同期で PC に戻る（js/sync.js）
   読み取りの画面はカメラの映像を止めないよう、記録のたびに画面ごと作り直さず、中身だけ差し替える（paint） */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const S = () => HC.store;
  const UI = () => HC.ui;
  const V = HC.views;
  const A = HC.actions;
  const app = HC.app;
  const esc = U.esc;

  const rqName = (rid) => ((S().requester(rid) || {}).name || '代行');
  const whoLabel = (f) => (f ? `${rqName(f)}の分` : '自分の分');
  const bar = (a, b) => `<span class="sm-bar" role="img" aria-label="${a}/${b}"><i style="width:${b ? Math.round((a / b) * 100) : 0}%"></i></span>`;
  /** 依頼者ごとの箱の進み具合 */
  const boxInfo = (rid) => {
    const u = S().unitRows(rid);
    const missing = [];
    u.rows.forEach((r) => { for (let k = 1; k <= r.qty; k++) if (!r.pack.includes(k)) missing.push({ r, k }); });
    return { ...u, missing, done: u.units > 0 && u.pack === u.units };
  };

  // ------------------------------------------------------------------ 発送（手順と進み具合）
  V.ship = {
    render(el) {
      el.onchange = (e) => {
        const t = e.target;
        if (!t.matches || !t.matches('[data-trk]')) return;
        S().setShip(t.dataset.trk, { tracking: t.value.trim() });
        UI().toast('追跡番号を保存しました');
      };
      const s = S();
      const all = s.unitRows('all');
      const rq = s.requesters().map((r) => ({ r, b: boxInfo(r.id), st: HC.ship.state(r.id) })).filter((x) => x.b.units || x.st === 'shipped');
      const px = { units: U.sum(rq, (x) => x.b.units), pack: U.sum(rq, (x) => x.b.pack) };
      const addrOk = rq.filter((x) => x.st !== 'lack' && x.st !== 'none').length;
      const shipped = rq.filter((x) => x.st === 'shipped').length;
      const step = (n, title, done, body, act = '') => `<li class="sm-step${done ? ' done' : ''}">
          <span class="sf-no">${done ? U.icon('check', 'sm') : n}</span>
          <div><b>${title}</b><small>${body}</small></div>${act}</li>`;
      el.innerHTML = `<div class="ship-view">
        <section class="card sm-head">
          <h3>${U.icon('box')}発送モード <small>${esc(s.ev().name)}</small></h3>
          ${V.shipSync()}
          <div class="sm-total">
            <div><span>購入検品</span>${bar(all.insp, all.units)}<b>${all.insp}<small>/${all.units}点</small></b></div>
            <div><span>梱包（代行）</span>${bar(px.pack, px.units)}<b>${px.pack}<small>/${px.units}点</small></b></div>
            <div><span>発送済み</span>${bar(shipped, rq.length)}<b>${shipped}<small>/${rq.length}人</small></b></div>
          </div>
        </section>
        <section class="card">
          <h3>${U.icon('list')}手順</h3>
          <ol class="sm-steps">
            ${step(1, 'QRタグを印刷して貼る', false, 'PC で A4 普通紙に印刷し、切って品物1点に1枚ずつテープで貼ります', `<button class="btn sm" data-act="buyCheck" data-parts="list,tags">${U.icon('print', 'sm')}印刷</button>`)}
            ${step(2, '購入検品', all.units > 0 && all.insp === all.units, `「読み取り」でタグをカメラに写すと、1点ずつ検品済みになります（${all.insp}/${all.units}点）`, `<button class="btn sm" data-act="scanGo" data-mode="insp">${U.icon('qr', 'sm')}読み取る</button>`)}
            ${step(3, '宛先を入力する', rq.length > 0 && addrOk === rq.length, `依頼者ごとにお届け先と発送方法を入力します（${addrOk}/${rq.length}人）`)}
            ${step(4, '梱包', px.units > 0 && px.pack === px.units, `箱を選んでタグを読むと、入れてよい品物か・足りない品物が分かります（${px.pack}/${px.units}点）`)}
            ${step(5, '伝票を印刷して同封する', false, '梱包伝票と発送伝票を A4 で印刷します', `<button class="btn sm" data-act="shipAll">${U.icon('print', 'sm')}印刷</button>`)}
            ${step(6, '発送済みにする', rq.length > 0 && shipped === rq.length, `追跡番号を入れて、発送済みにします（${shipped}/${rq.length}人）`)}
          </ol>
        </section>
        ${rq.length ? `<section class="card sm-ledger">
          <h3>${U.icon('list')}発送の一覧 <small>${rq.length}人</small><button class="link-btn" data-act="shipCsv">${U.icon('download', 'sm')}発送台帳（CSV）</button></h3>
          <div class="sm-table-wrap"><table class="sm-table">
            <thead><tr><th>伝票No.</th><th>依頼者</th><th class="num">点数</th><th class="num">検品</th><th class="num">梱包</th><th>宛先</th><th>発送方法</th><th class="num">送料</th><th>追跡番号</th><th>発送日</th><th>状態</th><th></th></tr></thead>
            <tbody>${rq.map(({ r, b, st }) => { const sh = r.ship || {}; const fee = sh.feeMode === 'cod' ? '着払い' : sh.feeMode === 'none' ? '—' : sh.fee ? U.yen(sh.fee) : '未入力'; return `<tr class="${st}">
              <td class="mono">${sh.no ? String(sh.no).padStart(4, '0') : '—'}</td>
              <td><span class="rq-dot ${V.rqClass(r.id)}"></span><b>${esc(r.name)}</b></td>
              <td class="num">${b.units}</td>
              <td class="num${b.insp === b.units && b.units ? ' ok' : ''}">${b.insp}/${b.units}</td>
              <td class="num${b.done ? ' ok' : ''}">${b.pack}/${b.units}</td>
              <td>${sh.addr1 ? `${esc(sh.name || '')}<small>〒${esc(HC.ship.postal(sh.postal))}</small>` : '<span class="sb-lack">未入力</span>'}</td>
              <td>${esc(sh.method || '—')}</td>
              <td class="num">${fee}</td>
              <td><input class="input sm-trk" data-trk="${esc(r.id)}" value="${esc(sh.tracking || '')}" placeholder="入力" inputmode="numeric" autocomplete="off" aria-label="${esc(r.name)}の追跡番号"></td>
              <td>${sh.shippedAt ? esc(U.md(sh.shippedAt)) : '—'}</td>
              <td><em class="ship-tag ${st}">${HC.ship.STATE[st] || ''}</em></td>
              <td class="sm-ops"><button class="icon-btn sm" data-act="shipOpen" data-rid="${esc(r.id)}" title="宛先・伝票" aria-label="宛先・伝票">${U.icon('print', 'sm')}</button><button class="icon-btn sm" data-act="shipNotice" data-rid="${esc(r.id)}" title="発送のお知らせ文をコピー" aria-label="発送のお知らせ文をコピー">${U.icon('note', 'sm')}</button><button class="icon-btn sm${st === 'shipped' ? ' on' : ''}" data-act="shipDone" data-rid="${esc(r.id)}" title="${st === 'shipped' ? '発送済みを取り消す' : '発送済みにする'}" aria-label="${st === 'shipped' ? '発送済みを取り消す' : '発送済みにする'}">${U.icon('truck', 'sm')}</button></td>
            </tr>`; }).join('')}</tbody>
          </table></div>
          <p class="muted small">追跡番号はこの表で直接入力できます（入力すると保存します）。行の右のボタンは、左から「宛先・伝票」「発送のお知らせ文をコピー」「発送済み」です。</p>
        </section>` : ''}
        <h3 class="sm-sec-title">${U.icon('box')}箱（依頼者ごと）</h3>
        ${rq.length ? '<div class="sm-boxes">' + rq.map(({ r, b, st }) => `<section class="card sm-box ${st}">
            <div class="smb-hd"><span class="rq-dot ${V.rqClass(r.id)}"></span><b>${esc(r.name)}</b><em class="ship-tag ${st}">${HC.ship.STATE[st] || ''}</em></div>
            <div class="sm-total">
              <div><span>検品</span>${bar(b.insp, b.units)}<b>${b.insp}<small>/${b.units}点</small></b></div>
              <div><span>梱包</span>${bar(b.pack, b.units)}<b>${b.pack}<small>/${b.units}点</small></b></div>
            </div>
            ${b.pack && b.missing.length ? `<p class="small sb-lack">まだ箱に入れていない：${b.missing.slice(0, 4).map(({ r: x, k }) => `${esc(x.name)}（${k}/${x.qty}）`).join('、')}${b.missing.length > 4 ? ` ほか${b.missing.length - 4}点` : ''}</p>` : ''}
            ${b.done && st !== 'shipped' ? `<p class="small sf-ok">${U.icon('check', 'sm')}過不足なし：全${b.units}点を箱に入れました</p>` : ''}
            <div class="btn-grid2">
              <button class="btn${b.done ? '' : ' primary'}" data-act="scanGo" data-mode="pack" data-rid="${esc(r.id)}">${U.icon('qr')}梱包を読み取る</button>
              <button class="btn" data-act="shipOpen" data-rid="${esc(r.id)}">${U.icon('print')}宛先・伝票</button>
            </div>
            ${b.done || st === 'shipped' ? `<button class="btn block ${st === 'shipped' ? 'ghost' : 'primary'}" data-act="shipDone" data-rid="${esc(r.id)}">${U.icon('truck')}${st === 'shipped' ? `発送済み（${esc(U.md((r.ship || {}).shippedAt))}）を取り消す` : '発送済みにする'}</button>` : ''}
            ${st === 'shipped' ? `<button class="btn block" data-act="shipNotice" data-rid="${esc(r.id)}">${U.icon('note')}発送のお知らせ文をコピー</button>` : ''}
          </section>`).join('') + '</div>' : '<p class="muted card">代行の品物で買えたものがまだありません。</p>'}
        ${(() => {
          const own = s.unitRows('own');
          return own.units ? `<section class="card sm-box own">
            <div class="smb-hd"><b>自分の分</b><small class="muted">箱には入れません</small></div>
            <div class="sm-total"><div><span>検品</span>${bar(own.insp, own.units)}<b>${own.insp}<small>/${own.units}点</small></b></div></div>
          </section>` : '';
        })()}
      </div>`;
    },
  };

  /** 同期の様子（発送モードでは、読み取った記録をすぐ送り、PC は数秒ごとに受け取る） */
  V.shipSync = () => {
    const Sy = HC.sync;
    if (!Sy.configured()) {
      return `<p class="muted small">${U.icon('note', 'sm')}同期は設定していません。PC につないだカメラで読み取るなら、このままで使えます。スマホ・iPad でも読み取るときは、端末を登録してください。<button class="link-btn" data-act="shipDevices">端末を登録する</button></p>`;
    }
    const devs = Sy.devices ? Sy.devices() : [];
    const ago = (t) => {
      if (!t) return 'まだ';
      const s = Math.round((Date.now() - t) / 1000);
      return s < 60 ? `${Math.max(1, s)}秒前` : s < 3600 ? `${Math.round(s / 60)}分前` : U.md(t) + ' ' + U.time(t);
    };
    return `<div class="sm-sync">
      <span class="sm-sync-st${Sy.state.error ? ' err' : ''}">${U.icon(Sy.state.error ? 'warn' : 'check', 'sm')}${Sy.state.error ? esc(Sy.state.error) : `同期：${ago(S().state.sync.lastAt)}`}</span>
      ${devs.length ? `<span class="sm-devs">${devs.map((d) => `<span class="sm-dev${d.me ? ' me' : ''}">${esc(d.name)}<small>${d.me ? 'この端末' : ago(d.lastAt)}</small></span>`).join('')}</span>` : ''}
      <button class="link-btn" data-act="shipSyncNow">${U.icon('sync', 'sm')}最新にする</button>
    </div>`;
  };

  // ------------------------------------------------------------------ 読み取り（検品・梱包）
  const MSG = {
    ok: (r, mode) => (mode === 'pack' ? 'この箱に入れてOK' : '検品OK'),
    dup: () => 'もう読み取り済みです',
    wrongBox: (r) => `この箱ではありません（${rqName(r.for)}の分）`,
    own: () => '自分の分です（箱に入れません）',
    notBought: () => '購入の記録がない品物です',
    over: (r) => `数量より多いタグです（数量 ×${r.qty}）`,
    otherEvent: () => '別のイベントのタグです',
    unknown: () => 'この端末に無い品物です',
    invalid: () => 'このアプリのタグではありません',
  };
  const TONE = { ok: 'ok', dup: 'dup', wrongBox: 'ng', own: 'ng', notBought: 'ng', over: 'ng', otherEvent: 'ng', unknown: 'ng', invalid: 'ng' };
  const HINT = {
    dup: '同じタグをもう一度読みました。記録は変わりません',
    wrongBox: '箱から取り出して、その人の箱に入れてください',
    own: '自分の分は箱に入れません。取り出してください',
    notBought: '売り切れ・見送り・未購入の品物です。タグの貼り間違いがないか確かめてください',
    over: 'タグを印刷し直すか、品物の数量を確かめてください',
    otherEvent: 'イベントを切り替えてから読み直してください',
    unknown: 'この端末の計画に無い品物です。別の端末で足した品物なら、同期で受け取ってから読み直してください',
    invalid: 'クルナビで印刷した QR タグを読んでください',
  };

  let audio = null;
  const beep = (tone) => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      if (tone === 'prep') return;
      const o = audio.createOscillator(), g = audio.createGain();
      o.connect(g); g.connect(audio.destination);
      const t = audio.currentTime;
      if (tone === 'ok') { o.frequency.setValueAtTime(1046, t); o.frequency.setValueAtTime(1568, t + 0.07); }
      else if (tone === 'dup') o.frequency.setValueAtTime(660, t);
      else { o.type = 'square'; o.frequency.setValueAtTime(220, t); }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (tone === 'ng' ? 0.45 : 0.18));
      o.start(t); o.stop(t + 0.5);
    } catch (e) { /* 音が出なくても記録はできる */ }
    if (navigator.vibrate) navigator.vibrate(tone === 'ok' ? 40 : tone === 'dup' ? [30, 40, 30] : [120, 60, 120]);
  };

  const CAM_KEY = 'kurunavi.camId';
  const savedCam = () => { try { return localStorage.getItem(CAM_KEY) || ''; } catch (e) { return ''; } };
  const saveCam = (id) => { try { localStorage.setItem(CAM_KEY, id); } catch (e) { /* 覚えられなくても使える */ } };
  const isPC = () => matchMedia('(pointer: fine)').matches;

  V.scan = {
    mode: 'insp',
    box: '',
    cam: null,
    last: null,
    log: [],        // 今回読んだもの（新しい順）
    out: {},        // 箱ごとの「取り出してください」 { rid: [res] }
    render(el) {
      const s = S();
      const boxes = s.requesters().filter((r) => s.unitRows(r.id).units);
      if (this.mode === 'pack' && !boxes.some((r) => r.id === this.box)) this.box = boxes[0] ? boxes[0].id : '';
      const key = this.mode + ':' + this.box;
      if (el.dataset.key !== key || !U.$('.scan-view', el)) {
        const wasOn = !!this.cam;
        this.stop();
        el.dataset.key = key;
        el.innerHTML = `<div class="scan-view mode-${this.mode}">
          <div class="seg scan-mode">
            <button type="button" class="${this.mode === 'tag' ? 'on' : ''}" data-scanmode="tag">${U.icon('qr', 'sm')}タグ貼り</button>
            <button type="button" class="${this.mode === 'insp' ? 'on' : ''}" data-scanmode="insp">${U.icon('check', 'sm')}購入検品</button>
            <button type="button" class="${this.mode === 'pack' ? 'on' : ''}" data-scanmode="pack">${U.icon('box', 'sm')}梱包</button>
          </div>
          ${this.mode === 'pack' ? '<div class="scan-boxes"></div>' : this.mode === 'tag' ? '<p class="muted small scan-lead">切ったタグを1枚ずつ読むと、その品物とお品書き画像を大きく出します。品物を見つけてタグを貼り、「貼った」を押すと検品済みになります。</p>' : '<p class="muted small scan-lead">タグを読むと、検品済みになります。下に大きく出る「誰の分」を見て、人ごとに分けて置いてください。</p>'}
          <div class="scan-cam">
            <video playsinline muted></video>
            <div class="scan-aim" aria-hidden="true"></div>
            <div class="scan-flash" aria-hidden="true"></div>
            <div class="scan-off">
              <button type="button" class="btn primary lg" data-scanstart>${U.icon('camera')}カメラで読み取る</button>
              <small>タグの QR を、真ん中の枠に写してください</small>
              ${isPC() ? `<button type="button" class="link-btn scan-help" data-camhelp>${U.icon('note', 'sm')}iPhone を PC のカメラにする方法</button>` : ''}
            </div>
            <div class="scan-camname"></div>
            <div class="scan-ctl">
              <button type="button" class="btn sm" data-camsel>${U.icon('camera', 'sm')}カメラを選ぶ</button>
              ${isPC() ? '' : `<button type="button" class="icon-btn" data-torch aria-label="ライト">${U.icon('sun')}</button>`}
              <button type="button" class="btn sm" data-scanstop>止める</button>
            </div>
          </div>
          <form class="scan-manual" autocomplete="off">
            <span class="scan-manual-lb">${U.icon('edit', 'sm')}No. で入力</span>
            <label><span>No.</span><input class="input" name="no" inputmode="numeric" placeholder="12" aria-label="タグの No."></label>
            <label><span>何点目</span><input class="input" name="k" inputmode="numeric" placeholder="自動" aria-label="何点目（空なら、まだの点を自動で選びます）"></label>
            <button type="submit" class="btn sm primary">記録</button>
          </form>
          <div class="scan-last" aria-live="assertive"></div>
          <div class="scan-body"></div>
        </div>`;
        this.bind(el);
        // タグが汚れて読めないときは、タグに印刷した No. と何点目を打ち込んで記録する
        U.$('.scan-manual', el).onsubmit = (e) => {
          e.preventDefault();
          const f = e.target;
          const no = parseInt(U.toHalf(f.no.value), 10);
          const row = HC.ship.tagRows().find((r) => r.no === no);
          if (!row) { UI().toast(`No.${f.no.value || '?'} の品物が見つかりません（タグを印刷したときの並びで数えています）`, { error: true }); return; }
          const outside = !!(row.cid && row.cid.startsWith('x:'));
          let k = parseInt(U.toHalf(f.k.value), 10);
          if (!k) {
            // 空なら、まだ記録していない最初の点
            const it = outside ? (S().d().extras || []).find((x) => x.id === row.iid) : Object.values(S().d().entries).flatMap((x) => x.items).find((i) => i.id === row.iid);
            const done = (it && it[this.mode === 'pack' ? 'pack' : 'insp']) || [];
            k = Array.from({ length: row.qty }, (_, i) => i + 1).find((x) => !done.includes(x)) || 1;
          }
          this.onRead(S().tagText(row.iid, k, outside), el);
          f.no.value = ''; f.k.value = '';
          f.no.focus();
        };
        if (wasOn) this.start(el);
      }
      this.paint(el);
    },
    bind(el) {
      el.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.scanmode) { this.mode = b.dataset.scanmode; this.last = null; this.render(el); return; }
        if (b.dataset.box) { this.box = b.dataset.box; this.last = null; this.render(el); return; }
        if (b.hasAttribute('data-scanstart')) { this.start(el); return; }
        if (b.hasAttribute('data-scanstop')) { this.stop(); this.paintCam(el); return; }
        if (b.hasAttribute('data-camsel')) { this.pickCam(el); return; }
        if (b.hasAttribute('data-camhelp')) { A.camHelp(); return; }
        if (b.hasAttribute('data-torch')) { if (this.cam) this.cam.torch(!(this.torch = !this.torch)).then((ok) => { if (!ok) UI().toast('この端末ではライトを使えません'); }); return; }
        if (b.dataset.manual) {
          // タグが読めないときに手で記録する
          const [iid, k, out] = b.dataset.manual.split('|');
          S().setUnit(iid, +k, this.mode === 'tag' ? 'insp' : this.mode, true, out === '1');
          UI().toast(this.mode === 'pack' ? '箱に入れたことにしました' : '検品済みにしました', { undo: true });
          return;
        }
        if (b.dataset.undo) {
          const [iid, k, mode, out] = b.dataset.undo.split('|');
          S().setUnit(iid, +k, mode, false, out === '1');
          this.log = this.log.filter((x) => !(x.iid === iid && x.k === +k && x.mode === mode));
          UI().toast('記録を取り消しました', { undo: true });
          return;
        }
        if (b.dataset.tcidx) { this.shotIdx = +b.dataset.tcidx; this.paint(el); return; }
        if (b.dataset.tagdone) {
          const [iid, k, out] = b.dataset.tagdone.split('|');
          S().setUnit(iid, +k, 'insp', true, out === '1');
          if (this.last) this.last.insp = [...new Set([...(this.last.insp || []), +k])];
          this.log.unshift({ ...this.last, mode: 'tag', t: Date.now() });
          HC.sync.soon && HC.sync.soon();
          UI().toast(`${k}点目を検品済みにしました。次のタグを読んでください`, { undo: true });
          this.paint(el);
          return;
        }
        if (b.dataset.takeout) {
          this.out[this.box] = (this.out[this.box] || []).filter((x) => `${x.iid}|${x.k}` !== b.dataset.takeout);
          this.paint(el);
          return;
        }
        if (b.dataset.act) return;   // ほかの操作（data-act）は共通の処理にまかせる
      };
    },
    paintCam(el) {
      const cam = U.$('.scan-cam', el);
      if (cam) cam.classList.toggle('on', !!this.cam);
      const nm = U.$('.scan-camname', el);
      if (nm) nm.textContent = this.cam && this.cam.label ? `カメラ：${this.cam.label}` : '';
    },
    /** カメラを選ぶ（PC に iPhone をつなぐと、内蔵カメラと iPhone の仮想カメラが並ぶ）。選んだものは次から最初に使う */
    async pickCam(el) {
      const list = await HC.qrscan.cameras();
      if (list.length < 2) return UI().toast(list.length ? 'ほかのカメラが見つかりません。iPhone をつないで、Web カメラのアプリを起動してから選び直してください' : 'カメラが見つかりません', { ms: 6000 });
      const cur = this.cam ? this.cam.deviceId : savedCam();
      UI().menu('使うカメラ', list.map((c) => ({
        label: c.label, icon: c.id === cur ? 'check' : 'camera', active: c.id === cur,
        act: async () => { saveCam(c.id); this.stop(); await this.start(el); },
      })));
    },
    async start(el) {
      if (this.cam) return;
      const v = U.$('.scan-cam video', el);
      if (!HC.qrscan.supported()) return UI().toast('この端末・ブラウザではカメラを使えません。公開版（https）のページで開いているか確かめてください', { error: true, ms: 6000 });
      try {
        beep('prep');   // 音は押した操作のあとでないと鳴らせないので、ここで準備しておく
        const want = savedCam();
        const has = want && (await HC.qrscan.cameras()).some((c) => c.id === want);
        this.cam = await HC.qrscan.start(v, (text) => this.onRead(text, el), has ? { deviceId: want } : {});
        // 初めて使う PC でカメラが2つ以上あれば、iPhone のカメラを選べることを知らせる
        if (!want && isPC() && (await HC.qrscan.cameras()).length > 1) UI().toast('カメラが2つ以上あります。iPhone のカメラを使うときは「カメラを選ぶ」から選んでください', { ms: 6000 });
        this.paintCam(el);
      } catch (e) {
        this.cam = null;
        const n = e && e.name;
        UI().toast(n === 'NotAllowedError' ? 'カメラの使用が許可されていません。設定アプリの Safari →「カメラ」で許可してください（ホーム画面のアプリは、いったん閉じて開き直すと聞き直されます）'
          : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'カメラが見つかりませんでした。iPhone をつないで、Web カメラのアプリを起動してください'
          : n === 'NotReadableError' ? 'カメラをほかのアプリが使っています。ほかのアプリ（ビデオ会議など）を閉じてから、もう一度押してください' : 'カメラを起動できませんでした', { error: true, ms: 7000 });
      }
    },
    stop() {
      if (this.cam) { this.cam.stop(); this.cam = null; }
      this.torch = false;
    },
    onRead(text, el) {
      const res = S().scanTag(text, this.mode === 'tag' ? 'look' : this.mode, this.box);
      const rec = { ...res, mode: this.mode, box: this.box, t: Date.now() };
      this.last = rec;
      this.shotIdx = 0;
      const tone = TONE[res.kind] || 'ng';
      beep(tone);
      const flash = U.$('.scan-flash', el);
      if (flash) { flash.className = 'scan-flash ' + tone; void flash.offsetWidth; flash.classList.add('go'); }
      if (res.kind === 'ok' && this.mode !== 'tag') this.log.unshift(rec);   // タグ貼りは「貼った」を押したときに控える
      if (this.log.length > 60) this.log.length = 60;
      if (this.mode === 'pack' && (res.kind === 'wrongBox' || res.kind === 'own' || res.kind === 'notBought' || res.kind === 'over')) {
        const list = (this.out[this.box] = this.out[this.box] || []);
        if (!list.some((x) => x.iid === res.iid && x.k === res.k)) list.unshift(rec);
      }
      if (res.kind === 'ok' && this.mode === 'pack') HC.sync.soon && HC.sync.soon();
      if (res.kind === 'ok' && this.mode === 'insp') HC.sync.soon && HC.sync.soon();
      this.paint(el);
    },
    paint(el) {
      const s = S();
      const view = U.$('.scan-view', el);
      if (!view) return;
      this.paintCam(el);
      // 箱の選択
      const bx = U.$('.scan-boxes', el);
      if (bx) {
        const boxes = s.requesters().filter((r) => s.unitRows(r.id).units);
        bx.innerHTML = boxes.length ? `<span class="muted small">どの箱に入れますか</span><div class="chips wrap">${boxes.map((r) => { const b = boxInfo(r.id); return `<button type="button" class="chip${r.id === this.box ? ' on' : ''} ${V.rqClass(r.id)}" data-box="${esc(r.id)}"><span class="rq-dot ${V.rqClass(r.id)}"></span>${esc(r.name)}<small>${b.pack}/${b.units}</small></button>`; }).join('')}</div>`
          : '<p class="muted small">代行の品物で買えたものがありません。</p>';
      }
      // いま読んだもの
      const last = U.$('.scan-last', el);
      const L = this.last;
      if (L && this.mode === 'tag' && L.mode === 'tag') {
        this.paintTag(last, L);
      } else if (L) {
        const tone = TONE[L.kind] || 'ng';
        const b = this.mode === 'pack' && this.box ? boxInfo(this.box) : null;
        const complete = b && b.done && !(this.out[this.box] || []).length;
        last.className = 'scan-last ' + tone;
        last.innerHTML = `<div class="sl-msg">${U.icon(tone === 'ok' ? 'check' : 'warn')}<b>${esc(MSG[L.kind] ? MSG[L.kind](L, L.mode) : '読み取れません')}</b></div>
          ${L.name ? `<div class="sl-item"><span class="sl-who ${L.for ? 'px ' + V.rqClass(L.for) : ''}">${esc(whoLabel(L.for))}</span>
            <b>${esc(L.space || '')} ${esc(L.circle || '')}</b><span>${esc(L.name)}　<b>${L.k}/${L.qty}</b>点目</span></div>` : ''}
          ${HINT[L.kind] ? `<p class="small">${HINT[L.kind]}</p>` : ''}
          ${L.kind === 'unknown' && HC.sync.configured() ? `<button class="btn sm" data-act="shipSyncNow">${U.icon('sync', 'sm')}ほかの端末の最新を受け取る</button>` : ''}
          ${complete ? `<div class="sl-done">${U.icon('check')}過不足なし：${esc(rqName(this.box))}の分 全${b.units}点がそろいました
            <div class="btn-grid2"><button class="btn" data-act="shipOpen" data-rid="${esc(this.box)}">${U.icon('print', 'sm')}伝票を印刷</button><button class="btn primary" data-act="shipDone" data-rid="${esc(this.box)}">${U.icon('truck', 'sm')}発送済みにする</button></div></div>` : ''}`;
      } else {
        last.className = 'scan-last';
        last.innerHTML = '';
      }
      // 進み具合と一覧
      const body = U.$('.scan-body', el);
      const recMode = this.mode === 'tag' ? 'insp' : this.mode;   // タグ貼りで記録するのは検品
      const unitBtn = (r, k, act) => `<button type="button" class="chip sm" data-${act}="${esc(r.iid)}|${k}${act === 'undo' ? `|${recMode}` : ''}|${r.outside ? 1 : 0}">${k}点目${act === 'manual' ? 'を記録' : 'を取り消す'}</button>`;
      if (this.mode === 'pack') {
        if (!this.box) { body.innerHTML = ''; return; }
        const b = boxInfo(this.box);
        const out = this.out[this.box] || [];
        body.innerHTML = `<section class="card scan-prog">
            <div class="sm-total"><div><span>${esc(rqName(this.box))}の箱</span>${bar(b.pack, b.units)}<b>${b.pack}<small>/${b.units}点</small></b></div></div>
            ${b.done && !out.length ? `<p class="sf-ok small">${U.icon('check', 'sm')}過不足なし。全${b.units}点を箱に入れました</p>` : `<p class="small muted">足りない ${b.missing.length}点${out.length ? ` ・ 取り出すもの ${out.length}点` : ''}</p>`}
          </section>
          ${out.length ? `<section class="card scan-out"><h3>${U.icon('warn')}取り出してください <small>この箱に入れてはいけない品物</small></h3>
            <ul class="scan-list">${out.map((x) => `<li><div><b>${esc(x.space || '')} ${esc(x.name || '（読み取れないタグ）')}</b><small>${esc(MSG[x.kind] ? MSG[x.kind](x) : '')}</small></div><button type="button" class="chip sm" data-takeout="${esc(x.iid)}|${x.k}">取り出した</button></li>`).join('')}</ul></section>` : ''}
          ${b.missing.length ? `<section class="card"><h3>${U.icon('box')}まだ箱に入れていない <small>${b.missing.length}点</small></h3>
            <ul class="scan-list">${b.rows.filter((r) => r.pack.length < r.qty).map((r) => `<li><div><b>${esc(r.space)} ${esc(r.circle)}</b><small>${esc(r.name)} ・ ${r.pack.length}/${r.qty}点</small></div>
              <span class="scan-units">${Array.from({ length: r.qty }, (_, i) => i + 1).filter((k) => !r.pack.includes(k)).map((k) => unitBtn(r, k, 'manual')).join('')}</span></li>`).join('')}</ul>
            <p class="muted small">タグが読めないときは「◯点目を記録」で手で記録できます。</p></section>` : ''}
          ${this.logHTML(unitBtn)}`;
      } else {
        // 購入検品とタグ貼り：まだ検品していない品物（タグ貼りでは「貼った」を押すと検品済みになる）
        const u = s.unitRows('all');
        const piles = [['', '自分'], ...s.requesters().map((r) => [r.id, r.name])].map(([f, n]) => {
          const rows = u.rows.filter((r) => r.for === f);
          return { f, n, a: U.sum(rows, (r) => r.insp.length), b: U.sum(rows, (r) => r.qty) };
        }).filter((x) => x.b);
        const left = u.rows.filter((r) => r.insp.length < r.qty);
        body.innerHTML = `<section class="card scan-prog">
            <div class="sm-total"><div><span>購入検品</span>${bar(u.insp, u.units)}<b>${u.insp}<small>/${u.units}点</small></b></div></div>
            <div class="scan-piles">${piles.map((p) => `<span class="${p.f ? 'px ' + V.rqClass(p.f) : ''}"><b>${esc(p.n)}</b>${p.a}/${p.b}</span>`).join('')}</div>
          </section>
          ${left.length ? `<section class="card"><h3>${U.icon('list')}まだ検品していない <small>${u.units - u.insp}点</small></h3>
            <ul class="scan-list">${left.map((r) => `<li><div><b>${esc(r.space || '—')} ${esc(r.circle)}</b><small>${esc(r.name)} ・ ${esc(whoLabel(r.for))} ・ ${r.insp.length}/${r.qty}点</small></div>
              <span class="scan-units">${Array.from({ length: r.qty }, (_, i) => i + 1).filter((k) => !r.insp.includes(k)).map((k) => unitBtn(r, k, 'manual')).join('')}</span></li>`).join('')}</ul>
            <p class="muted small">タグが読めないときは「◯点目を記録」で手で記録できます。</p></section>`
          : u.units ? `<p class="sf-ok card">${U.icon('check', 'sm')}全${u.units}点の検品が終わりました</p>` : ''}
          ${this.logHTML(unitBtn)}`;
      }
    },
    /** タグ貼り：読んだ品物を大きく見せる（No.・何点目・誰の分・品名・お品書き画像）。貼ったら検品済みにできる */
    paintTag(box, L) {
      const s = S();
      box.className = 'scan-last tagcard ' + (L.kind === 'ok' ? 'ok' : 'ng');
      if (L.kind !== 'ok') {
        box.innerHTML = `<div class="sl-msg">${U.icon('warn')}<b>${esc(MSG[L.kind] ? MSG[L.kind](L, 'insp') : '読み取れません')}</b></div>${HINT[L.kind] ? `<p class="small">${HINT[L.kind]}</p>` : ''}`;
        return;
      }
      const row = HC.ship.tagRows().find((r) => r.iid === L.iid);
      const shots = L.cid && HC.shots && HC.shots.ready ? HC.shots.list(s.state.eventId, L.cid) : [];
      const cur = this.shotIdx && shots[this.shotIdx] ? this.shotIdx : 0;
      const done = L.insp.includes(L.k);
      const parts = L.parts && L.parts.length ? L.parts.filter((p) => String(p.n || '').trim()) : [];
      box.innerHTML = `
        <div class="tc-head">
          <span class="tc-no">No.<b>${row ? row.no : '—'}</b></span>
          <span class="tc-k"><b>${L.k}</b>/${L.qty}点目</span>
          <span class="sl-who ${L.for ? 'px ' + V.rqClass(L.for) : ''}">${esc(whoLabel(L.for))}</span>
        </div>
        <div class="tc-main">
          <div class="tc-img">${shots.length ? `<button type="button" class="tc-shot" data-act="viewShot" data-id="${esc(shots[cur].id)}" aria-label="お品書き画像を拡大"><img data-tcshot="${esc(shots[cur].id)}" src="${shots[cur].thumb || ''}" alt="お品書き画像"></button>
              ${shots.length > 1 ? `<div class="tc-thumbs">${shots.map((m, i) => `<button type="button" class="tc-th${i === cur ? ' on' : ''}" data-tcidx="${i}" aria-label="${i + 1}枚目"><img src="${m.thumb || ''}" alt=""></button>`).join('')}</div>` : ''}
              <small class="muted">押すと拡大します${shots.length > 1 ? `（${shots.length}枚）` : ''}</small>`
            : `<div class="tc-noimg">${U.icon('image')}<span>このサークルのお品書き画像は未登録です</span>${L.cid && HC.shots && HC.shots.ready ? `<button type="button" class="btn sm" data-act="addShot" data-cid="${esc(L.cid)}">${U.icon('plus', 'sm')}画像を追加</button>` : ''}</div>`}</div>
          <div class="tc-info">
            <div class="tc-sp"><b>${esc(L.space || '—')}</b>${esc(L.circle || '')}</div>
            <div class="tc-name">${esc(L.name)}</div>
            <div class="tc-meta">${L.qty}点 ・ ${U.yen(L.cost || 0)}</div>
            ${parts.length ? `<div class="tc-parts">中身：${parts.map((p) => `${esc(p.n)} ×${p.q}`).join('、')}</div>` : ''}
            ${L.memo ? `<div class="tc-memo">${U.icon('note', 'sm')}${esc(L.memo)}</div>` : ''}
            <div class="tc-units">${Array.from({ length: L.qty }, (_, i) => i + 1).map((k) => `<span class="${L.insp.includes(k) ? 'done' : ''}${k === L.k ? ' cur' : ''}">${L.insp.includes(k) ? U.icon('check', 'sm') : ''}${k}/${L.qty}</span>`).join('')}</div>
          </div>
        </div>
        <button type="button" class="btn ${done ? '' : 'primary '}lg block" data-tagdone="${esc(L.iid)}|${L.k}|${L.outside ? 1 : 0}"${done ? ' disabled' : ''}>${U.icon('check')}${done ? `${L.k}/${L.qty}点目は貼って検品済みです` : `貼った（${L.k}/${L.qty}点目を検品済みにする）`}</button>`;
      // 本体の画像に差し替える（まずサムネを出し、あとで大きい画像に）
      const img = U.$('img[data-tcshot]', box);
      if (img) HC.shots.url(img.dataset.tcshot).then((u) => { if (u && img.isConnected) { img.src = u; img.onload = () => setTimeout(() => URL.revokeObjectURL(u), 1000); } }).catch(() => {});
    },
    logHTML(unitBtn) {
      const log = this.log.filter((x) => x.mode === this.mode && (this.mode !== 'pack' || x.box === this.box)).slice(0, 15);
      if (!log.length) return '';
      return `<section class="card"><h3>${U.icon('clock')}今回読んだもの <small>新しい順</small></h3>
        <ul class="scan-list">${log.map((x) => `<li><div><b>${esc(x.space || '')} ${esc(x.name)}</b><small>${esc(whoLabel(x.for))} ・ ${x.k}/${x.qty}点目 ・ ${esc(U.time(x.t))}</small></div>${unitBtn(x, x.k, 'undo')}</li>`).join('')}</ul></section>`;
    },
  };

  // ------------------------------------------------------------------ メニュー（発送モード）
  V.shipMenu = (el) => {
    const tile = (act, icon, label, extra = '') => `<button class="menu-tile" data-act="${act}" ${extra}>${U.icon(icon)}<span>${label}</span></button>`;
    el.innerHTML = `<div class="more-view day-menu">
      <section class="card">
        <h3>${U.icon('box')}発送に使うもの</h3>
        <div class="menu-tiles">
          ${tile('buyCheck', 'qr', 'QRタグ・購入検品表', 'data-parts="list,tags"')}
          ${tile('shipAll', 'print', '梱包・発送伝票をまとめて印刷')}
          ${tile('scanGo', 'check', '購入検品を読み取る', 'data-mode="insp"')}
          ${tile('scanGo', 'box', '梱包を読み取る', 'data-mode="pack"')}
          ${tile('shipCsv', 'download', '発送台帳（CSV）')}
          ${tile('shipDevices', 'sync', '端末と同期')}
          ${tile('nav', 'wallet', '代行の精算', 'data-view="list" data-scroll="proxy"')}
        </div>
      </section>
      <section class="card">
        <h3>${U.icon('more')}発送モード</h3>
        <p class="small muted">発送モードでは、発送の作業に使う画面だけを出しています。計画や当日の画面に戻るときは「発送モードを終える」を押してください。</p>
        <div class="btn-grid2">
          <button class="btn" data-act="fullSettings">${U.icon('more')}すべての設定</button>
          <button class="btn primary" data-act="shipModeOff">${U.icon('undo')}発送モードを終える</button>
        </div>
      </section>
    </div>`;
  };

  // 同期の様子が変わったら「発送」の画面を描き直す（読み取りの画面はカメラを止めないよう中身だけ）
  U.on('sync', () => {
    app.dirty.add('ship');
    if (app.view === 'ship') app.show('ship', { keepScroll: true });
  });

  /** 端末の登録：この端末の名前、同期している端末の一覧、新しい端末を足す（QR） */
  A.shipDevices = () => {
    const Sy = HC.sync;
    if (!Sy.configured()) {
      UI().toast('まず PC で同期を設定し、「設定をスマホへ（QR）」をスマホ・iPad のカメラで読み取ってください', { ms: 7000 });
      return A.syncSetup();
    }
    const ago = (t) => (t ? `${U.md(t)} ${U.time(t)}` : 'まだ同期していません');
    UI().sheet({
      id: 'devices',
      center: true,
      title: '端末と同期',
      html: `<div class="field"><span>この端末の名前</span><div class="row-in"><input class="input" data-devname value="${esc(Sy.deviceName())}" maxlength="20" placeholder="例：PC・iPhone・iPad"><button class="btn" data-devsave>保存</button></div>
          <small class="muted">ほかの端末の一覧に、この名前で出ます。</small></div>
        <h4>同期している端末</h4>
        <ul class="scan-list">${Sy.devices().map((d) => `<li><div><b>${esc(d.name)}${d.me ? '（この端末）' : ''}</b><small>最後の同期：${esc(ago(d.lastAt))}</small></div>${d.me ? '' : `<button class="chip sm" data-forget="${esc(d.id)}">一覧から外す</button>`}</li>`).join('')}</ul>
        <p class="muted small">発送モードの間は、読み取った記録をすぐ送り、7秒ごとにほかの端末の記録を受け取ります。PC と iPhone・iPad で同時に作業しても、変更は自動で合わせます。</p>
        <div class="btn-row wrap">
          <button class="btn" data-act="syncQr">${U.icon('qr')}端末を追加する（QR）</button>
          <button class="btn primary" data-act="shipSyncNow">${U.icon('sync')}いま同期する</button>
        </div>`,
      onMount: (el) => {
        U.$('[data-devsave]', el).onclick = () => { Sy.setDeviceName(U.$('[data-devname]', el).value); UI().toast('名前を保存しました'); Sy.soon(); A.shipDevices(); };
        U.$$('[data-forget]', el).forEach((b) => (b.onclick = () => { Sy.forgetDevice(b.dataset.forget); A.shipDevices(); }));
      },
    });
  };

  /** iPhone を PC の Web カメラにする手順（Windows） */
  A.camHelp = () => UI().sheet({
    id: 'camHelp',
    center: true,
    title: 'iPhone を PC のカメラにする',
    html: `<ol class="a2hs-steps">
        <li>iPhone を Web カメラにするアプリを、PC と iPhone の両方に入れます（例：iVCam、Camo など。どちらも PC 用と iPhone 用があります）</li>
        <li>iPhone を USB ケーブルで PC につなぎ、PC と iPhone の両方でアプリを起動します。PC のアプリに iPhone の映像が出れば準備できています</li>
        <li>クルナビの「読み取り」で「カメラで読み取る」を押し、「カメラを選ぶ」から iPhone のカメラ（アプリの名前のカメラ）を選びます。次からは最初にそのカメラを使います</li>
        <li>iPhone をスタンドなどに固定し、タグを 10〜20cm ほど離して写します。読めると音が鳴り、画面が緑（OK）・黄（読み取り済み）・赤（入れてはいけない）に光ります</li>
      </ol>
      <p class="muted small">ブラウザがカメラの使用を聞いてきたら「許可」を押してください。映像が左右反転していても読み取れます。PC だけで読み取るときは、同期の設定は要りません。</p>
      <div class="btn-row"><button class="btn primary" data-close>閉じる</button></div>`,
  });

  // ------------------------------------------------------------------ 操作
  A.shipModeOn = () => {
    S().setSetting('dayMode', false);
    S().setSetting('shipMode', true);
    app.applyLook();
    app.markAll();
    app.show('ship');
    UI().toast('発送モードにしました。終えるときは「メニュー」の「発送モードを終える」を押してください', { ms: 5000 });
  };
  A.shipModeOff = () => {
    V.scan.stop();
    S().setSetting('shipMode', false);
    app.applyLook();
    app.markAll();
    app.show('list');
    UI().toast('発送モードを終えました');
  };
  A.scanGo = (ds) => {
    if (ds.mode) V.scan.mode = ds.mode;
    if (ds.rid) V.scan.box = ds.rid;
    V.scan.last = null;
    UI().closeAll();
    app.markAll();
    app.show('scan');
  };
  A.shipOpen = (ds) => HC.ship.open(ds.rid);
  /** 発送のお知らせ文をコピー */
  A.shipNotice = async (ds) => {
    const t = HC.ship.noticeText(ds.rid);
    if (await U.copy(t)) UI().toast('発送のお知らせ文をコピーしました。LINE や DM に貼り付けて送れます');
    else UI().prompt('発送のお知らせ文（長押しでコピー）', { value: t, multiline: true, ok: '閉じる' });
  };
  /** 発送台帳（CSV）を書き出す */
  A.shipCsv = () => {
    U.download(`kurunavi_発送台帳_${S().ev().short || 'event'}_${U.today().replace(/-/g, '')}.csv`, HC.ship.ledgerCsv(), 'text/csv');
    UI().toast('発送台帳を書き出しました');
  };
  A.shipDone = (ds) => {
    const r = S().requester(ds.rid);
    if (!r) return;
    const on = !(r.ship && r.ship.shippedAt);
    S().setShipped(ds.rid, on);
    UI().toast(on ? `${r.name}の分を発送済みにしました` : '発送済みを取り消しました', on ? { undo: true, action: { label: 'お知らせ文をコピー', fn: () => A.shipNotice({ rid: ds.rid }) } } : { undo: true });
  };
  A.shipSyncNow = async () => {
    const Sy = HC.sync;
    if (!Sy.configured()) return A.shipDevices();
    UI().toast('最新の状態を確かめています…');
    const r = await (Sy.syncNow ? Sy.syncNow() : Sy.pull());
    if (r && r.error) UI().toast(r.error, { error: true });
    else UI().toast('最新の状態にしました');
    app.refresh();
  };
})();
