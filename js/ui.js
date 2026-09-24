/* シート（ボトムシート／PCではサイドパネル）・トースト・テンキー・確認ダイアログ */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const UI = (HC.ui = {});

  const root = () => U.$('#sheets');
  const stack = []; // {id, el, onClose}

  /**
   * シートを開く。同じ id が開いていれば中身だけ差し替える。
   * opt: {id, title, html, side(PCで右パネル), modal, onClose, onMount(el), cls}
   */
  UI.sheet = (opt) => {
    const id = opt.id || 'sheet-' + U.uid();
    const existing = stack.find((s) => s.id === id);
    if (existing) {
      if (opt.title != null) U.$('.sheet-title', existing.el).innerHTML = opt.title;
      U.$('.sheet-body', existing.el).innerHTML = opt.html;
      existing.onClose = opt.onClose;
      opt.onMount && opt.onMount(existing.el);
      return existing.el;
    }
    const wrap = document.createElement('div');
    wrap.className = `sheet-wrap ${opt.side ? 'side' : ''} ${opt.center ? 'center' : ''} ${opt.cls || ''}`;
    wrap.dataset.sheet = id;
    wrap.innerHTML = `
      <div class="backdrop" data-close></div>
      <section class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-grip" data-close aria-hidden="true"></div>
        <header class="sheet-head">
          <div class="sheet-title">${opt.title || ''}</div>
          <button class="icon-btn" data-close aria-label="閉じる">${U.icon('x')}</button>
        </header>
        <div class="sheet-body">${opt.html}</div>
      </section>`;
    root().appendChild(wrap);
    const entry = { id, el: wrap, onClose: opt.onClose };
    stack.push(entry);
    requestAnimationFrame(() => wrap.classList.add('open'));
    ensureHistory();
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) {
        e.preventDefault();
        UI.close(id);
      }
    });
    // 下スワイプで閉じる（モバイル）
    const sheetEl = U.$('.sheet', wrap);
    let sy = null, dy = 0;
    const head = U.$('.sheet-head', wrap), grip = U.$('.sheet-grip', wrap);
    [head, grip].forEach((h) => {
      h.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; dy = 0; sheetEl.style.transition = 'none'; }, { passive: true });
      h.addEventListener('touchmove', (e) => {
        if (sy == null) return;
        dy = Math.max(0, e.touches[0].clientY - sy);
        sheetEl.style.transform = `translateY(${dy}px)`;
      }, { passive: true });
      h.addEventListener('touchend', () => {
        sheetEl.style.transition = '';
        sheetEl.style.transform = '';
        if (dy > 90) UI.close(id);
        sy = null;
      });
    });
    opt.onMount && opt.onMount(wrap);
    return wrap;
  };

  // Android の「戻る」でシートを閉じるため、シート表示中は履歴を1段だけ積む
  let hasEntry = false, ignorePop = false, deferPush = false, popTimer = null;
  const ensureHistory = () => {
    if (hasEntry) return;
    if (ignorePop) { deferPush = true; return; } // history.back() の完了待ち
    try { history.pushState({ sheet: 1 }, ''); hasEntry = true; } catch (_) { /* noop */ }
  };

  const removeSheet = (entry) => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    entry.el.classList.remove('open');
    setTimeout(() => entry.el.remove(), 220);
    entry.onClose && entry.onClose();
  };

  UI.close = (id) => {
    const entry = id ? stack.find((s) => s.id === id) : stack[stack.length - 1];
    if (!entry) return;
    removeSheet(entry);
    if (!stack.length && hasEntry) {
      hasEntry = false;
      ignorePop = true;
      history.back();
      // popstate が来ない環境でも固まらないように
      clearTimeout(popTimer);
      popTimer = setTimeout(() => {
        if (!ignorePop) return;
        ignorePop = false;
        if (deferPush) { deferPush = false; if (stack.length) ensureHistory(); }
      }, 700);
    }
  };
  UI.closeAll = () => [...stack].reverse().forEach((s) => UI.close(s.id));
  UI.isOpen = (id) => stack.some((s) => s.id === id);
  UI.top = () => stack[stack.length - 1];

  window.addEventListener('popstate', () => {
    if (ignorePop) {
      ignorePop = false;
      clearTimeout(popTimer);
      if (deferPush) { deferPush = false; if (stack.length) ensureHistory(); }
      return;
    }
    hasEntry = false;
    const top = stack[stack.length - 1];
    if (top) removeSheet(top);
    if (stack.length) ensureHistory();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); UI.close(); }
  });

  // ------------------------------------------------------------------ トースト
  let toastTimer = null;
  UI.toast = (msg, opt = {}) => {
    const el = U.$('#toast');
    const undo = opt.undo && HC.store.canUndo();
    el.className = `toast show ${opt.error ? 'error' : ''}`;
    el.innerHTML = `<span class="toast-msg">${U.esc(msg)}</span>${undo ? `<button class="toast-btn" data-toast-undo>${U.icon('undo')}元に戻す</button>` : ''}${
      opt.action ? `<button class="toast-btn" data-toast-act>${U.esc(opt.action.label)}</button>` : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), opt.ms || (undo || opt.action ? 5000 : 2400));
    el.onclick = (e) => {
      if (e.target.closest('[data-toast-undo]')) {
        const l = HC.store.undo();
        el.classList.remove('show');
        if (l) setTimeout(() => UI.toast(`「${l}」を取り消しました`), 50);
      } else if (e.target.closest('[data-toast-act]')) {
        el.classList.remove('show');
        opt.action.fn();
      }
    };
  };
  U.on('toast', (m, o) => UI.toast(m, o));

  // ------------------------------------------------------------------ 確認
  UI.confirm = (msg, opt = {}) =>
    new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      const id = 'confirm-' + U.uid();
      UI.sheet({
        id,
        center: true,
        title: opt.title || '確認',
        html: `<p class="confirm-msg">${opt.html ? msg : U.esc(msg).replace(/\n/g, '<br>')}</p>
          <div class="btn-row">
            <button class="btn ghost" data-close>${U.esc(opt.cancel || 'キャンセル')}</button>
            <button class="btn ${opt.danger ? 'danger' : 'primary'}" data-ok>${U.esc(opt.ok || 'OK')}</button>
          </div>`,
        onClose: () => finish(false),
        onMount: (el) => {
          U.$('[data-ok]', el).onclick = () => { finish(true); UI.close(id); };
        },
      });
    });

  // ------------------------------------------------------------------ メニュー
  UI.menu = (title, items) => {
    const id = 'menu-' + U.uid();
    UI.sheet({
      id,
      title: U.esc(title),
      cls: 'menu-sheet',
      html: `<div class="menu">${items
        .filter(Boolean)
        .map((it, i) => `<button class="menu-item ${it.danger ? 'danger' : ''} ${it.active ? 'active' : ''}" data-i="${i}">${it.icon ? U.icon(it.icon) : ''}<span>${U.esc(it.label)}</span>${it.hint ? `<small>${U.esc(it.hint)}</small>` : ''}</button>`)
        .join('')}</div>`,
      onMount: (el) => {
        const list = items.filter(Boolean);
        U.$$('.menu-item', el).forEach((b) => (b.onclick = () => {
          const it = list[+b.dataset.i];
          UI.close(id);
          setTimeout(() => it.act(), 30);
        }));
      },
    });
  };

  // ------------------------------------------------------------------ テンキー
  /**
   * 金額入力。opt: {title, name, showName, amount(単価), qty, pay, okLabel, onOk({name, amount(合計), unit, qty, pay})}
   */
  UI.numpad = (opt) => {
    const S = HC.store;
    const st = {
      name: opt.name || '',
      unit: String(opt.amount || ''),
      qty: opt.qty || 1,
      pay: opt.pay || S.state.settings.defaultPay,
      deduct: true,   // 支払いヒントの「財布の中身から引く」
      fresh: true, // 最初のキー入力で既存値を置き換える
    };
    const id = 'numpad';
    const draw = (el) => {
      const unit = parseInt(st.unit || '0', 10);
      U.$('.np-amount', el).textContent = U.yen(unit);
      U.$('.np-total', el).textContent = st.qty > 1 ? `× ${st.qty} ＝ ${U.yen(unit * st.qty)}` : '';
      U.$('.np-qty-v', el).textContent = st.qty;
      U.$$('[data-pay]', el).forEach((b) => b.classList.toggle('on', b.dataset.pay === st.pay));
      U.$('[data-ok]', el).disabled = !(unit > 0 || opt.allowZero);
      const hint = U.$('.np-hint', el);
      if (hint) {
        const html = (st.pay === 'cash' && opt.hint) ? opt.hint(unit * st.qty) : '';
        hint.innerHTML = html || '';
        hint.hidden = !html;
        const cb = U.$('[data-deduct]', hint);
        if (cb) cb.checked = st.deduct;   // 描き直しても選び直さなくていいように
      }
    };
    UI.sheet({
      id,
      title: U.esc(opt.title || '金額入力'),
      cls: 'numpad-sheet',
      html: `
        ${opt.showName !== false ? `
        <input class="input np-name" type="text" placeholder="品名（任意）" value="${U.esc(st.name)}" enterkeyhint="done">
        <div class="chips np-chips">${S.ITEM_PRESETS.map((p) => `<button class="chip sm" data-nm="${U.esc(p)}">${U.esc(p)}</button>`).join('')}</div>` : ''}
        <div class="np-display"><span class="np-amount">¥0</span><span class="np-total"></span></div>
        <div class="np-hint" hidden></div>
        <div class="np-presets">${S.PRICE_PRESETS.map((p) => `<button class="chip" data-preset="${p}">${U.num(p)}</button>`).join('')}</div>
        <div class="np-keys">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'bs'].map((k) => `<button class="np-key" data-k="${k}">${k === 'bs' ? U.icon('backspace') : k}</button>`).join('')}
        </div>
        <div class="np-opts">
          <div class="stepper"><button class="icon-btn" data-q="-1" aria-label="数量を減らす">${U.icon('minus')}</button><span>数量 <b class="np-qty-v">1</b></span><button class="icon-btn" data-q="1" aria-label="数量を増やす">${U.icon('plus')}</button></div>
          ${opt.showPay === false ? '' : '<div class="seg sm"><button data-pay="cash">現金</button><button data-pay="card">キャッシュレス</button></div>'}
        </div>
        <button class="btn primary block lg" data-ok>${U.esc(opt.okLabel || '記録する')}</button>`,
      onMount: (el) => {
        draw(el);
        const nameInp = U.$('.np-name', el);
        el.addEventListener('change', (e) => { if (e.target.matches('[data-deduct]')) st.deduct = e.target.checked; });
        el.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.k) {
            U.vibrate(6);
            if (b.dataset.k === 'bs') { st.unit = st.fresh ? '' : st.unit.slice(0, -1); }
            else {
              if (st.fresh) st.unit = '';
              if (st.unit.length < 7) st.unit = (st.unit + b.dataset.k).replace(/^0+/, '');
            }
            st.fresh = false;
          } else if (b.dataset.preset) {
            st.unit = b.dataset.preset;
            st.fresh = true;
          } else if (b.dataset.q) {
            st.qty = U.clamp(st.qty + +b.dataset.q, 1, 99);
          } else if (b.dataset.pay) {
            st.pay = b.dataset.pay;
          } else if (b.dataset.nm && nameInp) {
            nameInp.value = b.dataset.nm;
          } else if (b.hasAttribute('data-ok')) {
            const unit = parseInt(st.unit || '0', 10);
            const deduct = U.$('.np-hint [data-deduct]', el);   // 閉じる前に読む
            UI.close(id);
            opt.onOk({
              name: nameInp ? nameInp.value.trim() : st.name,
              unit, amount: unit * st.qty, qty: st.qty, pay: st.pay,
              deduct: !!(deduct && deduct.checked),
            });
            return;
          } else return;
          draw(el);
        });
        // PC: キーボードでも入力可
        el.addEventListener('keydown', (e) => {
          if (e.target === nameInp) { if (e.key === 'Enter') nameInp.blur(); return; }
          if (/^\d$/.test(e.key)) U.$(`[data-k="${e.key}"]`, el).click();
          else if (e.key === 'Backspace') U.$('[data-k="bs"]', el).click();
          else if (e.key === 'Enter') U.$('[data-ok]', el).click();
        });
        U.$('.sheet', el).tabIndex = -1;
        setTimeout(() => U.$('.sheet', el).focus({ preventScroll: true }), 50);
      },
    });
  };

  // ------------------------------------------------------------------ 入力ダイアログ
  UI.prompt = (title, { value = '', placeholder = '', type = 'text', ok = 'OK', multiline = false } = {}) =>
    new Promise((resolve) => {
      let done = false;
      const id = 'prompt-' + U.uid();
      UI.sheet({
        id,
        center: true,
        title: U.esc(title),
        html: `${multiline
          ? `<textarea class="input" rows="6" placeholder="${U.esc(placeholder)}">${U.esc(value)}</textarea>`
          : `<input class="input" type="${type}" ${type === 'number' ? 'inputmode="numeric"' : ''} placeholder="${U.esc(placeholder)}" value="${U.esc(value)}">`}
          <div class="btn-row"><button class="btn ghost" data-close>キャンセル</button><button class="btn primary" data-ok>${U.esc(ok)}</button></div>`,
        onClose: () => { if (!done) { done = true; resolve(null); } },
        onMount: (el) => {
          const inp = U.$('.input', el);
          setTimeout(() => inp.focus(), 60);
          const submit = () => { done = true; resolve(inp.value); UI.close(id); };
          U.$('[data-ok]', el).onclick = submit;
          if (!multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        },
      });
    });
})();
