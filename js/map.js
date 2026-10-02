/* SVG 配置図：描画・色分け・ルート線・ピンチ/ホイールズーム・パン・タップ */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const Lay = HC.layout;
  const NS = 'http://www.w3.org/2000/svg';

  HC.map = {};

  /**
   * @param container 描画先要素（サイズは CSS で決める）
   * @param opt {onTap(cid|null, sid|null), compact:boolean}
   */
  HC.map.mount = (container, opt = {}) => {
    const S = HC.store;
    const inst = { container, rotated: false, sel: null, vb: null, base: null, cellsByCid: new Map() };

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'map-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    container.innerHTML = '';
    container.appendChild(svg);

    const T = (p) => (inst.rotated ? { x: p.y, y: -p.x } : p);
    const textRot = (x, y) => (inst.rotated ? ` transform="rotate(90 ${x} ${y})"` : '');

    const wantRotate = () => {
      const o = S.state.settings.mapOrient;
      if (o === 'land') return false;
      if (o === 'port') return true;
      const r = container.getBoundingClientRect();
      return r.height > r.width * 1.15;
    };

    inst.build = () => {
      const ev = S.ev();
      const L = ev.layout;
      inst.L = L;
      inst.evId = S.state.eventId;
      inst.rotated = wantRotate();
      // 画像は同梱ファイルか、自分で取り込んだもの（'idb'）
      const imgSrc = L.image ? (L.image.src === 'idb' ? (HC.shots && HC.shots.mapUrl(S.state.eventId)) || '' : L.image.src) : '';
      const imageMode = S.state.settings.mapMode === 'image' && L.image && imgSrc;
      svg.classList.toggle('image-mode', !!imageMode);
      const parts = [];
      parts.push(`<g class="world"${inst.rotated ? ' transform="rotate(-90)"' : ''}>`);
      const [hx, hy, hw, hh] = L.hall;
      if (imageMode) {
        parts.push(`<image href="${U.esc(imgSrc)}" x="0" y="0" width="${L.image.w}" height="${L.image.h}" class="map-img"/>`);
      } else {
        parts.push(`<rect class="hall" x="${hx}" y="${hy}" width="${hw}" height="${hh}" rx="10"/>`);
        L.labels.forEach((lb) => {
          parts.push(`<text class="lbl ${lb.kind || 'letter'}" x="${lb.x}" y="${lb.y}" font-size="${lb.size || 14}"${textRot(lb.x, lb.y)}>${U.esc(lb.text)}</text>`);
        });
        L.letters.forEach((lb) => parts.push(`<text class="lbl letter" x="${lb.x}" y="${lb.y}" font-size="30"${textRot(lb.x, lb.y)}>${U.esc(lb.text)}</text>`));
      }
      // セル
      const cidOf = new Map();
      ev.circles.forEach((c) => c.nums.forEach((n) => cidOf.set(c.block + n, c.id)));
      parts.push('<g class="cells">');
      L.cells.forEach((c) => {
        const cid = cidOf.get(c.sid) || '';
        const x = c.x - c.w / 2, y = c.y - c.h / 2;
        const label = c.wall ? `<tspan x="${c.x}" dy="-1">${String(c.num).padStart(2, '0')[0]}</tspan><tspan x="${c.x}" dy="10">${String(c.num).padStart(2, '0')[1]}</tspan>` : U.pad2(c.num);
        parts.push(`<g class="cell${cid ? ' has' : ''}" data-sid="${c.sid}" data-cid="${cid}"><rect x="${x}" y="${y}" width="${c.w}" height="${c.h}" rx="2"/>${
          imageMode ? '' : `<text x="${c.x}" y="${c.wall ? c.y - 3 : c.y + 0.5}"${textRot(c.x, c.y)}>${label}</text>`}</g>`);
      });
      parts.push('</g>');
      parts.push('<g class="route-layer"></g><g class="badge-layer"></g>');
      parts.push('</g>');
      svg.innerHTML = parts.join('');

      inst.cellsByCid = new Map();
      U.$$('.cell.has', svg).forEach((g) => {
        const cid = g.dataset.cid;
        if (!inst.cellsByCid.has(cid)) inst.cellsByCid.set(cid, []);
        inst.cellsByCid.get(cid).push(g);
      });

      // 初期表示範囲
      const [vx, vy, vw, vh] = L.view;
      const a = T({ x: vx, y: vy }), b = T({ x: vx + vw, y: vy + vh });
      inst.base = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      inst.home();
      inst.paint();
    };

    /** 初期表示：縦向きは横幅いっぱい（スタート地点付近）、横向きは全体 */
    inst.home = () => {
      const b = inst.base;
      const r = container.getBoundingClientRect();
      if (!inst.rotated || !r.width || !r.height) return inst.setVB({ ...b });
      const scaleW = r.width / b.w;
      const scaleMeet = Math.min(r.width / b.w, r.height / b.h);
      if (scaleW < scaleMeet * 1.2) return inst.setVB({ ...b });
      const h = r.height / scaleW;
      const w = h * (b.w / b.h);
      const st = T(S.startPoint());
      inst.setVB({ x: b.x + b.w / 2 - w / 2, y: st.y - h * 0.3, w, h });
    };

    inst.setVB = (vb) => {
      const b = inst.base;
      vb.w = U.clamp(vb.w, b.w / 12, b.w * 1.4);
      vb.h = vb.w * (b.h / b.w);
      // 中心が会場外に出ないように
      const cx = U.clamp(vb.x + vb.w / 2, b.x, b.x + b.w);
      const cy = U.clamp(vb.y + vb.h / 2, b.y, b.y + b.h);
      vb.x = cx - vb.w / 2;
      vb.y = cy - vb.h / 2;
      inst.vb = vb;
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
      const z = b.w / vb.w;
      svg.classList.toggle('zoomed', z > 2.2);
      routeOnZoom();
    };

    inst.fit = () => inst.setVB({ ...inst.base });

    /** 色分け・番号バッジ・ルート線を最新状態に */
    /** 巡回の脚（A→B）の一覧。区間表示とルート線の両方で使う */
    inst.legs = () => {
      const d = S.d();
      const q = S.queue();
      const L = inst.L;
      if (!L) return [];
      const remaining = [...q.todo, ...q.later];
      const o = S.origin();   // いまいる場所（指定した場所か、最後に回ったサークル）
      let from = o.p;
      let fromName = o.label;
      const legs = [];
      remaining.forEach((cid, i) => {
        const c = S.circle(cid);
        const p = c && Lay.pointOf(L, c);
        if (!p) return;
        legs.push({ i: legs.length, cid, from, to: p, fromName, toName: c.space, toCircle: c, no: i + 1, dist: Lay.dist(L, from, p) });
        from = p;
        fromName = c.space;
      });
      return legs;
    };

    /** その区間だけを画面に収める */
    inst.showLeg = (i) => {
      const legs = inst.legs();
      if (!legs.length) return null;
      const n = U.clamp(i, 0, legs.length - 1);
      inst.segIndex = n;
      const leg = legs[n];
      const pad = 90;
      const a = T(leg.from), b = T(leg.to);
      const x = Math.min(a.x, b.x) - pad, y = Math.min(a.y, b.y) - pad;
      const w = Math.abs(b.x - a.x) + pad * 2, h = Math.abs(b.y - a.y) + pad * 2;
      const box = inst.base;
      const ratio = box.h / box.w;
      // 下には区間の案内の帯が重なるので、少し広めに取って区間を画面の上寄り（高さの42%の位置）に置く
      const vw = Math.max(w, h / ratio) / 0.8, vh = vw * ratio;
      inst.setVB({ x: (x + w / 2) - vw / 2, y: (y + h / 2) - vh * 0.42, w: vw, h: vh });
      inst.paint();
      return leg;
    };

    inst.clearLeg = () => { inst.segIndex = null; inst.paint(); inst.fit(); };

    inst.paint = () => {
      if (!inst.L) return;
      const d = S.d();
      const q = S.queue();
      const L = inst.L;
      inst.cellsByCid.forEach((els, cid) => {
        const e = d.entries[cid];
        const c = S.circle(cid);
        const cls = ['cell', 'has'];
        if (e) cls.push('pl', 'p' + e.pri, 'st-' + e.status);
        let rqColor = '';
        if (e && HC.views.band) {
          const b = HC.views.band(e);
          if (b.rids.length) { cls.push(b.own ? 'pxm' : 'pxo'); rqColor = HC.views.RQ_COLORS[HC.views.rqIndex(b.rids[0])]; }
        }
        if (cid === q.current) cls.push('next');
        if (cid === inst.sel) cls.push('sel');
        if (c && S.isFav(c)) cls.push('fav');
        const s = cls.join(' ');
        els.forEach((g) => { g.setAttribute('class', s); if (rqColor) g.style.setProperty('--rq', rqColor); else g.style.removeProperty('--rq'); });
      });

      // 巡回番号バッジ
      const remaining = [...q.todo, ...q.later];
      const badges = [];
      remaining.forEach((cid, i) => {
        const c = S.circle(cid);
        const p = c && Lay.centerOf(L, c);
        if (!p) return;
        const e = d.entries[cid];
        // 代行の分があるサークルは、番号の丸も依頼者の色（代行だけなら塗り、自分の分もあれば縁取り）
        const bd = HC.views.band ? HC.views.band(e) : { rids: [] };
        const px = bd.rids.length ? ` ${bd.own ? 'pxm' : 'pxo'}" style="--rq:${HC.views.RQ_COLORS[HC.views.rqIndex(bd.rids[0])]}` : '';
        badges.push(`<g class="badge p${e.pri}${cid === q.current ? ' next' : ''}${e.status === 'later' ? ' later' : ''}${px}" data-cid="${cid}"><circle cx="${p.x}" cy="${p.y}" r="12"/><text x="${p.x}" y="${p.y + 0.5}"${textRot(p.x, p.y)}>${i + 1}</text></g>`);
      });
      U.$('.badge-layer', svg).innerHTML = badges.join('');

      // ルート線
      inst.paintRoute();
    };

    /*
     * ルート線。区間（いまいる場所→1件目、1件目→2件目…）ごとに線を引き、
     * 同じ通路を何度も通る区間は「車線」をずらして並べる（地下鉄の路線図のように、重ならず並んで見える）。
     * 車線の間隔は画面上で一定（拡大・縮小したら描き直す）。先の区間ほど薄くして、近い区間を目立たせる
     */
    const LANE_PX = 6.5;     // 車線の間隔（画面上の px）
    const LANE_ORDER = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
    /** 折れ線を「縦・横の線分」の並びに整える（同じ点・一直線の途中の点を省く） */
    const cleanPoly = (pts) => {
      const out = [];
      pts.forEach((p) => {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) return;
        if (out.length >= 2) {
          const a = out[out.length - 2], b = last;
          const colV = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5;
          const colH = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5;
          if (colV || colH) out.pop();
        }
        out.push(p);
      });
      return out;
    };
    /** 区間ごとの線に車線を割り当て、ずらした点列を返す */
    const laneRoutes = (legs, gap) => {
      const used = new Map();   // 通路（向き＋位置）→ [{lo, hi, lane}]
      return legs.map((leg) => {
        const pts = cleanPoly(Lay.polyline(inst.L, leg.from, leg.to));
        if (pts.length < 2) return null;
        const segs = [];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const vert = Math.abs(a.x - b.x) < 0.5;
          const key = vert ? 'v' + Math.round(a.x) : 'h' + Math.round(a.y);
          const lo = vert ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
          const hi = vert ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
          const list = used.get(key) || [];
          const busy = new Set(list.filter((s) => s.lo < hi - 1 && s.hi > lo + 1).map((s) => s.lane));
          const lane = LANE_ORDER.find((l) => !busy.has(l)) ?? 0;
          list.push({ lo, hi, lane });
          used.set(key, list);
          segs.push({ vert, off: lane * gap });
        }
        // 角の点は、前後の線分のずらし（縦の線分は x、横の線分は y）を合わせて決める
        return pts.map((p, i) => {
          const before = segs[i - 1], after = segs[i];
          let dx = 0, dy = 0;
          [before, after].forEach((s) => { if (!s) return; if (s.vert) dx = s.off; else dy = s.off; });
          return { x: p.x + dx, y: p.y + dy };
        });
      });
    };
    const ptsAttr = (pts) => pts.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(' ');

    inst.paintRoute = () => {
      const layer = U.$('.route-layer', svg);
      if (!inst.L || !layer) return;
      const q = S.queue();
      const segMode = inst.segIndex != null;
      // 区間表示中は、ルート線を非表示にしていても、その区間だけは必ず描く（道順を見たくて開いているため）
      if (!(S.state.settings.showRoute || segMode) || !(q.todo.length + q.later.length)) { layer.innerHTML = ''; return; }
      const legs = inst.legs();
      if (!legs.length) { layer.innerHTML = ''; return; }
      // 画面上の 1px が配置図の座標でいくつか
      const r = svg.getBoundingClientRect();
      const scale = r.width && r.height && inst.vb ? Math.min(r.width / inst.vb.w, r.height / inst.vb.h) : 0.5;
      inst.routeScale = scale;
      const lanes = laneRoutes(legs, LANE_PX / scale);
      const st = S.origin().p;
      let html = '';
      if (S.state.settings.showRoute) {
        // 先の区間から描いて、近い区間が上に来るようにする
        for (let i = legs.length - 1; i >= 0; i--) {
          const pts = lanes[i];
          if (!pts) continue;
          const first = i === 0 && legs[0].cid === q.current && !segMode;
          const op = segMode ? 0.2 : Math.max(0.28, 1 - i * 0.09);
          html += `<g class="leg-g${first ? ' now' : ''}" style="opacity:${first ? 1 : op.toFixed(2)}"><polyline class="route-casing${first ? ' wide' : ''}" points="${ptsAttr(pts)}"/><polyline class="route${first ? ' next-leg' : ''}" points="${ptsAttr(pts)}"/></g>`;
        }
      }
      html += `<g class="start-mark"><circle cx="${st.x}" cy="${st.y}" r="7"/></g>`;
      if (segMode) {
        // 選んだ区間だけをはっきり描く
        const n = U.clamp(inst.segIndex, 0, legs.length - 1);
        const leg = legs[n], pts = lanes[n];
        if (leg && pts) {
          html += `<polyline class="route-casing wide" points="${ptsAttr(pts)}"/><polyline class="route leg-line" points="${ptsAttr(pts)}"/>`;
          html += `<g class="leg-mark from"><circle cx="${leg.from.x}" cy="${leg.from.y}" r="9"/></g>`;
          html += `<g class="leg-mark to"><circle cx="${leg.to.x}" cy="${leg.to.y}" r="11"/></g>`;
        }
      }
      layer.innerHTML = html;
    };

    /** 拡大率が変わったら、車線の間隔を画面上で一定に保つためにルート線だけ描き直す（1フレームに1回まで） */
    let routeFrame = 0;
    const routeOnZoom = () => {
      if (routeFrame || !inst.routeScale) return;
      routeFrame = requestAnimationFrame(() => {
        routeFrame = 0;
        const r = svg.getBoundingClientRect();
        const scale = r.width && inst.vb ? Math.min(r.width / inst.vb.w, r.height / inst.vb.h) : 0;
        if (scale && Math.abs(Math.log(scale / inst.routeScale)) > 0.12) inst.paintRoute();
      });
    };


    /** 指定サークルへ寄る */
    inst.focus = (cid, zoom = 3.2) => {
      const c = S.circle(cid);
      const p = c && Lay.centerOf(inst.L, c);
      if (!p) return false;
      const t = T(p);
      const w = inst.base.w / zoom, h = inst.base.h / zoom;
      animateTo({ x: t.x - w / 2, y: t.y - h / 2, w, h });
      return true;
    };

    inst.flash = (cid) => {
      (inst.cellsByCid.get(cid) || []).forEach((g) => {
        g.classList.remove('flash');
        void g.getBBox();
        g.classList.add('flash');
      });
    };

    inst.select = (cid) => { inst.sel = cid; inst.paint(); };

    let anim = null;
    const animateTo = (to) => {
      cancelAnimationFrame(anim);
      const from = { ...inst.vb };
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 280);
        const e = 1 - Math.pow(1 - k, 3);
        inst.setVB({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    };

    // ---------------------------------------------------------------- 操作
    const toWorld = (clientX, clientY) => {
      const pt = svg.createSVGPoint();
      pt.x = clientX; pt.y = clientY;
      const m = svg.getScreenCTM();
      return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    };
    const zoomAt = (clientX, clientY, k) => {
      const p = toWorld(clientX, clientY);
      const vb = inst.vb;
      const w = U.clamp(vb.w / k, inst.base.w / 12, inst.base.w * 1.4);
      const kk = vb.w / w;
      inst.setVB({ x: p.x - (p.x - vb.x) / kk, y: p.y - (p.y - vb.y) / kk, w, h: vb.h / kk });
    };
    inst.zoomBy = (k) => {
      const r = svg.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, k);
    };

    const ptrs = new Map();
    let gesture = null;
    let lastTap = { t: 0, x: 0, y: 0 };

    svg.addEventListener('pointerdown', (e) => {
      cancelAnimationFrame(anim);
      try { svg.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        gesture = { mode: 'pan', sx: e.clientX, sy: e.clientY, vb: { ...inst.vb }, moved: 0, t: performance.now(), target: e.target };
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        gesture = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), w0: inst.vb.w, moved: 99, last: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !gesture) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture.mode === 'pan' && ptrs.size === 1) {
        const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
        gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
        if (gesture.moved < 4) return;
        const r = svg.getBoundingClientRect();
        const scale = Math.min(r.width / gesture.vb.w, r.height / gesture.vb.h);
        inst.setVB({ ...gesture.vb, x: gesture.vb.x - dx / scale, y: gesture.vb.y - dy / scale });
      } else if (gesture.mode === 'pinch' && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // 中点移動でパン
        const r = svg.getBoundingClientRect();
        const scale = Math.min(r.width / inst.vb.w, r.height / inst.vb.h);
        inst.setVB({ ...inst.vb, x: inst.vb.x - (mid.x - gesture.last.x) / scale, y: inst.vb.y - (mid.y - gesture.last.y) / scale });
        gesture.last = mid;
        const targetW = gesture.w0 * (gesture.d0 / Math.max(d, 1));
        zoomAt(mid.x, mid.y, inst.vb.w / targetW);
      }
    });
    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (gesture && gesture.mode === 'pan' && ptrs.size === 0 && gesture.moved < 8 && performance.now() - gesture.t < 600) {
        const now = performance.now();
        if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
          zoomAt(e.clientX, e.clientY, 2);
          lastTap.t = 0;
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
          const g = gesture.target && gesture.target.closest && gesture.target.closest('[data-cid]');
          const cid = g && g.dataset.cid ? g.dataset.cid : null;
          const sid = g && g.dataset.sid ? g.dataset.sid : null;
          opt.onTap && opt.onTap(cid, sid);
        }
      }
      if (ptrs.size === 1) {
        const [p] = [...ptrs.values()];
        gesture = { mode: 'pan', sx: p.x, sy: p.y, vb: { ...inst.vb }, moved: 99, t: 0 };
      } else if (ptrs.size === 0) gesture = null;
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    }, { passive: false });

    // サイズが決まったら描画。縦横が入れ替わったら作り直す
    inst.ensure = () => {
      const r = container.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      if (!inst.L || wantRotate() !== inst.rotated) inst.build();
      return true;
    };
    const ro = new ResizeObserver(() => inst.ensure());
    ro.observe(container);
    requestAnimationFrame(() => inst.ensure());
    inst.destroy = () => ro.disconnect();

    return inst;
  };
})();
