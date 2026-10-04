/* 代行の梱包伝票・発送伝票。精算の画面の「梱包・発送伝票を作る」から入力し、それぞれ A4縦1枚に印刷する
   - 梱包伝票：箱に詰めるときに品物と数量を書き込んで確かめる用。同封してもよい見た目にしてある（金額は載せない）
   - 発送伝票：以下
   - 書式は以前の代行（京都みこち）で使っていた「発送伝票」を引き継いで、上位版にしたもの
     （発送伝票の見出し・右上の差出人・梱包日／発送方法／OC名／No. の帯・お届け先様・ご注文内容・
       メモ・備考・A 商品代金／B 送料／合計）。足したもの：スペースとサークルの列、送料の扱いの選択、
       ご用意できなかったもの、伝票番号の連番。
     以前あった「発送元」の欄は右上の差出人と同じ内容なので外した。※の注意書きと宛名ラベルは本人の希望で載せない（1.6.1）
   - 梱包伝票の記入欄は追跡番号だけ（厚さ・重さは測れないので載せない。1.6.1）
   - 宛先・発送の情報は依頼者ごと（EventData.requesters[].ship）、差出人は全イベント共通（state.sender）
   - 精算の方法（振込先など）は書かない（本人の希望）
   - 印刷するもの（両方／梱包伝票／発送伝票）は端末ごとに覚える（localStorage 'kurunavi.slipKind'）。
     両方のときは1人ずつ「梱包伝票 → 発送伝票」の順に出すので、箱ごとに紙がまとまる */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const S = () => HC.store;
  const UI = () => HC.ui;
  const esc = U.esc;
  const Sh = (HC.ship = {});

  Sh.METHODS = ['レターパックライト', 'レターパックプラス', 'ゆうパケット', 'ゆうパケットプラス', 'ゆうパック', 'クリックポスト', '宅急便', '宅急便コンパクト', 'ネコポス', '定形外郵便', '手渡し'];
  const FEE = { charge: '請求に含める', cod: '着払い', none: '書かない' };
  const DEF = {
    note: '梱包内容をご確認ください。\n商品の破損・内容不一致の場合はXのDMまたはメールにてご連絡ください。',
    firstNo: 17,   // 以前の代行で 0016 まで使っていたので、その続きから
  };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const KINDS = { both: '両方', pack: '梱包伝票', ship: '発送伝票' };
  const KIND_KEY = 'kurunavi.slipKind';
  Sh.kind = () => { try { const k = localStorage.getItem(KIND_KEY); return KINDS[k] ? k : 'both'; } catch (e) { return 'both'; } };
  const setKind = (k) => { try { localStorage.setItem(KIND_KEY, k); } catch (e) { /* 覚えられなくても印刷はできる */ } };
  const kindSeg = (k) => `<div class="field"><span>印刷するもの</span><div class="seg sm sf-kind">${Object.entries(KINDS).map(([v, l]) => `<button type="button" class="${k === v ? 'on' : ''}" data-kind="${v}">${l}</button>`).join('')}</div></div>`;
  const kindsOf = (k) => (k === 'both' ? ['pack', 'ship'] : [k]);

  /** 郵便番号を「123-4567」に整える（全角・ハイフン・空白はどれでも可）。7桁でなければ入力のまま */
  Sh.postal = (s) => {
    const d = U.toHalf(s || '').replace(/[^\d]/g, '');
    return d.length === 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : String(s || '').trim();
  };
  const postalOk = (s) => /^\d{3}-\d{4}$/.test(Sh.postal(s));
  const dateTxt = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return `${m[1]}年${+m[2]}月${+m[3]}日（${WD[d.getDay()]}）`;
  };

  /** 差出人（自分）。未入力の項目には既定値 */
  Sh.sender = () => ({ tagline: `${S().ev().name} 代行`, nextNo: DEF.firstNo, ...(S().state.sender || {}) });

  /** 伝票番号。初めて印刷するときに連番を割り当てて覚える（同じ依頼者は何度印刷しても同じ番号。梱包伝票と発送伝票で共通） */
  Sh.ensureNo = (rid) => {
    const r = S().requester(rid);
    if (r && r.ship && r.ship.no) return r.ship.no;
    const snd = Sh.sender();
    const no = Math.max(1, +snd.nextNo || DEF.firstNo);
    S().setShip(rid, { no });
    S().setSender({ nextNo: no + 1 });
    return no;
  };
  const noTxt = (n) => (n ? String(n).padStart(4, '0') : '----');

  /** 伝票に載せる中身（明細・金額・足りない入力） */
  Sh.data = (rid, kind = 'ship') => {
    const s = S();
    const r = s.requester(rid);
    const ship = { method: 'レターパックライト', feeMode: 'charge', fee: 0, date: U.today(), note: DEF.note, ...(r.ship || {}) };
    const m = s.proxySummary(rid);
    // 伝票はスペース番号の順（箱詰めのときに上から照らし合わせやすいように）
    const rows = m.rows.slice().sort((x, y) => x.space.localeCompare(y.space, 'ja', { numeric: true }));
    const got = rows.filter((x) => x.status === 'bought');
    const miss = rows.filter((x) => x.status !== 'bought');
    const fee = ship.feeMode === 'charge' ? Math.max(0, +ship.fee || 0) : 0;
    const snd = Sh.sender();
    const lacks = [];
    if (kind === 'pack') {
      if (!got.length) lacks.push('買えた品物（1つもありません）');
      return { r, ship, snd, got, miss, items: m.bought, fee, total: m.bought + fee, lacks };
    }
    if (!(ship.name || '').trim()) lacks.push('お届け先のお名前');
    if (!postalOk(ship.postal)) lacks.push('郵便番号（7桁）');
    if (!(ship.addr1 || '').trim()) lacks.push('お届け先の住所');
    if (!(snd.name || '').trim()) lacks.push('発送元（自分）の名前');
    if (ship.feeMode === 'charge' && !fee) lacks.push('送料の金額');
    if (!got.length) lacks.push('買えた品物（1つもありません）');
    return { r, ship, snd, got, miss, items: m.bought, fee, total: m.bought + fee, lacks };
  };

  // ------------------------------------------------------------------ 入力の画面
  Sh.open = (rid) => {
    const s = S();
    const r = s.requester(rid);
    if (!r) return;
    const known = !(r.ship && r.ship.addr1) && s.knownShip(r.name, rid);
    const v = Sh.data(rid);
    const snd = v.snd;
    const f = (k, label, val, attrs = '', hint = '') => `<label class="field"><span>${label}</span><input class="input" data-k="${k}" value="${esc(val == null ? '' : val)}" ${attrs}>${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
    const t = (k, label, val, attrs = '') => `<label class="field"><span>${label}</span><textarea class="input" rows="3" data-k="${k}" ${attrs}>${esc(val || '')}</textarea></label>`;
    UI().sheet({
      id: 'ship',
      side: true,
      title: `${esc(r.name)}の梱包・発送伝票`,
      html: `<div class="ship-form">
        <section class="sf-sec">
          <h4>${U.icon('pin', 'sm')}お届け先様</h4>
          ${known ? `<button class="btn sm block" data-known>${U.icon('undo', 'sm')}前回の宛先を使う（${esc(known.name || '')} 〒${esc(known.postal || '')}）</button>` : ''}
          <div class="grid2">
            ${f('name', 'お名前（本名。「様」は自動）', v.ship.name, 'autocomplete="off" data-ship placeholder="例：山田 花子"')}
            ${f('kana', 'フリガナ（任意）', v.ship.kana, 'autocomplete="off" data-ship placeholder="例：ヤマダ ハナコ"')}
          </div>
          <div class="grid2">
            ${f('postal', '郵便番号', v.ship.postal, 'inputmode="numeric" placeholder="例：100-0001" autocomplete="off" data-ship')}
            ${f('phone', '電話番号', v.ship.phone, 'inputmode="tel" autocomplete="off" data-ship placeholder="任意"')}
          </div>
          ${f('addr1', 'ご住所（都道府県から番地まで）', v.ship.addr1, 'autocomplete="off" data-ship placeholder="例：東京都千代田区千代田1-1"')}
          ${f('addr2', '建物名・部屋番号（任意）', v.ship.addr2, 'autocomplete="off" data-ship')}
          <p class="muted small">OC名（伝票の「OC名」）は依頼者の名前「${esc(r.name)}」を使います。</p>
        </section>
        <section class="sf-sec">
          <h4>${U.icon('route', 'sm')}発送</h4>
          <div class="field"><span>発送方法</span><div class="chips wrap sf-methods">${Sh.METHODS.map((x) => `<button type="button" class="chip sm${v.ship.method === x ? ' on' : ''}" data-method="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
          <div class="field"><span>送料</span><div class="seg sm sf-fee">${Object.entries(FEE).map(([k, l]) => `<button type="button" class="${v.ship.feeMode === k ? 'on' : ''}" data-fee="${k}">${l}</button>`).join('')}</div></div>
          <label class="field sf-fee-amt"${v.ship.feeMode === 'charge' ? '' : ' hidden'}><span>送料の金額</span><div class="yen-input"><span>¥</span><input class="input" data-k="fee" inputmode="numeric" value="${v.ship.fee || ''}" placeholder="例：430" data-ship></div></label>
          <div class="grid2">
            ${f('date', '梱包日', v.ship.date, 'type="date" data-ship')}
            ${f('tracking', '追跡番号（任意）', v.ship.tracking, 'inputmode="numeric" autocomplete="off" data-ship', '入れておくと梱包伝票に印刷します')}
          </div>
          ${t('note', 'メモ・備考', v.ship.note, 'data-ship')}
        </section>
        <details class="sf-sec sf-sender"${snd.name ? '' : ' open'}>
          <summary><h4>${U.icon('door', 'sm')}発送元（自分）<small>${snd.name ? esc(snd.name) : '未入力'} ・ 全員の伝票で共通</small></h4></summary>
          <div class="grid2">
            ${f('name', '名前', snd.name, 'autocomplete="off" data-sender placeholder="例：屋号やハンドルネーム"')}
            ${f('x', 'X（任意）', snd.x, 'autocomplete="off" data-sender placeholder="例：@kurunavi"')}
          </div>
          ${f('mail', 'Mail（任意）', snd.mail, 'type="email" autocomplete="off" data-sender')}
          ${f('tagline', '伝票の見出しの下に出す文', snd.tagline, 'autocomplete="off" data-sender')}
          ${f('nextNo', '次の伝票番号', snd.nextNo, 'inputmode="numeric" data-sender', '印刷したときに割り当てて1つ進みます')}
        </details>
        <section class="sf-sum" aria-live="polite"></section>
        <section class="sf-sec sf-docs">
          <h4>${U.icon('print', 'sm')}印刷</h4>
          <ol class="sf-steps">
            <li><b>梱包伝票</b>：箱に詰めるときに、品物と数量にチェックを入れて確かめます（同封できます。金額は載りません）</li>
            <li><b>発送伝票</b>：品物と金額の明細です。箱に同封します</li>
          </ol>
          ${kindSeg(Sh.kind())}
          <div class="btn-grid2">
            <button class="btn" data-preview>${U.icon('note')}プレビュー</button>
            <button class="btn primary" data-print>${U.icon('print')}印刷する</button>
          </div>
        </section>
        <button class="btn block ghost" data-shipped>${U.icon('check')}${r.ship && r.ship.shippedAt ? `発送済み（${esc(U.md(r.ship.shippedAt))}）を戻す` : '発送済みにする'}</button>
        <p class="muted small">入力した内容は自動で保存されます。宛先は次の代行でも「前回の宛先を使う」で呼び出せます。印刷は A4縦です。印刷の設定で「余白：デフォルト」「背景のグラフィック：オン」にすると、黒い帯もきれいに出ます。</p>
      </div>`,
      onMount: (el) => {
        const sum = U.$('.sf-sum', el);
        const paintSum = () => {
          const d = Sh.data(rid);
          sum.innerHTML = `<div class="sf-total"><span>品物 ${U.sum(d.got, (x) => x.qty)}点 ${U.yen(d.items)}${d.ship.feeMode === 'charge' ? ` ＋ 送料 ${U.yen(d.fee)}` : d.ship.feeMode === 'cod' ? '（送料は着払い）' : ''}</span><b>${U.yen(d.total)}</b></div>
            ${d.miss.length ? `<p class="muted small">買えなかった ${d.miss.length}点は「ご用意できなかったもの」として載せます。</p>` : ''}
            ${d.lacks.length ? `<p class="sf-lack">${U.icon('warn', 'sm')}まだ入っていない項目：${d.lacks.map(esc).join('・')}</p>` : `<p class="sf-ok">${U.icon('check', 'sm')}伝票に必要な項目はそろっています</p>`}`;
        };
        const later = U.debounce(paintSum, 120);
        U.$$('[data-ship]', el).forEach((inp) => inp.addEventListener('input', () => {
          const k = inp.dataset.k;
          S().setShip(rid, { [k]: k === 'fee' ? U.parseYen(inp.value) : inp.value });
          later();
        }));
        U.$$('[data-sender]', el).forEach((inp) => inp.addEventListener('input', () => {
          const k = inp.dataset.k;
          S().setSender({ [k]: k === 'nextNo' ? U.parseYen(inp.value) : inp.value });
          later();
        }));
        // 郵便番号は欄を離れたときに「123-4567」に整える
        U.$$('[data-k="postal"]', el).forEach((inp) => inp.addEventListener('blur', () => {
          const p = Sh.postal(inp.value);
          if (p === inp.value) return;
          inp.value = p;
          S().setShip(rid, { postal: p });
          paintSum();
        }));
        U.$$('[data-method]', el).forEach((b) => (b.onclick = () => {
          S().setShip(rid, { method: b.dataset.method });
          U.$$('[data-method]', el).forEach((x) => x.classList.toggle('on', x === b));
          paintSum();
        }));
        U.$$('[data-fee]', el).forEach((b) => (b.onclick = () => {
          S().setShip(rid, { feeMode: b.dataset.fee });
          U.$$('[data-fee]', el).forEach((x) => x.classList.toggle('on', x === b));
          U.$('.sf-fee-amt', el).hidden = b.dataset.fee !== 'charge';
          paintSum();
        }));
        const kb = U.$('[data-known]', el);
        if (kb) kb.onclick = () => {
          const { name, kana, postal, addr1, addr2, phone } = known;
          S().setShip(rid, { name, kana, postal, addr1, addr2, phone });
          Sh.open(rid);
          UI().toast('前回の宛先を入れました');
        };
        U.$$('[data-kind]', el).forEach((b) => (b.onclick = () => {
          setKind(b.dataset.kind);
          U.$$('[data-kind]', el).forEach((x) => x.classList.toggle('on', x === b));
        }));
        U.$('[data-preview]', el).onclick = () => Sh.preview([rid]);
        U.$('[data-print]', el).onclick = () => Sh.print([rid]);
        U.$('[data-shipped]', el).onclick = () => {
          const on = !(S().requester(rid).ship || {}).shippedAt;
          S().setShipped(rid, on);
          Sh.open(rid);
          UI().toast(on ? '発送済みにしました' : '発送済みを戻しました', { undo: true });
        };
        // 既定値をまだ保存していなければ保存しておく（画面と印刷を一致させる）
        const r0 = S().requester(rid).ship || {};
        const init = {};
        ['date', 'method', 'feeMode'].forEach((k) => { if (!r0[k]) init[k] = v.ship[k]; });
        if (r0.note == null) init.note = v.ship.note;
        if (Object.keys(init).length) S().setShip(rid, init);
        // PC では、まだ入っていない最初の欄へ
        const first = U.$$('[data-ship]', el).find((i) => !i.value && ['name', 'postal', 'addr1'].includes(i.dataset.k));
        if (first && matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus(), 80);
        paintSum();
      },
    });
  };

  // ------------------------------------------------------------------ 伝票の中身（画面のプレビューと印刷で共通）
  const addr = (o) => `${esc(o.addr1 || '')}${o.addr2 ? `<br>${esc(o.addr2)}` : ''}`;
  const isRandom = (name) => /ランダム|ガチャ|ブラインド|シークレット/.test(name || '');

  Sh.slipHTML = (rid) => {
    const d = Sh.data(rid);
    const ev = S().ev();
    const sh = d.ship, snd = d.snd;
    const no = noTxt(sh.no);
    const rows = d.got.map((x) => `<tr>
        <td class="sp">${esc(x.space)}</td><td class="ci">${esc(x.circle)}</td>
        <td class="nm">${esc(x.name)}${isRandom(x.name) ? '<span class="tag-rand">ランダム</span>' : ''}</td>
        <td class="qt">×${x.qty}</td><td class="mo">${U.num(x.qty ? Math.round(x.cost / x.qty) : x.cost)}円</td><td class="mo">${U.num(x.cost)}円</td></tr>`).join('');
    const feeRow = sh.feeMode === 'charge' ? `<tr><th>B 送料</th><td>${U.num(d.fee)}円</td></tr>`
      : sh.feeMode === 'cod' ? '<tr><th>B 送料</th><td>着払い</td></tr>' : '';
    return `<article class="slip">
      <div class="slip-sheet">
        <header class="sv-head">
          <div class="sv-title">
            <h1>発 送 伝 票</h1>
            <div class="sv-tag">${esc(snd.tagline || '')}</div>
            <div class="sv-lead">代行購入した品物をお届けします。ご確認をお願いいたします。</div>
          </div>
          <div class="sv-from">
            <div class="sv-fname">${esc(snd.name || '')}</div>
            ${snd.x ? `<div>X（旧Twitter）：${esc(snd.x)}</div>` : ''}
            ${snd.mail ? `<div>Mail：${esc(snd.mail)}</div>` : ''}
            <div class="sv-ask">ご不明点はDM・メールにてご連絡ください</div>
          </div>
        </header>
        <div class="sv-meta">
          <div class="fit"><span class="pill">梱 包 日</span><b>${esc(dateTxt(sh.date))}</b></div>
          <div class="fit"><span class="pill">発送方法</span><b>${esc(sh.method || '')}</b></div>
          <div><span class="pill">OC 名</span><b>${esc(d.r.name)}</b></div>
          <div class="sv-no"><span class="pill">No.</span><b>${esc(no)}</b></div>
        </div>
        <div class="sv-bar arrow">お届け先様</div>
        <table class="sv-kv">
          ${sh.kana ? `<tr><th>フリガナ</th><td colspan="3">${esc(sh.kana)}</td></tr>` : ''}
          <tr><th>お名前</th><td class="big">${esc(sh.name || '')}　様</td><th class="th2">TEL</th><td class="big">${esc(sh.phone || '')}</td></tr>
          <tr><th>〒</th><td colspan="3" class="big">${esc(Sh.postal(sh.postal))}</td></tr>
          <tr><th>ご住所</th><td colspan="3" class="big">${addr(sh)}</td></tr>
        </table>
        <div class="sv-bar sq">ご注文内容</div>
        <div class="sv-order">
          <table class="sv-items">
            <thead><tr><th class="sp">スペース</th><th class="ci">サークル</th><th class="nm">商 品 名</th><th class="qt">数量</th><th class="mo">単価</th><th class="mo">小計</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty">お送りする品物はありません</td></tr>'}</tbody>
            <tfoot><tr><td colspan="5">商品代金 小計</td><td class="mo">${U.num(d.items)}円</td></tr></tfoot>
          </table>
          ${d.miss.length ? `<div class="sv-miss"><div class="lb">ご用意できなかったもの（代金はいただいていません）</div>
            <ul>${d.miss.map((x) => `<li><b>${esc(x.space)}</b> ${esc(x.circle)}：${esc(x.name)} ×${x.qty}<span>${x.status === 'soldout' ? '売り切れ' : '見送り'}</span></li>`).join('')}</ul></div>` : ''}
        </div>
        <div class="sv-bottom">
          <div class="sv-memo"><div class="lb">■ メモ・備考</div><div>${esc(sh.note || '').replace(/\n/g, '<br>')}</div></div>
          <table class="sv-sum">
            <tr><th>A 商品代金</th><td>${U.num(d.items)}円</td></tr>
            ${feeRow}
            <tr class="tot"><th>合　計</th><td>${U.num(d.total)}円</td></tr>
          </table>
        </div>
        <div class="sv-foot">${esc(ev.name)}${S().eventDate() ? ` ${esc(dateTxt(S().eventDate()))}` : ''} 代行分 ・ No.${esc(no)}</div>
      </div>
    </article>`;
  };

  /** 梱包伝票。品物ごとのチェック欄・数えた数・状態のメモ、梱包のチェック、追跡番号の記入欄 */
  Sh.packHTML = (rid) => {
    const d = Sh.data(rid, 'pack');
    const sh = d.ship, snd = d.snd;
    const no = noTxt(sh.no);
    const qty = U.sum(d.got, (x) => x.qty);
    const rand = d.got.some((x) => isRandom(x.name));
    const box = (t) => `<li><i class="pk-box"></i>${t}</li>`;
    const rows = d.got.map((x, i) => `<tr>
        <td class="ck"><i class="pk-box"></i></td><td class="no">${i + 1}</td>
        <td class="sp">${esc(x.space)}</td><td class="ci">${esc(x.circle)}</td>
        <td class="nm">${esc(x.name)}${isRandom(x.name) ? '<span class="tag-rand">ランダム</span>' : ''}</td>
        <td class="qt">×${x.qty}</td><td class="cnt"><span>／${x.qty}</span></td><td class="memo"></td></tr>`).join('');
    const to = sh.addr1 ? `〒${esc(Sh.postal(sh.postal))}　${esc(sh.addr1)}${sh.addr2 ? ' ' + esc(sh.addr2) : ''}` : '';
    return `<article class="slip pack">
      <div class="slip-sheet">
        <header class="sv-head">
          <div class="sv-title">
            <h1>梱 包 伝 票</h1>
            <div class="sv-tag">${esc(snd.tagline || '')}</div>
            <div class="sv-lead">梱包のときに、品物と数量を1点ずつ確認した記録です。</div>
          </div>
          <div class="sv-from">
            <div class="sv-fname">${esc(snd.name || '')}</div>
            ${snd.x ? `<div>X（旧Twitter）：${esc(snd.x)}</div>` : ''}
            ${snd.mail ? `<div>Mail：${esc(snd.mail)}</div>` : ''}
            <div class="sv-ask">ご不明点はDM・メールにてご連絡ください</div>
          </div>
        </header>
        <div class="sv-meta">
          <div class="fit"><span class="pill">梱 包 日</span><b>${esc(dateTxt(sh.date))}</b></div>
          <div class="fit"><span class="pill">発送方法</span><b>${esc(sh.method || '')}</b></div>
          <div><span class="pill">OC 名</span><b>${esc(d.r.name)}</b></div>
          <div class="sv-no"><span class="pill">No.</span><b>${esc(no)}</b></div>
        </div>
        <div class="pk-to"><span class="lb">お届け先</span><b>${esc(sh.name || '')}${sh.name ? '　様' : ''}</b><span>${to}</span></div>
        <div class="sv-bar sq">梱包する品物<span class="pk-count">${d.got.length}種類・合計 ${qty}点</span></div>
        <div class="sv-order">
          <table class="sv-items pk-items">
            <thead><tr><th class="ck">確認</th><th class="no">#</th><th class="sp">スペース</th><th class="ci">サークル</th><th class="nm">商 品 名</th><th class="qt">数量</th><th class="cnt">数えた数</th><th class="memo">状態・メモ</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="8" class="empty">梱包する品物はありません</td></tr>'}</tbody>
            <tfoot><tr><td colspan="5">合計</td><td class="qt">${qty}点</td><td class="cnt"><span>／${qty}</span></td><td></td></tr></tfoot>
          </table>
          ${d.miss.length ? `<div class="sv-miss"><div class="lb">ご用意できなかったもの（同封していません）</div>
            <ul>${d.miss.map((x) => `<li><b>${esc(x.space)}</b> ${esc(x.circle)}：${esc(x.name)} ×${x.qty}<span>${x.status === 'soldout' ? '売り切れ' : '見送り'}</span></li>`).join('')}</ul></div>` : ''}
        </div>
        <div class="pk-bottom">
          <div class="pk-check">
            <div class="lb">■ 梱包のチェック</div>
            <ul>
              ${box('品物と数量が明細と合っている')}
              ${box('破損・汚れ・折れがない')}
              ${rand ? box('ランダム商品は未開封のまま') : ''}
              ${box('OPP袋・緩衝材で保護した（紙ものは防水）')}
            </ul>
          </div>
          <div class="pk-fill">
            <div class="lb">■ 追跡番号</div>
            <div class="pk-trk">${esc(sh.tracking || '')}</div>
            <div class="pk-trk-note">発送したあとに書き写しておくと、問い合わせのときに便利です</div>
          </div>
        </div>
        <div class="pk-memo"><div class="lb">■ メモ</div><div class="pk-lines"><i></i><i></i><i></i><i></i><i></i></div></div>
        <div class="sv-foot">${esc(S().ev().name)}${S().eventDate() ? ` ${esc(dateTxt(S().eventDate()))}` : ''} 代行分 ・ 梱包伝票 ・ No.${esc(no)}</div>
      </div>
    </article>`;
  };
  /** 選んだ種類の伝票を1人ずつ並べる（両方なら 梱包 → 発送 の順） */
  const docsHTML = (rids, kind) => rids.map((rid) => kindsOf(kind).map((k) => (k === 'pack' ? Sh.packHTML(rid) : Sh.slipHTML(rid))).join('')).join('');

  // ------------------------------------------------------------------ プレビュー・印刷
  /** 入力の足りないところがあれば、印刷の前に確かめる */
  const checkLacks = async (rids, kind) => {
    const k = kind === 'pack' ? 'pack' : 'ship';
    const lacks = rids.map((rid) => ({ r: S().requester(rid), l: Sh.data(rid, k).lacks })).filter((x) => x.l.length);
    if (!lacks.length) return true;
    return UI().confirm(`次の項目がまだ入っていません。このまま印刷しますか？\n\n${lacks.map((x) => `${x.r.name}：${x.l.join('・')}`).join('\n')}`, { ok: '印刷する', cancel: '戻って入れる', title: '入力の確認' });
  };

  Sh.preview = (rids, kind = Sh.kind()) => {
    const n = rids.length * kindsOf(kind).length;
    UI().sheet({
      id: 'slipPreview',
      center: true,
      cls: 'slip-preview-sheet',
      title: `伝票のプレビュー<small>${rids.length}人・${n}枚</small>`,
      html: `${kindSeg(kind)}
        <div class="slip-preview">${rids.map((rid) => kindsOf(kind).map((k) => `<div class="sp-page">${k === 'pack' ? Sh.packHTML(rid) : Sh.slipHTML(rid)}</div>`).join('')).join('')}</div>
        ${rids.some((rid) => !(S().requester(rid).ship || {}).no) ? '<p class="muted small">番号が「----」の伝票は、印刷するときに番号を割り当てます。</p>' : ''}
        <div class="btn-row"><button class="btn ghost" data-close>閉じる</button><button class="btn primary" data-print>${U.icon('print')}印刷する</button></div>`,
      onMount: (el) => {
        U.$('[data-print]', el).onclick = () => Sh.print(rids, kind);
        U.$$('[data-kind]', el).forEach((b) => (b.onclick = () => { setKind(b.dataset.kind); Sh.preview(rids, b.dataset.kind); }));
        // A4（210mm）を画面の幅に合わせて縮める
        requestAnimationFrame(() => U.$$('.sp-page', el).forEach((pg) => {
          const slip = U.$('.slip', pg);
          const k = pg.clientWidth / slip.offsetWidth;
          slip.style.transform = `scale(${k})`;
          pg.style.height = `${Math.ceil(slip.offsetHeight * k)}px`;
        }));
      },
    });
  };

  Sh.print = async (rids, kind = Sh.kind()) => {
    if (!(await checkLacks(rids, kind))) return;
    rids.forEach((rid) => Sh.ensureNo(rid));   // 番号は印刷するときに割り当てる
    UI().closeAll();
    const box = document.createElement('div');
    box.id = 'printsheet';
    box.className = 'slips';
    box.innerHTML = docsHTML(rids, kind);
    document.body.appendChild(box);
    document.body.classList.add('printing', 'printing-slips');
    const cleanup = () => {
      document.body.classList.remove('printing', 'printing-slips');
      box.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => { window.print(); setTimeout(cleanup, 800); }, 80);
  };

  /** 発送の進み具合。none=送るものが無い / shipped=発送済み / ready=伝票の入力がそろった / lack=まだ足りない */
  Sh.state = (rid) => {
    const r = S().requester(rid);
    if (!r) return 'none';
    if (r.ship && r.ship.shippedAt) return 'shipped';
    if (!S().proxySummary(rid).boughtCount) return 'none';
    return Sh.data(rid).lacks.length ? 'lack' : 'ready';
  };
  Sh.STATE = { shipped: '発送済み', ready: '伝票の準備OK', lack: '伝票の入力がまだ', none: '' };

  /** 買えた品物がある依頼者（まとめて印刷の対象） */
  Sh.printable = () => S().requesters().filter((r) => S().proxySummary(r.id).boughtCount > 0).map((r) => r.id);
})();
