/* 配置図エディタ：公式配置図の画像の上に、島・1列・壁・入口・通路を置いて自分用の地図を作る
   - 生成物は data/*.js の layout と同じ形（CLAUDE.md の「配置図レイアウト仕様」）
   - 島などは編集しやすいように ey0（先頭のY）/ estep（行間隔）/ en（片側の数）を持たせ、
     保存時にそこから rows / ys / cells を組み立てる */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const P = HC.parser;
  const Lay = HC.layout;
  const S = () => HC.store;
  const UI = () => HC.ui;
  const E = (HC.editor = {});
  const NS = 'http://www.w3.org/2000/svg';

  const FACES = ['E', 'W', 'N', 'S'];

  let st = null; // { evId, spec, sel, mode, vb, dirty }

  // ---- spec の組み立て --------------------------------------------------
  const rowsOf = (b) => Array.from({ length: b.en || 20 }, (_, i) => Math.round((b.ey0 + (b.estep || 13) * i) * 10) / 10);

  /** 編集用パラメータから rows/ys/cells を作り直す */
  const bake = (b) => {
    if (b.type === 'island') {
      b.rows = rowsOf(b);
      b.perSide = b.en;
      b.right = b.right || `1-${b.en}`;
      b.left = b.left || `${b.en + 1}-${b.en * 2}`;
    } else if (b.type === 'column') {
      b.ys = rowsOf(b);
      b.nums = b.nums || `1-${b.en}`;
    } else if (b.type === 'wall') {
      const nums = [...P.rangeSet(b.nums || `1-${b.en}`)];
      b.cells = nums.map((n, i) => [Math.round((b.ex0 + (b.estep || 14) * i) * 10) / 10, n]);
      b.w = b.w || 12.5;
      b.h = b.h || 24;
    }
    return b;
  };

  const specOut = () => {
    const sp = JSON.parse(JSON.stringify(st.spec));
    sp.blocks.forEach(bake);
    return sp;
  };

  const buildLayout = () => {
    st.buildError = '';
    try { return Lay.build(specOut()); } catch (e) { st.buildError = e.message; return null; }
  };

  /** 一覧のサークルのうち、配置図に席が無いもの */
  const missing = (L) => {
    const out = [];
    if (!L) return out;
    S().ev().circles.forEach((c) => {
      const cells = Lay.cellsOf(L, c);
      if (cells.length !== c.nums.length) out.push(c);
    });
    return out;
  };

  const nextBlockLetter = () => {
    const used = new Set(st.spec.blocks.map((b) => b.block));
    const inEvent = S().ev().blocks.filter((b) => !used.has(b));
    if (inEvent.length) return inEvent[0];
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(ch)) return ch;
    return 'A';
  };

  /** そのブロックのサークル番号の最大値から、片側の数を見積もる */
  const guessSide = (letter) => {
    const nums = [];
    S().ev().circles.forEach((c) => { if (c.block === letter) nums.push(...c.nums); });
    const max = nums.length ? Math.max(...nums) : 40;
    return Math.max(4, Math.ceil(max / 2));
  };

  // ---- 画面 -------------------------------------------------------------
  const el = () => document.getElementById('editor');

  E.open = async () => {
    const s = S();
    const evId = s.state.eventId;
    const base = s.state.layouts[evId] || s.ev().spec || Lay.autoSpec(s.ev().circles);
    st = {
      evId,
      spec: normalize(JSON.parse(JSON.stringify(base))),
      sel: null,
      mode: '',      // '' | 'add-island' | 'add-column' | 'add-wall' | 'add-start' | 'add-cross'
      dirty: false,
    };
    const wrap = document.createElement('div');
    wrap.id = 'editor';
    wrap.className = 'editor';
    wrap.innerHTML = shell();
    document.body.appendChild(wrap);
    document.body.classList.add('editing');
    bindCanvas();
    render();
    history.pushState({ editor: 1 }, '');
    window.addEventListener('popstate', onPop);
  };

  const onPop = () => E.close(true);

  E.close = async (fromPop) => {
    if (st && st.dirty) {
      const ok = await UI().confirm('保存していない変更があります。閉じますか？', { ok: '閉じる', cancel: '編集に戻る', danger: true });
      if (!ok) {
        if (fromPop) history.pushState({ editor: 1 }, '');
        return;
      }
    }
    window.removeEventListener('popstate', onPop);
    el() && el().remove();
    document.body.classList.remove('editing');
    st = null;
    if (!fromPop && history.state && history.state.editor) history.back();
  };

  /** 旧い spec（rows 配列そのまま）にも編集用パラメータを足す */
  const normalize = (sp) => {
    sp.blocks = (sp.blocks || []).map((b) => {
      const o = { ...b };
      if (o.type === 'island' || o.type === 'column') {
        const rows = o.rows || o.ys || sp.rows || [];
        if (o.ey0 == null) o.ey0 = rows[0] ?? 100;
        if (o.estep == null) o.estep = rows.length > 1 ? Math.round(((rows[rows.length - 1] - rows[0]) / (rows.length - 1)) * 10) / 10 : 13;
        if (o.en == null) o.en = o.perSide || rows.length || 20;
      } else if (o.type === 'wall') {
        const cells = o.cells || [];
        if (o.ex0 == null) o.ex0 = cells.length ? cells[0][0] : 100;
        if (o.estep == null) o.estep = cells.length > 1 ? Math.round(((cells[cells.length - 1][0] - cells[0][0]) / (cells.length - 1)) * 10) / 10 : 14;
        if (o.nums == null) o.nums = cells.length ? `${cells[0][1]}-${cells[cells.length - 1][1]}` : '1-10';
        if (o.en == null) o.en = cells.length || 10;
      }
      return o;
    });
    sp.starts = sp.starts || [];
    sp.crossY = sp.crossY || [];
    sp.cell = sp.cell || { w: 22, h: 13 };
    sp.labels = sp.labels || [];
    return sp;
  };

  const shell = () => `
    <header class="ed-top">
      <button class="icon-btn" data-ed="close" aria-label="閉じる">${U.icon('x')}</button>
      <b>配置図エディタ</b>
      <span class="ed-miss" id="ed-miss"></span>
      <span class="grow"></span>
      <button class="btn sm" data-ed="help">${U.icon('note')}使い方</button>
      <button class="btn sm primary" data-ed="save">${U.icon('save')}保存</button>
    </header>
    <div class="ed-body">
      <div class="ed-canvas" id="ed-canvas"><svg class="ed-svg" id="ed-svg" preserveAspectRatio="xMidYMid meet"></svg></div>
      <aside class="ed-side" id="ed-side"></aside>
    </div>
    <div class="ed-tools" id="ed-tools"></div>`;

  const tools = () => {
    const m = st.mode;
    const t = (mode, icon, label) => `<button class="ed-tool ${m === mode ? 'on' : ''}" data-ed="mode" data-m="${mode}">${U.icon(icon)}<span>${label}</span></button>`;
    return `${t('add-island', 'grid', '島')}${t('add-column', 'list', '1列')}${t('add-wall', 'move', '壁')}
      ${t('add-start', 'door', '入口')}${t('add-cross', 'route', '通路')}
      <span class="grow"></span>
      <button class="ed-tool" data-ed="img">${U.icon('image')}<span>配置図の画像</span></button>
      <button class="ed-tool" data-ed="auto">${U.icon('compass')}<span>一覧から自動</span></button>
      <button class="ed-tool" data-ed="json">${U.icon('download')}<span>JSON</span></button>`;
  };

  const render = () => {
    if (!st) return;
    const L = buildLayout();
    st.L = L;
    drawCanvas(L);
    document.getElementById('ed-tools').innerHTML = tools();
    document.getElementById('ed-side').innerHTML = sidePanel(L);
    const miss = missing(L);
    const mEl = document.getElementById('ed-miss');
    mEl.className = 'ed-miss ' + (!L || miss.length ? 'bad' : 'ok');
    mEl.innerHTML = !L
      ? `${U.icon('warn', 'sm')}配置図を組み立てられません（${U.esc(st.buildError || '値を確認してください')}）`
      : miss.length
        ? `${U.icon('warn', 'sm')}席が無いサークル ${miss.length}件`
        : `${U.icon('check', 'sm')}全${S().ev().circles.length}サークルに席があります`;
  };

  const viewBox = (L) => {
    const sp = st.spec;
    if (sp.image) return [0, 0, sp.image.w, sp.image.h];
    if (L && L.cells.length) {
      const xs = L.cells.map((c) => c.x), ys = L.cells.map((c) => c.y);
      return [Math.min(...xs) - 80, Math.min(...ys) - 80, Math.max(...xs) - Math.min(...xs) + 160, Math.max(...ys) - Math.min(...ys) + 160];
    }
    return [0, 0, 1000, 600];
  };

  const drawCanvas = (L) => {
    const svg = document.getElementById('ed-svg');
    const sp = st.spec;
    if (!st.vb) {
      const [x, y, w, h] = viewBox(L);
      st.vb = { x, y, w, h };
    }
    svg.setAttribute('viewBox', `${st.vb.x} ${st.vb.y} ${st.vb.w} ${st.vb.h}`);
    const parts = [];
    const imgSrc = sp.image ? (sp.image.src === 'idb' ? HC.shots.mapUrl(st.evId) : sp.image.src) : '';
    if (imgSrc) parts.push(`<image href="${U.esc(imgSrc)}" x="0" y="0" width="${sp.image.w}" height="${sp.image.h}" opacity="0.85"/>`);
    // 通路（横に通り抜けられるライン）
    sp.crossY.forEach((y, i) => {
      const [vx, , vw] = viewBox(L);
      parts.push(`<g class="ed-cross" data-cross="${i}"><line x1="${vx}" y1="${y}" x2="${vx + vw}" y2="${y}"/></g>`);
    });
    // セル（ブロックごと）
    if (L) {
      const byBlock = new Map();
      L.cells.forEach((c) => {
        if (!byBlock.has(c.block)) byBlock.set(c.block, []);
        byBlock.get(c.block).push(c);
      });
      sp.blocks.forEach((b, i) => {
        const cells = byBlock.get(b.block) || [];
        const on = st.sel === i;
        parts.push(`<g class="ed-block${on ? ' on' : ''}" data-bi="${i}">`);
        cells.forEach((c) => parts.push(`<rect x="${c.x - c.w / 2}" y="${c.y - c.h / 2}" width="${c.w}" height="${c.h}" rx="1.5"/>`));
        if (cells.length) {
          const cx = cells.reduce((s2, c) => s2 + c.x, 0) / cells.length;
          const cy = cells.reduce((s2, c) => s2 + c.y, 0) / cells.length;
          parts.push(`<text x="${cx}" y="${cy}" class="ed-blabel">${U.esc(b.block)}</text>`);
        }
        parts.push('</g>');
      });
    }
    // 入口
    sp.starts.forEach((s2, i) => {
      parts.push(`<g class="ed-start${st.sel === 'start:' + i ? ' on' : ''}" data-si="${i}">
        <circle cx="${s2.x}" cy="${s2.y}" r="9"/><text x="${s2.x}" y="${s2.y + 15}">${U.esc(s2.label || '入口')}</text></g>`);
    });
    svg.innerHTML = parts.join('');
  };

  const num = (label, key, val, step = 1) =>
    `<label class="ed-f"><span>${label}</span><input class="input" type="number" step="${step}" data-p="${key}" value="${val ?? ''}"></label>`;
  const txt = (label, key, val) =>
    `<label class="ed-f"><span>${label}</span><input class="input" data-p="${key}" value="${U.esc(val ?? '')}"></label>`;

  const sidePanel = (L) => {
    const sp = st.spec;
    if (typeof st.sel === 'string' && st.sel.startsWith('start:')) {
      const i = +st.sel.split(':')[1];
      const s2 = sp.starts[i];
      if (!s2) return emptyPanel();
      return `<h3>${U.icon('door')}入口</h3>
        ${txt('名前', 'label', s2.label)}${num('X', 'x', Math.round(s2.x))}${num('Y', 'y', Math.round(s2.y))}
        <p class="muted small">当日のスタート地点として「設定」で選べます。地図をドラッグしても動かせます。</p>
        <button class="btn danger ghost block" data-ed="del">${U.icon('trash')}この入口を削除</button>`;
    }
    const b = sp.blocks[st.sel];
    if (!b) return emptyPanel(L);
    const common = `${txt('ブロック記号', 'block', b.block)}`;
    if (b.type === 'island') {
      return `<h3>${U.icon('grid')}島（両面）</h3>${common}
        ${num('中心X', 'x', Math.round(b.x))}${num('先頭のY', 'ey0', Math.round(b.ey0))}
        ${num('行の間隔', 'estep', b.estep, 0.1)}${num('片側の数', 'en', b.en)}
        ${txt('右側の番号', 'right', b.right)}${txt('左側の番号', 'left', b.left)}
        <p class="muted small">コミケ式に、右列は上から下、左列は下から上に並びます。欠番があるときは「1-9,11-20」のように書きます。</p>
        <button class="btn danger ghost block" data-ed="del">${U.icon('trash')}この島を削除</button>`;
    }
    if (b.type === 'column') {
      return `<h3>${U.icon('list')}1列だけの机</h3>${common}
        ${num('X', 'x', Math.round(b.x))}${num('先頭のY', 'ey0', Math.round(b.ey0))}
        ${num('行の間隔', 'estep', b.estep, 0.1)}${num('数', 'en', b.en)}
        ${txt('番号', 'nums', b.nums)}
        <label class="ed-f"><span>通路の向き</span>
          <select class="input" data-p="face"><option value="W"${b.face === 'W' ? ' selected' : ''}>左（西）</option><option value="E"${b.face === 'E' ? ' selected' : ''}>右（東）</option></select></label>
        <button class="btn danger ghost block" data-ed="del">${U.icon('trash')}この列を削除</button>`;
    }
    if (b.type === 'cells') {
      const n = FACES.reduce((t, f) => t + ((b[f] || []).length), 0);
      return `<h3>${U.icon('grid')}実測の並び <small>${n}席</small></h3>${common}
        <p class="muted small">公式の配置図から1席ずつ取り込んだ並びです。位置はドラッグでまとめて動かせます（1席ずつの微調整はできません）。</p>
        <button class="btn danger ghost block" data-ed="del">${U.icon('trash')}このブロックを削除</button>`;
    }
    if (b.type === 'wall') {
      return `<h3>${U.icon('move')}壁サークル</h3>${common}
        ${num('先頭のX', 'ex0', Math.round(b.ex0))}${num('Y', 'y', Math.round(b.y))}
        ${num('間隔', 'estep', b.estep, 0.1)}${num('数', 'en', b.en)}
        ${txt('番号', 'nums', b.nums)}
        <label class="ed-f"><span>通路の向き</span>
          <select class="input" data-p="face"><option value="N"${b.face === 'N' ? ' selected' : ''}>上（北）</option><option value="S"${b.face === 'S' ? ' selected' : ''}>下（南）</option></select></label>
        <button class="btn danger ghost block" data-ed="del">${U.icon('trash')}この壁を削除</button>`;
    }
    return emptyPanel(L);
  };

  const emptyPanel = (L) => {
    const miss = missing(L).slice(0, 12);
    const sp = st.spec;
    return `<h3>${U.icon('grid')}配置図</h3>
      <p class="muted small">下のボタンで「島」などを選んでから、地図をクリックすると置けます。置いたものをクリックすると、ここで数値を直せます。</p>
      <div class="ed-f2">${num('机の横幅', 'cellw', sp.cell.w, 0.5)}${num('机の高さ', 'cellh', sp.cell.h, 0.5)}</div>
      ${sp.crossY.length ? `<p class="small">通り抜けできる通路：${sp.crossY.length}本 <button class="link-btn" data-ed="clearcross">全部消す</button></p>` : ''}
      ${miss.length ? `<div class="ed-missing"><b>まだ席が無いサークル</b><ul>${miss.map((c) => `<li>${U.esc(c.space)} ${U.esc(c.name)}</li>`).join('')}</ul>
        ${missing(L).length > 12 ? `<p class="muted small">ほか ${missing(L).length - 12}件</p>` : ''}</div>` : ''}
      ${S().hasCustomLayout(st.evId) ? `<button class="btn ghost block" data-ed="reset">${U.icon('undo')}元の配置図に戻す</button>` : ''}`;
  };

  // ---- 操作 -------------------------------------------------------------
  const svgPoint = (ev) => {
    const svg = document.getElementById('ed-svg');
    const r = svg.getBoundingClientRect();
    const vb = st.vb;
    const scale = Math.min(r.width / vb.w, r.height / vb.h);
    const ox = r.left + (r.width - vb.w * scale) / 2;
    const oy = r.top + (r.height - vb.h * scale) / 2;
    return { x: vb.x + (ev.clientX - ox) / scale, y: vb.y + (ev.clientY - oy) / scale };
  };

  const bindCanvas = () => {
    const wrap = el();
    const svg = document.getElementById('ed-svg');
    let drag = null;

    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ed]');
      if (b) return onTool(b.dataset);
    });

    wrap.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-p]');
      if (!inp) return;
      onProp(inp.dataset.p, inp.value);
    });

    svg.addEventListener('pointerdown', (e) => {
      const p = svgPoint(e);
      if (st.mode) { place(p); return; }
      const gb = e.target.closest('.ed-block');
      const gs = e.target.closest('.ed-start');
      if (gs) {
        st.sel = 'start:' + gs.dataset.si;
        drag = { kind: 'start', i: +gs.dataset.si, p, orig: { ...st.spec.starts[+gs.dataset.si] } };
      } else if (gb) {
        st.sel = +gb.dataset.bi;
        const b = st.spec.blocks[st.sel];
        drag = { kind: 'block', i: st.sel, p, orig: { x: b.x, y: b.y, ey0: b.ey0, ex0: b.ex0 } };
        if (b.type === 'cells') {
          drag.orig.faces = JSON.parse(JSON.stringify(FACES.map((f) => b[f] || [])));
          drag.orig.letterAt = JSON.parse(JSON.stringify(b.letterAt || []));
        }
      } else {
        st.sel = null;
        drag = { kind: 'pan', p: { x: e.clientX, y: e.clientY }, vb: { ...st.vb } };
      }
      svg.setPointerCapture(e.pointerId);
      render();
    });

    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'pan') {
        const r = svg.getBoundingClientRect();
        const scale = Math.min(r.width / drag.vb.w, r.height / drag.vb.h);
        st.vb = { ...st.vb, x: drag.vb.x - (e.clientX - drag.p.x) / scale, y: drag.vb.y - (e.clientY - drag.p.y) / scale };
        drawCanvas(st.L);
        return;
      }
      const p = svgPoint(e);
      const dx = p.x - drag.p.x, dy = p.y - drag.p.y;
      if (drag.kind === 'start') {
        const s2 = st.spec.starts[drag.i];
        s2.x = Math.round(drag.orig.x + dx);
        s2.y = Math.round(drag.orig.y + dy);
      } else if (st.spec.blocks[drag.i] && st.spec.blocks[drag.i].type === 'cells') {
        const b = st.spec.blocks[drag.i];
        FACES.forEach((f, fi) => {
          const src = drag.orig.faces[fi];
          if (!src.length) return;
          b[f] = src.map(([n, x, y]) => [n, Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]);
        });
        if (drag.orig.letterAt.length) b.letterAt = drag.orig.letterAt.map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]);
      } else {
        const b = st.spec.blocks[drag.i];
        if (b.type === 'wall') {
          b.ex0 = Math.round((drag.orig.ex0 + dx) * 10) / 10;
          b.y = Math.round((drag.orig.y + dy) * 10) / 10;
        } else {
          b.x = Math.round((drag.orig.x + dx) * 10) / 10;
          b.ey0 = Math.round((drag.orig.ey0 + dy) * 10) / 10;
        }
      }
      st.dirty = true;
      st.L = buildLayout();
      drawCanvas(st.L);
    });

    const endDrag = () => {
      if (drag && drag.kind !== 'pan') render();
      drag = null;
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = svgPoint(e);
      const k = Math.exp(e.deltaY * 0.0015);
      const w = U.clamp(st.vb.w * k, 60, 8000);
      const h = w * (st.vb.h / st.vb.w);
      st.vb = { x: p.x - (p.x - st.vb.x) * (w / st.vb.w), y: p.y - (p.y - st.vb.y) * (h / st.vb.h), w, h };
      drawCanvas(st.L);
    }, { passive: false });
  };

  /** ツールで選んだものを、クリックした場所に置く */
  const place = (p) => {
    const sp = st.spec;
    const mode = st.mode;
    if (mode === 'add-island' || mode === 'add-column') {
      const letter = nextBlockLetter();
      const en = guessSide(letter);
      const b = mode === 'add-island'
        ? { type: 'island', block: letter, x: Math.round(p.x), ey0: Math.round(p.y), estep: sp.cell.h + 0.2, en, right: `1-${en}`, left: `${en + 1}-${en * 2}` }
        : { type: 'column', block: letter, x: Math.round(p.x), ey0: Math.round(p.y), estep: sp.cell.h + 0.2, en, nums: `1-${en}`, face: 'W' };
      sp.blocks.push(bake(b));
      st.sel = sp.blocks.length - 1;
    } else if (mode === 'add-wall') {
      const letter = nextBlockLetter();
      const b = { type: 'wall', block: letter, y: Math.round(p.y), ex0: Math.round(p.x), estep: 14, en: 10, nums: '1-10', face: 'N', w: 12.5, h: 24 };
      sp.blocks.push(bake(b));
      st.sel = sp.blocks.length - 1;
    } else if (mode === 'add-start') {
      sp.starts.push({ id: 'door-' + U.uid().slice(-4), label: '入口' + (sp.starts.length + 1), x: Math.round(p.x), y: Math.round(p.y) });
      st.sel = 'start:' + (sp.starts.length - 1);
    } else if (mode === 'add-cross') {
      sp.crossY.push(Math.round(p.y));
      sp.crossY.sort((a, b) => a - b);
    }
    st.mode = '';
    st.dirty = true;
    render();
  };

  const onProp = (key, value) => {
    const sp = st.spec;
    if (key === 'cellw' || key === 'cellh') {
      sp.cell = { ...sp.cell, [key === 'cellw' ? 'w' : 'h']: Number(value) || 1 };
    } else if (typeof st.sel === 'string' && st.sel.startsWith('start:')) {
      const s2 = sp.starts[+st.sel.split(':')[1]];
      if (!s2) return;
      s2[key] = key === 'label' ? value : Number(value) || 0;
    } else {
      const b = sp.blocks[st.sel];
      if (!b) return;
      b[key] = ['block', 'right', 'left', 'nums', 'face'].includes(key) ? String(value).trim() : Number(value) || 0;
      if (key === 'en') { delete b.right; delete b.left; b.nums = `1-${b.en}`; }
      bake(b);
    }
    st.dirty = true;
    render();
  };

  const onTool = async (ds) => {
    const sp = st.spec;
    switch (ds.ed) {
      case 'close': return E.close();
      case 'mode':
        st.mode = st.mode === ds.m ? '' : ds.m;
        render();
        break;
      case 'del':
        if (typeof st.sel === 'string' && st.sel.startsWith('start:')) sp.starts.splice(+st.sel.split(':')[1], 1);
        else if (sp.blocks[st.sel]) sp.blocks.splice(st.sel, 1);
        st.sel = null;
        st.dirty = true;
        render();
        break;
      case 'clearcross':
        sp.crossY = [];
        st.dirty = true;
        render();
        break;
      case 'img': return pickImage();
      case 'auto': {
        if (!(await UI().confirm('いまの配置をすべて捨てて、サークル一覧から機械的に作り直します。よろしいですか？', { ok: '作り直す', danger: true }))) return;
        const auto = normalize(Lay.autoSpec(S().ev().circles));
        auto.image = sp.image;
        st.spec = auto;
        st.sel = null;
        st.vb = null;
        st.dirty = true;
        render();
        break;
      }
      case 'json': {
        const text = JSON.stringify(specOut(), null, 1);
        const ok = await U.copy(text);
        UI().toast(ok ? 'JSONをコピーしました（data/*.js に貼れます）' : 'コピーできませんでした');
        break;
      }
      case 'reset':
        if (!(await UI().confirm('自分で編集した配置図を捨てて、元の配置図に戻します。よろしいですか？', { ok: '戻す', danger: true }))) return;
        S().setLayout(st.evId, null);
        st.dirty = false;
        E.close();
        HC.app.refresh();
        UI().toast('元の配置図に戻しました');
        break;
      case 'save': {
        const sp2 = specOut();
        S().setLayout(st.evId, sp2);
        st.dirty = false;
        UI().toast('配置図を保存しました');
        HC.app.refresh();
        break;
      }
      case 'help': return showHelp();
      default:
    }
  };

  const pickImage = () =>
    new Promise((res) => {
      if (!HC.shots || !HC.shots.ready) {
        UI().toast('この開き方では画像を保存できません（Web公開したURLで開いてください）', { error: true });
        return res();
      }
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.className = 'hidden-file';
      document.body.appendChild(inp);
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return res();
        try {
          const url = URL.createObjectURL(f);
          const img = new Image();
          await new Promise((ok, ng) => { img.onload = ok; img.onerror = ng; img.src = url; });
          await HC.shots.putFile('map:' + st.evId, f, { w: img.naturalWidth, h: img.naturalHeight, name: f.name });
          URL.revokeObjectURL(url);
          st.spec.image = { src: 'idb', w: img.naturalWidth, h: img.naturalHeight };
          st.spec.view = [0, 0, img.naturalWidth, img.naturalHeight];
          st.vb = null;
          st.dirty = true;
          render();
          UI().toast('配置図の画像を取り込みました');
        } catch (e) {
          UI().toast('画像を読み込めませんでした', { error: true });
        }
        res();
      };
      inp.oncancel = () => { inp.remove(); res(); };
      inp.click();
    });

  const showHelp = () => {
    UI().sheet({
      id: 'ed-help',
      center: true,
      title: '配置図エディタの使い方',
      html: `<ol class="ed-help">
        <li><b>画像を入れる</b>：「配置図の画像」で公式の配置図を取り込みます。以後はこの画像のピクセル座標で位置を決めます。</li>
        <li><b>島を置く</b>：「島」を押してから、画像の島の左上あたりをクリック。右の欄で中心X・先頭のY・行の間隔・片側の数を合わせます。</li>
        <li><b>ずらす</b>：置いたものはドラッグで移動できます。ホイール（ピンチ）で拡大縮小、何もない所をドラッグで移動。</li>
        <li><b>通路</b>：「通路」を押して横に通り抜けられる位置をクリック。ルートの計算と地図の線がここを通ります。</li>
        <li><b>入口</b>：「入口」を押して実際の入場口をクリック。当日のスタート地点として設定から選べます。</li>
        <li><b>確認</b>：上の「席が無いサークル」が0件になれば、一覧の全サークルが配置図に載っています。</li>
      </ol>
      <p class="muted small">「JSON」を押すと、いまの配置図を data/*.js に貼れる形でコピーできます。</p>`,
    });
  };
})();
