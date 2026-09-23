/* 配置図レイアウト（スペースの座標）と巡回ルート計算 */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const P = HC.parser;
  const Lay = (HC.layout = {});

  const GAP = 25; // 机の端から通路中央までの距離（立ち位置）

  /** spec（data/*.js の layout）→ 実座標つきレイアウト */
  Lay.build = (spec) => {
    const cw = spec.cell?.w ?? 22;
    const ch = spec.cell?.h ?? 13;
    const L = {
      spec,
      cells: [],
      bySid: new Map(),
      letters: [],
      labels: spec.labels || [],
      starts: spec.starts || [],
      crossY: spec.crossY || [],
      view: spec.view,
      hall: spec.hall,
      image: spec.image || null,
    };
    const add = (c) => { L.cells.push(c); L.bySid.set(c.sid, c); };
    const rowsDefault = spec.rows || [];
    const letterYDefault =
      spec.letterY ?? (rowsDefault.length >= 11 ? (rowsDefault[9] + rowsDefault[10]) / 2 : (rowsDefault[0] || 0) - 20);

    (spec.blocks || []).forEach((b) => {
      if (b.type === 'island') {
        const rows = b.rows || rowsDefault;
        const N = b.perSide || rows.length || 20;
        const right = P.rangeSet(b.right ?? `1-${N}`);
        const left = P.rangeSet(b.left ?? `${N + 1}-${N * 2}`);
        const yOf = b.yOf || {}; // 不規則な島のための番号→Y の上書き
        right.forEach((n) => {
          const y = yOf[n] ?? rows[n - 1];
          if (y == null) return;
          add({ sid: b.block + n, block: b.block, num: n, x: b.x + cw / 2, y, w: cw, h: ch, face: 'E', sx: b.x + cw + GAP, sy: y });
        });
        left.forEach((n) => {
          const y = yOf[n] ?? rows[2 * N - n];
          if (y == null) return;
          add({ sid: b.block + n, block: b.block, num: n, x: b.x - cw / 2, y, w: cw, h: ch, face: 'W', sx: b.x - cw - GAP, sy: y });
        });
        L.letters.push({ text: b.block, x: b.x, y: b.letterY ?? letterYDefault });
      } else if (b.type === 'column') {
        const ys = b.ys || rowsDefault;
        P.rangeSet(b.nums).forEach((n) => {
          const y = ys[n - 1];
          if (y == null) return;
          const dir = b.face === 'E' ? 1 : -1;
          add({ sid: b.block + n, block: b.block, num: n, x: b.x, y, w: cw, h: ch, face: b.face || 'W', sx: b.x + dir * (cw / 2 + GAP), sy: y });
        });
        L.letters.push({ text: b.block, x: b.x, y: b.letterY ?? letterYDefault });
      } else if (b.type === 'cells') {
        // 1席ずつ座標を持つ形（公式配置図から実測した配置に使う）
        // E/W/N/S = 通路がある向き。cells は [番号, x, y]
        const cw2 = b.w ?? cw, ch2 = b.h ?? ch;
        [['E', 1, 0], ['W', -1, 0], ['S', 0, 1], ['N', 0, -1]].forEach(([face, dx, dy]) => {
          (b[face] || []).forEach(([n, x, y]) => {
            add({
              sid: b.block + n, block: b.block, num: n, x, y, w: cw2, h: ch2, face,
              sx: x + dx * (cw2 / 2 + GAP), sy: y + dy * (ch2 / 2 + GAP), wall: dy !== 0,
            });
          });
        });
        (b.letterAt || []).forEach(([x, y]) => L.letters.push({ text: b.block, x, y }));
      } else if (b.type === 'wall') {
        const w = b.w ?? 12.5, h = b.h ?? 24;
        const dir = b.face === 'S' ? 1 : -1;
        (b.cells || []).forEach(([x, n]) => {
          add({ sid: b.block + n, block: b.block, num: n, x, y: b.y, w, h, face: b.face || 'N', sx: x, sy: b.y + dir * (h / 2 + 20), wall: true });
        });
      }
    });

    if (!L.view) {
      const xs = L.cells.map((c) => c.x), ys = L.cells.map((c) => c.y);
      const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60, y0 = Math.min(...ys) - 60, y1 = Math.max(...ys) + 60;
      L.view = [x0, y0, x1 - x0, y1 - y0];
    }
    if (!L.hall) L.hall = [L.view[0] + 10, L.view[1] + 10, L.view[2] - 20, L.view[3] - 20];
    if (!L.starts.length) L.starts = [{ id: 'top-right', label: '右上', x: L.view[0] + L.view[2] - 40, y: L.view[1] + 40 }];
    return L;
  };

  /** 配置図が無いイベント用：ブロックごとに縦2列の島を並べた簡易レイアウト */
  Lay.autoSpec = (circles) => {
    const maxBy = {};
    circles.forEach((c) => c.nums.forEach((n) => (maxBy[c.block] = Math.max(maxBy[c.block] || 0, n))));
    const blocks = Object.keys(maxBy).sort((a, b) => (a.length - b.length) || (a < b ? 1 : -1)); // 右端がA
    const maxN = Math.max(2, ...Object.values(maxBy));
    const N = Math.min(40, Math.ceil(maxN / 2));
    const rows = Array.from({ length: N }, (_, r) => 120 + r * 15 + Math.floor(r / 10) * 24);
    const bottom = rows[N - 1] + 30;
    return {
      auto: true,
      rows,
      letterY: 90,
      crossY: [100, ...rows.filter((_, i) => i % 10 === 9).map((y) => y + 19), bottom],
      // 1..M を 右側を上→下に 1..r、左側を下→上に r+1..M（コミケ式のU字）で並べる
      blocks: blocks.map((b, i) => {
        const M = maxBy[b];
        const r = Math.ceil(M / 2);
        return { type: 'island', block: b, x: 100 + i * 95, perSide: r, right: `1-${r}`, left: M > r ? `${r + 1}-${M}` : '' };
      }),
      labels: [],
      starts: [{ id: 'top-right', label: '右上', x: 100 + (blocks.length - 1) * 95 + 60, y: 100 }],
    };
  };

  Lay.forCircles = (spec, circles) => Lay.build(spec || Lay.autoSpec(circles));

  /** サークルのセル一覧 */
  Lay.cellsOf = (L, c) => (c ? c.nums.map((n) => L.bySid.get(c.block + n)).filter(Boolean) : []);

  /** サークルの前の立ち位置（通路上の点） */
  Lay.pointOf = (L, c) => {
    const cs = Lay.cellsOf(L, c);
    if (!cs.length) return null;
    return { x: U.sum(cs, (x) => x.sx) / cs.length, y: U.sum(cs, (x) => x.sy) / cs.length };
  };
  Lay.centerOf = (L, c) => {
    const cs = Lay.cellsOf(L, c);
    if (!cs.length) return null;
    return { x: U.sum(cs, (x) => x.x) / cs.length, y: U.sum(cs, (x) => x.y) / cs.length };
  };

  /** 通路を考慮した移動コスト（同じ通路なら直行、違えば横通路を経由） */
  Lay.dist = (L, a, b) => {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    if (dx < 45 || !L.crossY.length) return dx + dy;
    let best = Infinity;
    for (const c of L.crossY) best = Math.min(best, Math.abs(a.y - c) + Math.abs(b.y - c));
    return dx + best;
  };

  /**
   * 始点 start から points を全部回る近似最短順（最近傍法 + 2-opt）
   * @param points [{id, p:{x,y}}]
   * @returns id[]
   */
  Lay.route = (L, points, start) => {
    const n = points.length;
    if (n <= 1) return points.map((p) => p.id);
    const nodes = [start, ...points.map((p) => p.p)];
    const D = nodes.map((a) => nodes.map((b) => Lay.dist(L, a, b)));
    // 最近傍
    const tour = [0];
    const used = new Set([0]);
    while (tour.length < n + 1) {
      const last = tour[tour.length - 1];
      let bi = -1, bd = Infinity;
      for (let j = 1; j <= n; j++) if (!used.has(j) && D[last][j] < bd) { bd = D[last][j]; bi = j; }
      tour.push(bi);
      used.add(bi);
    }
    // 2-opt（始点固定・終点自由）
    let improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;
      for (let i = 1; i < n; i++) {
        for (let k = i + 1; k <= n; k++) {
          const a = tour[i - 1], b = tour[i], c = tour[k], d = tour[k + 1];
          const before = D[a][b] + (d != null ? D[c][d] : 0);
          const after = D[a][c] + (d != null ? D[b][d] : 0);
          if (after + 1e-6 < before) {
            for (let x = i, y = k; x < y; x++, y--) [tour[x], tour[y]] = [tour[y], tour[x]];
            improved = true;
          }
        }
      }
    }
    return tour.slice(1).map((i) => points[i - 1].id);
  };

  Lay.pathLength = (L, pts) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Lay.dist(L, pts[i - 1], pts[i]);
    return s;
  };

  /** 通路に沿った折れ線（地図のルート線用） */
  Lay.polyline = (L, a, b) => {
    const dx = Math.abs(a.x - b.x);
    if (dx < 45 || !L.crossY.length) return [a, { x: a.x, y: b.y }, b];
    let bc = L.crossY[0], best = Infinity;
    for (const c of L.crossY) {
      const v = Math.abs(a.y - c) + Math.abs(b.y - c);
      if (v < best) { best = v; bc = c; }
    }
    return [a, { x: a.x, y: bc }, { x: b.x, y: bc }, b];
  };
})();
