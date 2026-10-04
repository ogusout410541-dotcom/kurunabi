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
  const FEE = { charge: '請求に含める', cod: '着払い', none: '記載しない' };
  const DEF = {
    note: 'お手数ですが、到着後に内容をご確認ください。\n破損や内容の相違がございましたら、XのDMまたはメールにてご連絡ください。',
    firstNo: 17,   // 以前の代行で 0016 まで使っていたので、その続きから
  };
  const OLD_NOTE = '梱包内容をご確認ください。\n商品の破損・内容不一致の場合はXのDMまたはメールにてご連絡ください。';   // 1.6.1 までの既定（そのままなら新しい文面に）
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const KINDS = { both: '両方', pack: '梱包伝票', ship: '発送伝票' };
  const KIND_KEY = 'kurunavi.slipKind';
  Sh.kind = () => { try { const k = localStorage.getItem(KIND_KEY); return KINDS[k] ? k : 'both'; } catch (e) { return 'both'; } };
  const setKind = (k) => { try { localStorage.setItem(KIND_KEY, k); } catch (e) { /* 覚えられなくても印刷はできる */ } };
  const kindBtns = (k) => `<div class="seg sm sf-kind">${Object.entries(KINDS).map(([v, l]) => `<button type="button" class="${k === v ? 'on' : ''}" data-kind="${v}">${l}</button>`).join('')}</div>`;
  const kindSeg = (k) => `<div class="field"><span>印刷するもの</span>${kindBtns(k)}</div>`;
  const kindsOf = (k) => (k === 'both' ? ['pack', 'ship'] : [k]);
  /** セット商品らしい品名（内容が未入力なら入力画面で知らせる） */
  const SETLIKE = /セット|詰め合わせ|詰合せ|福袋|まとめ|BOX|ボックス/i;
  Sh.isSetLike = (name) => SETLIKE.test(name || '');
  /** セットの内容を1行ずつ読む。「本 ×1」「ステッカー 2枚」「ポストカード」（数量を省くと1）。読点で区切ってもよい */
  Sh.parseParts = (text) => String(text || '').split(/\n|、/).map((l) => U.toHalf(l).trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)\s*(?:[×xX*]\s*(\d+)|(\d+)\s*(?:個|枚|点|冊|本|部|種|セット))$/.exec(l);
    const n = (m && m[1] ? m[1] : l).replace(/^[-・*•]\s*/, '').trim();
    return { n, q: m && m[1] ? Math.max(1, +(m[2] || m[3])) : 1 };
  }).filter((p) => p.n);
  const partsText = (parts) => (parts || []).map((p) => `${p.n} ×${p.q}`).join('\n');
  /** 梱包で数える点数（セットは内容の数 × セットの数） */
  const leafQty = (x) => (x.parts ? U.sum(x.parts, (p) => p.q) * x.qty : x.qty);

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
    if (ship.note === OLD_NOTE) ship.note = DEF.note;
    const m = s.proxySummary(rid);
    // 伝票はスペース番号の順（箱詰めのときに上から照らし合わせやすいように）
    const rows = m.rows.slice().sort((x, y) => x.space.localeCompare(y.space, 'ja', { numeric: true })).map((x) => {
      const parts = (x.parts || []).filter((p) => String(p.n || '').trim());   // 入力途中の空の行は載せない
      return { ...x, parts: parts.length ? parts : null };
    });
    const got = rows.filter((x) => x.status === 'bought');
    const miss = rows.filter((x) => x.status === 'soldout' || x.status === 'skip');   // 売り切れ・見送りだけ（まだの品物は伝票に載せない）
    const todo = rows.filter((x) => x.status === 'todo');
    const fee = ship.feeMode === 'charge' ? Math.max(0, +ship.fee || 0) : 0;
    const snd = Sh.sender();
    const lacks = [];
    const out = { r, ship, snd, got, miss, todo, items: m.bought, fee, total: m.bought + fee, lacks };
    if (kind === 'pack') return out;
    if (!(ship.name || '').trim()) lacks.push('お名前');
    if (!postalOk(ship.postal)) lacks.push('郵便番号');
    if (!(ship.addr1 || '').trim()) lacks.push('ご住所');
    if (!(snd.name || '').trim()) lacks.push('発送元の名前');
    if (ship.feeMode === 'charge' && !fee) lacks.push('送料');
    return out;
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
      center: true,
      cls: 'ship-work',   // PC では中央の大きな作業画面。スマホはふつうの下からのシート
      title: `${esc(r.name)}の梱包・発送伝票<small class="sf-saved">自動で保存されます</small>`,
      html: `<div class="ship-work-in"><div class="ship-form">
        <nav class="sf-nav" aria-label="入力の進み具合"></nav>
        <section class="sf-sec" id="sf-to">
          <h4><span class="sf-no">1</span>お届け先様</h4>
          ${known ? `<button class="btn sm block" data-known>${U.icon('undo', 'sm')}前回の宛先を使う（${esc(known.name || '')} 〒${esc(known.postal || '')}）</button>` : ''}
          <div class="grid2">
            ${f('name', 'お名前（「様」は自動で付きます）', v.ship.name, 'autocomplete="off" data-ship placeholder="例：山田 花子"')}
            ${f('kana', 'フリガナ（任意）', v.ship.kana, 'autocomplete="off" data-ship placeholder="例：ヤマダ ハナコ"')}
          </div>
          <div class="grid2">
            ${f('postal', '郵便番号', v.ship.postal, 'inputmode="numeric" placeholder="例：100-0001" autocomplete="off" data-ship')}
            ${f('phone', '電話番号（任意）', v.ship.phone, 'inputmode="tel" autocomplete="off" data-ship')}
          </div>
          ${f('addr1', 'ご住所（都道府県から番地まで）', v.ship.addr1, 'autocomplete="off" data-ship placeholder="例：東京都千代田区千代田1-1"')}
          ${f('addr2', '建物名・部屋番号（任意）', v.ship.addr2, 'autocomplete="off" data-ship')}
          <p class="muted small">伝票の「OC名」には、依頼者の名前（${esc(r.name)}）が入ります。お名前や住所が分からないときは空けたままにして、あとから入力できます。</p>
        </section>
        <section class="sf-sec" id="sf-ship">
          <h4><span class="sf-no">2</span>発送</h4>
          <div class="field"><span>発送方法</span><div class="chips wrap sf-methods">${Sh.METHODS.map((x) => `<button type="button" class="chip sm${v.ship.method === x ? ' on' : ''}" data-method="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
          <div class="field"><span>送料</span><div class="seg sm sf-fee">${Object.entries(FEE).map(([k, l]) => `<button type="button" class="${v.ship.feeMode === k ? 'on' : ''}" data-fee="${k}">${l}</button>`).join('')}</div></div>
          <label class="field sf-fee-amt"${v.ship.feeMode === 'charge' ? '' : ' hidden'}><span>送料の金額</span><div class="yen-input"><span>¥</span><input class="input" data-k="fee" inputmode="numeric" value="${v.ship.fee || ''}" placeholder="例：430" data-ship></div></label>
          <div class="grid2">
            ${f('date', '梱包日', v.ship.date, 'type="date" data-ship')}
            ${f('tracking', '追跡番号（任意）', v.ship.tracking, 'inputmode="numeric" autocomplete="off" data-ship', '入力すると梱包伝票に印刷されます')}
          </div>
          ${t('note', 'メモ・備考（発送伝票に載ります）', v.ship.note, 'data-ship')}
        </section>
        <section class="sf-sec sf-parts-sec" id="sf-parts"></section>
        <section class="sf-sum" aria-live="polite"></section>
        <section class="sf-sec sf-docs">
          <h4>${U.icon('print', 'sm')}印刷するもの</h4>
          <ol class="sf-steps">
            <li><b>梱包伝票</b>：箱詰めのときに、品物を1点ずつ検品します。金額は載らないので、そのまま同封できます</li>
            <li><b>発送伝票</b>：品物と金額の明細です。箱に同封してください</li>
          </ol>
          ${kindBtns(Sh.kind())}
        </section>
        <details class="sf-sec sf-sender" id="sf-from"${snd.name ? '' : ' open'}>
          <summary><h4><span class="sf-no">4</span>発送元（自分）<small>${snd.name ? esc(snd.name) : '未入力'} ・ 全員の伝票で共通</small></h4></summary>
          <div class="grid2">
            ${f('name', '名前', snd.name, 'autocomplete="off" data-sender placeholder="例：屋号・ハンドルネーム"')}
            ${f('x', 'X（任意）', snd.x, 'autocomplete="off" data-sender placeholder="例：@kurunavi"')}
          </div>
          ${f('mail', 'Mail（任意）', snd.mail, 'type="email" autocomplete="off" data-sender')}
          ${f('tagline', '見出しの下に入る文', snd.tagline, 'autocomplete="off" data-sender')}
          ${f('nextNo', '次の伝票番号', snd.nextNo, 'inputmode="numeric" data-sender', '印刷するたびに、この番号から順に付けます')}
        </details>
        <button class="btn block ghost" data-shipped>${U.icon('check')}${r.ship && r.ship.shippedAt ? `発送済みを取り消す（${esc(U.md(r.ship.shippedAt))}に発送）` : '発送済みにする'}</button>
        <p class="muted small">入力した内容は自動で保存されます。宛先は、次の代行でも「前回の宛先を使う」から呼び出せます。用紙は A4縦です。黒い帯が印刷されないときは、印刷の設定で「背景のグラフィック」をオンにしてください。</p>
        <div class="sf-actions">
          <button class="btn" data-keep>${U.icon('save')}一時保存して閉じる</button>
          <button class="btn" data-preview>${U.icon('note')}プレビュー</button>
          <button class="btn primary" data-print>${U.icon('print')}印刷</button>
        </div>
      </div>
      <aside class="ship-pv" aria-label="印刷のプレビュー">
        <div class="spv-head"><b>${U.icon('note', 'sm')}プレビュー</b>${kindBtns(Sh.kind())}<button class="btn" data-keep>${U.icon('save')}一時保存して閉じる</button><button class="btn primary" data-print2>${U.icon('print')}印刷する</button></div>
        <div class="spv-pages slip-preview"></div>
        <p class="spv-note muted small">梱包伝票は箱詰めの検品に、発送伝票は箱に同封する明細に使います。どちらも A4縦で印刷します。</p>
      </aside></div>`,
      onMount: (el) => {
        // PC：右側のプレビューを入力に合わせて描き直す（幅が狭い画面では出さない）
        const pv = U.$('.spv-pages', el);
        const paintPv = () => {
          if (!pv || !matchMedia('(min-width: 960px)').matches) return;
          const top = pv.scrollTop;
          pv.innerHTML = kindsOf(Sh.kind()).map((k) => `<div class="sp-page">${k === 'pack' ? Sh.packHTML(rid) : Sh.slipHTML(rid)}</div>`).join('');
          scalePages(pv);
          pv.scrollTop = top;
        };
        const pvLater = U.debounce(paintPv, 250);
        if (pv && window.ResizeObserver) new ResizeObserver(() => scalePages(pv)).observe(pv);
        const sum = U.$('.sf-sum', el);
        const paintSum = () => {
          const d = Sh.data(rid);
          sum.innerHTML = `<div class="sf-total"><span>品物 ${U.sum(d.got, (x) => x.qty)}点 ${U.yen(d.items)}${d.ship.feeMode === 'charge' ? ` ＋ 送料 ${U.yen(d.fee)}` : d.ship.feeMode === 'cod' ? '（送料は着払い）' : ''}</span><b>${U.yen(d.total)}</b></div>
            ${d.miss.length ? `<p class="muted small">買えなかった ${d.miss.length}点は、伝票の「ご用意できなかった品物」に載ります。</p>` : ''}
            ${d.todo.length ? `<p class="sf-lack">${U.icon('warn', 'sm')}まだ購入の記録がない品物が ${d.todo.length}点あります（伝票には載りません）：${d.todo.map((x) => esc(`${x.space} ${x.name}`)).join('・')}</p>` : ''}
            ${!d.got.length ? `<p class="sf-lack">${U.icon('warn', 'sm')}買えた品物がまだありません</p>` : ''}
            ${(() => { const n = d.got.filter((x) => !x.parts && Sh.isSetLike(x.name)).length; return n ? `<p class="muted small">セットの内容が未登録の品物が ${n}件あります（未登録のままでも印刷できます）。</p>` : ''; })()}
            ${d.lacks.length ? `<p class="sf-lack">${U.icon('warn', 'sm')}未入力：${d.lacks.map(esc).join('・')}</p>` : d.got.length ? `<p class="sf-ok">${U.icon('check', 'sm')}必要な項目はすべて入力済みです</p>` : ''}`;
          pvLater();
          paintNav(d);
        };
        const nav = U.$('.sf-nav', el);
        const paintNav = (d) => {
          const has = (k) => d.lacks.includes(k);
          const to = ['お名前', '郵便番号', 'ご住所'].filter(has);
          const sets = d.got.filter((x) => !x.parts && Sh.isSetLike(x.name)).length;
          const items = [
            ['sf-to', 1, 'お届け先', to.length ? `未入力 ${to.length}件` : '', to.length ? `未入力：${to.join('・')}` : ''],
            ['sf-ship', 2, '発送', has('送料') ? '送料が未入力' : '', ''],
            ['sf-parts', 3, 'セットの内容', sets ? `未登録 ${sets}件` : '', ''],
            ['sf-from', 4, '発送元', has('発送元の名前') ? '名前が未入力' : '', ''],
          ];
          nav.innerHTML = items.map(([id, n, label, warn, tip]) => `<button type="button" class="sf-nav-i${warn ? ' warn' : ' ok'}" data-go="${id}" title="${esc(tip || warn || '入力済み')}"><span class="sf-no">${n}</span><span><b>${label}</b><small>${warn ? esc(warn) : '入力済み'}</small></span></button>`).join('');
        };
        nav.onclick = (e) => {
          const b = e.target.closest('[data-go]');
          const sec = b && U.$('#' + b.dataset.go, el);
          if (!sec) return;
          if (sec.tagName === 'DETAILS') sec.open = true;
          // 上に固定した進み具合の帯に隠れないよう、その高さぶん下げて見せる（PC は入力の列、スマホはシートがスクロールする）
          const sc = [U.$('.ship-form', el), U.$('.sheet-body', el)].find((x) => x && /auto|scroll/.test(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight);
          if (sc) sc.scrollTo({ top: sc.scrollTop + sec.getBoundingClientRect().top - sc.getBoundingClientRect().top - nav.offsetHeight - 8, behavior: 'smooth' });
          const first = U.$$('input, textarea', sec).find((i) => !i.value);
          if (first && matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus({ preventScroll: true }), 350);
        };
        const later = U.debounce(paintSum, 120);
        // 保存した時刻を見出しに出す（入力のたびに保存しているのを見て分かるように）
        const mark = () => { const t = U.$('.sf-saved', el); if (t) t.textContent = `保存しました（${U.time(Date.now())}）`; };
        U.$$('[data-keep]', el).forEach((b) => (b.onclick = () => {
          const lacks = Sh.data(rid).lacks;
          UI().close('ship');
          UI().toast(lacks.length ? `保存しました。続きは精算の画面の「梱包・発送伝票を作る」から入力できます（未入力：${lacks.join('・')}）` : '保存しました');
        }));
        // セットの内容：品物ごとに中身を登録すると、梱包伝票で1点ずつ検品できる
        const partsSec = U.$('.sf-parts-sec', el);
        // 入力中の行（品名が空）も含めた、保存されているそのままの内容
        const rawParts = (cid, iid) => {
          const it = ((S().d().entries[cid] || {}).items || []).find((i) => i.id === iid);
          return it && it.parts ? it.parts.map((p) => ({ ...p })) : [];
        };
        const paintParts = (focus) => {
          const d = Sh.data(rid, 'pack');
          partsSec.hidden = !d.got.length;
          if (!d.got.length) return;
          partsSec.innerHTML = `<h4><span class="sf-no">3</span>セットの内容<small>セットの品物は中身を登録すると、梱包伝票で中身を1点ずつ検品できます</small></h4>
            <div class="spc-list">${d.got.map((x) => {
              const raw = rawParts(x.cid, x.iid);
              const need = !raw.length && Sh.isSetLike(x.name);
              // セットではなさそうで中身も無い品物は1行にたたむ（必要なときだけ登録できるように）
              if (!raw.length && !need) {
                return `<div class="spc plain" data-cid="${esc(x.cid)}" data-iid="${esc(x.iid)}">
                  <div class="spc-head"><span class="spc-sp">${esc(x.space)}</span><b>${esc(x.name)}</b><span class="spc-q">×${x.qty}</span></div>
                  <button type="button" class="chip sm ghost" data-padd>${U.icon('plus', 'sm')}中身を登録</button></div>`;
              }
              return `<div class="spc${raw.length ? ' has' : ''}${need ? ' need' : ''}" data-cid="${esc(x.cid)}" data-iid="${esc(x.iid)}">
                <div class="spc-head"><span class="spc-sp">${esc(x.space)}</span><b>${esc(x.name)}</b><span class="spc-q">×${x.qty}</span></div>
                ${raw.length ? `<label class="spc-lb">中身 <small>${x.qty > 1 ? `数量は1セットあたり（梱包伝票には ×${x.qty} した数で載ります）` : '品名と数量'}</small></label>
                <div class="ie-list">${raw.map((p, j) => `<div class="ie-row spc-row">
                  <input class="input ie-name" data-pn="${j}" value="${esc(p.n)}" placeholder="中身の品名（例：本）" enterkeyhint="next" autocomplete="off">
                  <div class="stepper sm"><button type="button" class="icon-btn" data-pq="${j}" data-d="-1" aria-label="1つ減らす">${U.icon('minus', 'sm')}</button><b>${p.q}</b><button type="button" class="icon-btn" data-pq="${j}" data-d="1" aria-label="1つ増やす">${U.icon('plus', 'sm')}</button></div>
                  <button type="button" class="icon-btn" data-pdel="${j}" aria-label="この行を消す">${U.icon('trash', 'sm')}</button>
                </div>`).join('')}</div>` : need ? '<p class="spc-need">セットの中身が未登録です</p>' : ''}
                <div class="chips wrap">
                  <button type="button" class="chip sm" data-padd>${U.icon('plus', 'sm')}${raw.length ? '中身を追加' : 'セットの中身を登録'}</button>
                  <button type="button" class="chip sm ghost" data-pbulk>${U.icon('note', 'sm')}まとめて登録</button>
                </div>
              </div>`;
            }).join('')}</div>`;
          if (focus) {
            const card = U.$$('.spc', partsSec).find((c) => c.dataset.iid === focus.iid);
            const inp = card && U.$$('[data-pn]', card)[focus.j];
            if (inp) { inp.focus(); inp.select && inp.select(); }
          }
        };
        const cardOf = (t) => { const c = t.closest('.spc'); return c && { cid: c.dataset.cid, iid: c.dataset.iid, name: (U.$('.spc-head b', c) || {}).textContent || '' }; };
        const saveParts = (c, parts, label) => { S().setItemParts(c.cid, c.iid, parts, label); mark(); later(); };
        // 品名の入力：画面は作り直さずに保存だけ（作り直すと入力中の文字が飛ぶ）
        partsSec.oninput = (e) => {
          const t = e.target;
          if (!t.matches('[data-pn]')) return;
          const c = cardOf(t);
          const parts = rawParts(c.cid, c.iid);
          if (!parts[+t.dataset.pn]) return;
          parts[+t.dataset.pn].n = t.value;
          saveParts(c, parts, null);
        };
        // Enter で次の行へ（最後の行なら行を足す）
        partsSec.onkeydown = (e) => {
          const t = e.target;
          if (e.key !== 'Enter' || e.isComposing || !t.matches('[data-pn]')) return;
          e.preventDefault();
          e.stopPropagation();   // サークル詳細用の「Enter で次の欄へ」（document）に渡さない
          const c = cardOf(t);
          const j = +t.dataset.pn;
          const parts = rawParts(c.cid, c.iid);
          if (j === parts.length - 1) {
            if (!t.value.trim()) return;
            parts.push({ n: '', q: 1 });
            saveParts(c, parts, 'セットの中身を追加');
          }
          paintParts({ iid: c.iid, j: j + 1 });
        };
        partsSec.onclick = async (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          const c = cardOf(b);
          if (!c) return;
          const parts = rawParts(c.cid, c.iid);
          if (b.matches('[data-pq]')) {
            const p = parts[+b.dataset.pq];
            p.q = U.clamp((p.q || 1) + +b.dataset.d, 1, 99);
            saveParts(c, parts, 'セットの中身の数量');
            paintParts();
          } else if (b.matches('[data-pdel]')) {
            parts.splice(+b.dataset.pdel, 1);
            saveParts(c, parts, 'セットの中身を消す');
            paintParts();
            UI().toast('中身を1行消しました', { undo: true });
          } else if (b.matches('[data-padd]')) {
            parts.push({ n: '', q: 1 });
            saveParts(c, parts, 'セットの中身を追加');
            paintParts({ iid: c.iid, j: parts.length - 1 });
          } else if (b.matches('[data-pbulk]')) {
            const v = await UI().prompt(`${c.name}の中身をまとめて登録`, {
              value: partsText(parts.filter((p) => String(p.n).trim())), multiline: true, ok: '登録',
              placeholder: '例：\n本 ×1\nステッカー ×2\nポストカード ×3',
              note: '1行に1つずつ入力します。数量は「×2」「2枚」のように書けます（省略すると1）。登録すると、いまの中身と置き換わります。',
            });
            if (v == null) return;
            saveParts(c, Sh.parseParts(v), 'セットの中身をまとめて登録');
            paintParts();
          }
        };
        paintParts();
        U.$$('[data-ship]', el).forEach((inp) => inp.addEventListener('input', () => {
          const k = inp.dataset.k;
          S().setShip(rid, { [k]: k === 'fee' ? U.parseYen(inp.value) : inp.value });
          mark();
          later();
        }));
        U.$$('[data-sender]', el).forEach((inp) => inp.addEventListener('input', () => {
          const k = inp.dataset.k;
          S().setSender({ [k]: k === 'nextNo' ? U.parseYen(inp.value) : inp.value });
          mark();
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
          mark();
          U.$$('[data-method]', el).forEach((x) => x.classList.toggle('on', x === b));
          paintSum();
        }));
        U.$$('[data-fee]', el).forEach((b) => (b.onclick = () => {
          S().setShip(rid, { feeMode: b.dataset.fee });
          mark();
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
          U.$$('[data-kind]', el).forEach((x) => x.classList.toggle('on', x.dataset.kind === b.dataset.kind));
          paintPv();
        }));
        U.$('[data-preview]', el).onclick = () => Sh.preview([rid]);
        const p2 = U.$('[data-print2]', el);
        if (p2) p2.onclick = () => Sh.print([rid]);
        U.$('[data-print]', el).onclick = () => Sh.print([rid]);
        U.$('[data-shipped]', el).onclick = () => {
          const on = !(S().requester(rid).ship || {}).shippedAt;
          S().setShipped(rid, on);
          Sh.open(rid);
          UI().toast(on ? '発送済みにしました' : '発送済みを取り消しました', { undo: true });
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
  /** 同じサークルの品物をひとまとめにする（スペースとサークルのセルを結合するため。並びはスペース番号の順なので続いている） */
  const byCircle = (list) => list.reduce((gs, x) => {
    const g = gs[gs.length - 1];
    if (g && g.cid === x.cid) g.items.push(x); else gs.push({ cid: x.cid, space: x.space, circle: x.circle, items: [x] });
    return gs;
  }, []);
  /** 数量ぶんの検品の □（多いときは24個まで出して残りの数を添える） */
  const BOX_MAX = 24;
  const boxes = (n) => `<span class="pk-boxes">${'<i class="pk-box"></i>'.repeat(Math.min(n, BOX_MAX))}${n > BOX_MAX ? `<em>ほか${n - BOX_MAX}点</em>` : ''}</span>`;

  Sh.slipHTML = (rid) => {
    const d = Sh.data(rid);
    const ev = S().ev();
    const sh = d.ship, snd = d.snd;
    const no = noTxt(sh.no);
    const rows = byCircle(d.got).map((g) => `<tbody class="grp">${g.items.map((x, k) => `<tr>
        ${k === 0 ? `<td class="sp grp-c" rowspan="${g.items.length}">${esc(g.space)}</td><td class="ci grp-c" rowspan="${g.items.length}">${esc(g.circle)}</td>` : ''}
        <td class="nm">${esc(x.name)}${x.parts ? '<span class="tag-set">セット</span>' : ''}${isRandom(x.name) ? '<span class="tag-rand">ランダム</span>' : ''}${x.parts ? `<div class="parts">${x.qty > 1 ? '内容（1セットあたり）' : '内容'}：${x.parts.map((p) => `${esc(p.n)} ×${p.q}`).join('、')}</div>` : ''}</td>
        <td class="qt">×${x.qty}</td><td class="mo">${U.num(x.qty ? Math.round(x.cost / x.qty) : x.cost)}円</td><td class="mo">${U.num(x.cost)}円</td></tr>`).join('')}</tbody>`).join('');
    const feeRow = sh.feeMode === 'charge' ? `<tr><th>B 送料</th><td>${U.num(d.fee)}円</td></tr>`
      : sh.feeMode === 'cod' ? '<tr><th>B 送料</th><td>着払い</td></tr>' : '';
    return `<article class="slip">
      <div class="slip-sheet">
        <header class="sv-head">
          <div class="sv-title">
            <h1>発 送 伝 票</h1>
            <div class="sv-tag">${esc(snd.tagline || '')}</div>
            <div class="sv-lead">このたびはご依頼いただき、ありがとうございました。下記のとおりお届けいたします。</div>
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
            ${rows || '<tbody><tr><td colspan="6" class="empty">明細はありません</td></tr></tbody>'}
            <tfoot><tr><td colspan="5">商品代金 小計</td><td class="mo">${U.num(d.items)}円</td></tr></tfoot>
          </table>
          ${d.miss.length ? `<div class="sv-miss"><div class="lb">ご用意できなかった品物（代金はいただいておりません）</div>
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

  /** 梱包伝票。品物ごとに数量ぶんの検品の □・備考（セットは中身ごと）、検品・梱包チェック、追跡番号の記入欄 */
  Sh.packHTML = (rid) => {
    const d = Sh.data(rid, 'pack');
    const sh = d.ship, snd = d.snd;
    const no = noTxt(sh.no);
    const qty = U.sum(d.got, leafQty);
    const rand = d.got.some((x) => isRandom(x.name) || (x.parts || []).some((p) => isRandom(p.n)));
    const box = (t) => `<li><i class="pk-box"></i>${t}</li>`;
    const rtag = (nm) => (isRandom(nm) ? '<span class="tag-rand">ランダム</span>' : '');
    // サークルごとに tbody を分ける（同じサークルの品物とセットの中身がページの境目で離れないように）
    let no1 = 0;
    const rows = byCircle(d.got).map((g) => {
      const span = U.sum(g.items, (x) => 1 + (x.parts ? x.parts.length : 0));
      const head = `<td class="sp grp-c" rowspan="${span}">${esc(g.space)}</td><td class="ci grp-c" rowspan="${span}">${esc(g.circle)}</td>`;
      let first = true;
      const lead = () => (first ? ((first = false), head) : '');
      return `<tbody class="grp">${g.items.map((x) => {
        const n = ++no1;
        if (!x.parts) {
          return `<tr><td class="no">${n}</td>${lead()}
            <td class="nm">${esc(x.name)}${rtag(x.name)}</td>
            <td class="qt">×${x.qty}</td><td class="bx">${boxes(x.qty)}</td><td class="memo"></td></tr>`;
        }
        return `<tr class="set"><td class="no">${n}</td>${lead()}
            <td class="nm">${esc(x.name)}<span class="tag-set">セット</span>${rtag(x.name)}<small>中身 ${x.parts.length}種類を下で検品</small></td>
            <td class="qt">×${x.qty}</td><td class="bx"></td><td class="memo"></td></tr>
          ${x.parts.map((p, j) => `<tr class="part"><td class="no">${n}-${j + 1}</td>
            <td class="nm">${esc(p.n)}${rtag(p.n)}</td>
            <td class="qt">×${p.q * x.qty}</td><td class="bx">${boxes(p.q * x.qty)}</td><td class="memo"></td></tr>`).join('')}`;
      }).join('')}</tbody>`;
    }).join('');
    const to = sh.addr1 ? `〒${esc(Sh.postal(sh.postal))}　${esc(sh.addr1)}${sh.addr2 ? ' ' + esc(sh.addr2) : ''}` : '';
    return `<article class="slip pack">
      <div class="slip-sheet">
        <header class="sv-head">
          <div class="sv-title">
            <h1>梱 包 伝 票</h1>
            <div class="sv-tag">${esc(snd.tagline || '')}</div>
            <div class="sv-lead">下記の品物を検品のうえ、梱包いたしました。</div>
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
        <div class="sv-bar sq">梱包明細<span class="pk-count">${d.got.length}品目　計 ${qty}点</span></div>
        <div class="sv-order">
          <table class="sv-items pk-items">
            <thead><tr><th class="no">No.</th><th class="sp">スペース</th><th class="ci">サークル</th><th class="nm">商 品 名</th><th class="qt">数量</th><th class="bx">検品（1点ずつ）</th><th class="memo">備　考</th></tr></thead>
            ${rows || '<tbody><tr><td colspan="7" class="empty">明細はありません</td></tr></tbody>'}
            <tfoot><tr><td colspan="4">合計</td><td class="qt">${qty}点</td><td class="bx"><span class="pk-sumbox"><i class="pk-box"></i>全${qty}点そろった</span></td><td></td></tr></tfoot>
          </table>
          ${d.miss.length ? `<div class="sv-miss"><div class="lb">ご用意できなかった品物（同梱しておりません）</div>
            <ul>${d.miss.map((x) => `<li><b>${esc(x.space)}</b> ${esc(x.circle)}：${esc(x.name)} ×${x.qty}<span>${x.status === 'soldout' ? '売り切れ' : '見送り'}</span></li>`).join('')}</ul></div>` : ''}
        </div>
        <div class="pk-bottom">
          <div class="pk-check">
            <div class="lb">■ 検品・梱包チェック</div>
            <ul>
              ${box('品名・数量が明細と一致')}
              ${box('破損・汚れ・折れなし')}
              ${rand ? box('ランダム商品は未開封') : ''}
              ${box('OPP袋・緩衝材で保護（紙類は防水）')}
            </ul>
          </div>
          <div class="pk-fill">
            <div class="lb">■ 追跡番号</div>
            <div class="pk-trk">${esc(sh.tracking || '')}</div>
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
  /** A4（幅190mm）の伝票を、入れ物の幅に合わせて縮める（offsetHeight は縮める前の大きさ） */
  const scalePages = (root) => U.$$('.sp-page', root).forEach((pg) => {
    const slip = U.$('.slip', pg);
    if (!slip || !pg.clientWidth) return;
    const k = pg.clientWidth / slip.offsetWidth;
    slip.style.transform = `scale(${k})`;
    pg.style.height = `${Math.ceil(slip.offsetHeight * k)}px`;
  });

  /** 入力の足りないところがあれば、印刷の前に確かめる */
  const checkLacks = async (rids, kind) => {
    const k = kind === 'pack' ? 'pack' : 'ship';
    const lines = rids.map((rid) => {
      const d = Sh.data(rid, k);
      const why = [d.lacks.length ? `${d.lacks.join('・')}が未入力` : '', d.got.length ? '' : '買えた品物がありません'].filter(Boolean);
      return why.length ? `${d.r.name}：${why.join('／')}` : '';
    }).filter(Boolean);
    if (!lines.length) return true;
    return UI().confirm(`入力が済んでいない伝票があります。このまま印刷しますか？\n\n${lines.join('\n')}`, { ok: '印刷する', cancel: '入力に戻る', title: '印刷の前に' });
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
        ${rids.some((rid) => !(S().requester(rid).ship || {}).no) ? '<p class="muted small">「No. ----」の伝票には、印刷するときに番号が付きます。</p>' : ''}
        <div class="btn-row"><button class="btn ghost" data-close>閉じる</button><button class="btn primary" data-print>${U.icon('print')}印刷する</button></div>`,
      onMount: (el) => {
        U.$('[data-print]', el).onclick = () => Sh.print(rids, kind);
        U.$$('[data-kind]', el).forEach((b) => (b.onclick = () => { setKind(b.dataset.kind); Sh.preview(rids, b.dataset.kind); }));
        // A4（210mm）を画面の幅に合わせて縮める
        requestAnimationFrame(() => scalePages(el));
      },
    });
  };

  Sh.print = async (rids, kind = Sh.kind()) => {
    if (!(await checkLacks(rids, kind))) return;
    rids.forEach((rid) => Sh.ensureNo(rid));   // 番号は印刷するときに割り当てる
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
    return Sh.data(rid).lacks.length ? 'lack' : 'ready';   // 品物が無い人は上で none になる
  };
  Sh.STATE = { shipped: '発送済み', ready: '伝票の準備完了', lack: '伝票の入力待ち', none: '' };

  /** 買えた品物がある依頼者（まとめて印刷の対象） */
  Sh.printable = () => S().requesters().filter((r) => S().proxySummary(r.id).boughtCount > 0).map((r) => r.id);
})();
