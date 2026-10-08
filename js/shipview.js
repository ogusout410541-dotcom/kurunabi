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
            ${step(2, '購入検品', all.units > 0 && all.insp === all.units, `スマホでタグを読むと、1点ずつ検品済みになります（${all.insp}/${all.units}点）`, `<button class="btn sm" data-act="scanGo" data-mode="insp">${U.icon('qr', 'sm')}読み取る</button>`)}
            ${step(3, '宛先を入力する', rq.length > 0 && addrOk === rq.length, `依頼者ごとにお届け先と発送方法を入力します（${addrOk}/${rq.length}人）`)}
            ${step(4, '梱包', px.units > 0 && px.pack === px.units, `箱を選んでタグを読むと、入れてよい品物か・足りない品物が分かります（${px.pack}/${px.units}点）`)}
            ${step(5, '伝票を印刷して同封する', false, '梱包伝票と発送伝票を A4 で印刷します', `<button class="btn sm" data-act="shipAll">${U.icon('print', 'sm')}印刷</button>`)}
            ${step(6, '発送済みにする', rq.length > 0 && shipped === rq.length, `追跡番号を入れて、発送済みにします（${shipped}/${rq.length}人）`)}
          </ol>
        </section>
        <h3 class="sm-sec-title">${U.icon('box')}箱（依頼者ごと）</h3>
        ${rq.length ? rq.map(({ r, b, st }) => `<section class="card sm-box ${st}">
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
          </section>`).join('') : '<p class="muted card">代行の品物で買えたものがまだありません。</p>'}
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
      return `<p class="sf-lack small">${U.icon('warn', 'sm')}同期を設定していません。PC で印刷したタグをスマホで読むには、同期で計画をそろえてください。<button class="link-btn" data-act="shipDevices">端末を登録する</button></p>`;
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
    unknown: 'PC で作った品物は、同期で受け取ってから読み直してください',
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
        el.innerHTML = `<div class="scan-view">
          <div class="seg scan-mode">
            <button type="button" class="${this.mode === 'insp' ? 'on' : ''}" data-scanmode="insp">${U.icon('check', 'sm')}購入検品</button>
            <button type="button" class="${this.mode === 'pack' ? 'on' : ''}" data-scanmode="pack">${U.icon('box', 'sm')}梱包</button>
          </div>
          ${this.mode === 'pack' ? '<div class="scan-boxes"></div>' : '<p class="muted small scan-lead">タグを読むと、検品済みになります。下に大きく出る「誰の分」を見て、人ごとに分けて置いてください。</p>'}
          <div class="scan-cam">
            <video playsinline muted></video>
            <div class="scan-aim" aria-hidden="true"></div>
            <div class="scan-flash" aria-hidden="true"></div>
            <div class="scan-off">
              <button type="button" class="btn primary lg" data-scanstart>${U.icon('camera')}カメラで読み取る</button>
              <small>タグの QR を、真ん中の枠に写してください</small>
            </div>
            <div class="scan-ctl">
              <button type="button" class="icon-btn" data-torch aria-label="ライト">${U.icon('sun')}</button>
              <button type="button" class="btn sm" data-scanstop>止める</button>
            </div>
          </div>
          <div class="scan-last" aria-live="assertive"></div>
          <div class="scan-body"></div>
        </div>`;
        this.bind(el);
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
        if (b.hasAttribute('data-torch')) { if (this.cam) this.cam.torch(!(this.torch = !this.torch)).then((ok) => { if (!ok) UI().toast('この端末ではライトを使えません'); }); return; }
        if (b.dataset.manual) {
          // タグが読めないときに手で記録する
          const [iid, k, out] = b.dataset.manual.split('|');
          S().setUnit(iid, +k, this.mode, true, out === '1');
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
    },
    async start(el) {
      if (this.cam) return;
      const v = U.$('.scan-cam video', el);
      if (!HC.qrscan.supported()) return UI().toast('この端末・ブラウザではカメラを使えません。公開版（https）のページで開いているか確かめてください', { error: true, ms: 6000 });
      try {
        beep('prep');   // 音は押した操作のあとでないと鳴らせないので、ここで準備しておく
        this.cam = await HC.qrscan.start(v, (text) => this.onRead(text, el));
        this.paintCam(el);
      } catch (e) {
        this.cam = null;
        const n = e && e.name;
        UI().toast(n === 'NotAllowedError' ? 'カメラの使用が許可されていません。設定アプリの Safari →「カメラ」で許可してください（ホーム画面のアプリは、いったん閉じて開き直すと聞き直されます）'
          : n === 'NotFoundError' ? 'カメラが見つかりませんでした' : 'カメラを起動できませんでした', { error: true, ms: 7000 });
      }
    },
    stop() {
      if (this.cam) { this.cam.stop(); this.cam = null; }
      this.torch = false;
    },
    onRead(text, el) {
      const res = S().scanTag(text, this.mode, this.box);
      const rec = { ...res, mode: this.mode, box: this.box, t: Date.now() };
      this.last = rec;
      const tone = TONE[res.kind] || 'ng';
      beep(tone);
      const flash = U.$('.scan-flash', el);
      if (flash) { flash.className = 'scan-flash ' + tone; void flash.offsetWidth; flash.classList.add('go'); }
      if (res.kind === 'ok') this.log.unshift(rec);
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
      if (L) {
        const tone = TONE[L.kind] || 'ng';
        const b = this.mode === 'pack' && this.box ? boxInfo(this.box) : null;
        const complete = b && b.done && !(this.out[this.box] || []).length;
        last.className = 'scan-last ' + tone;
        last.innerHTML = `<div class="sl-msg">${U.icon(tone === 'ok' ? 'check' : 'warn')}<b>${esc(MSG[L.kind] ? MSG[L.kind](L, L.mode) : '読み取れません')}</b></div>
          ${L.name ? `<div class="sl-item"><span class="sl-who ${L.for ? 'px ' + V.rqClass(L.for) : ''}">${esc(whoLabel(L.for))}</span>
            <b>${esc(L.space || '')} ${esc(L.circle || '')}</b><span>${esc(L.name)}　<b>${L.k}/${L.qty}</b>点目</span></div>` : ''}
          ${HINT[L.kind] ? `<p class="small">${HINT[L.kind]}</p>` : ''}
          ${L.kind === 'unknown' ? `<button class="btn sm" data-act="shipSyncNow">${U.icon('sync', 'sm')}PC の最新を受け取る</button>` : ''}
          ${complete ? `<div class="sl-done">${U.icon('check')}過不足なし：${esc(rqName(this.box))}の分 全${b.units}点がそろいました
            <div class="btn-grid2"><button class="btn" data-act="shipOpen" data-rid="${esc(this.box)}">${U.icon('print', 'sm')}伝票を印刷</button><button class="btn primary" data-act="shipDone" data-rid="${esc(this.box)}">${U.icon('truck', 'sm')}発送済みにする</button></div></div>` : ''}`;
      } else {
        last.className = 'scan-last';
        last.innerHTML = '';
      }
      // 進み具合と一覧
      const body = U.$('.scan-body', el);
      const unitBtn = (r, k, act) => `<button type="button" class="chip sm" data-${act}="${esc(r.iid)}|${k}${act === 'undo' ? `|${this.mode}` : ''}|${r.outside ? 1 : 0}">${k}点目${act === 'manual' ? 'を記録' : 'を取り消す'}</button>`;
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
  A.shipDone = (ds) => {
    const r = S().requester(ds.rid);
    if (!r) return;
    const on = !(r.ship && r.ship.shippedAt);
    S().setShipped(ds.rid, on);
    UI().toast(on ? `${r.name}の分を発送済みにしました` : '発送済みを取り消しました', { undo: true });
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
