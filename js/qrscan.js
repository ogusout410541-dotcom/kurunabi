/* QRコードの読み取り（カメラの映像から）。外部ライブラリは使わない。
   iPhone・iPad の Safari には読み取りの機能（BarcodeDetector）が無いので、解読を自作している。
   端末に BarcodeDetector があればそちらを先に使い、読めなかったときだけ自作の解読にまわす。
   流れ：明るさ → 2値化（場所ごとの閾値）→ 位置検出パターン（角の3つの四角）を探す → 歪みを補正して1マスずつ読む
        → 形式情報（誤り訂正レベル・マスク）→ マスクを外してコード語を読む → Reed-Solomon で誤りを直す → 文字に戻す
   表（誤り訂正のブロック構成など）は作成側（js/qr.js の HC.qr._t）と共通 */
(function () {
  'use strict';
  const HC = window.HC;
  const QS = (HC.qrscan = {});
  const T = () => HC.qr._t;

  // ------------------------------------------------------------------ 2値化
  /** RGBA → 明るさ（0〜255） */
  const toGray = (img) => {
    const { data, width: w, height: h } = img;
    const g = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    return g;
  };

  /** 8×8 の区画ごとに明るさの幅を見て閾値を決め、周り 5×5 区画の平均で 2値化（1＝黒）。照明のむらに強い */
  const binarize = (gray, w, h) => {
    const R = 8;
    const cw = Math.ceil(w / R), ch = Math.ceil(h / R);
    const bp = new Float32Array(cw * ch);
    for (let by = 0; by < ch; by++) {
      for (let bx = 0; bx < cw; bx++) {
        let sum = 0, mn = 255, mx = 0, n = 0;
        const y0 = Math.min(by * R, h - R), x0 = Math.min(bx * R, w - R);
        for (let y = Math.max(0, y0); y < Math.max(0, y0) + R && y < h; y++) {
          for (let x = Math.max(0, x0); x < Math.max(0, x0) + R && x < w; x++) {
            const v = gray[y * w + x];
            sum += v; n++;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
        }
        let avg = sum / Math.max(1, n);
        if (mx - mn <= 24) {
          // ほぼ一様な区画：白地の可能性が高いので低めに。隣が黒っぽければそれに合わせる
          avg = mn / 2;
          if (by > 0 && bx > 0) {
            const nb = (bp[(by - 1) * cw + bx] + 2 * bp[by * cw + bx - 1] + bp[(by - 1) * cw + bx - 1]) / 4;
            if (mn < nb) avg = nb;
          }
        }
        bp[by * cw + bx] = avg;
      }
    }
    const out = new Uint8Array(w * h);
    for (let by = 0; by < ch; by++) {
      for (let bx = 0; bx < cw; bx++) {
        const cx = Math.min(Math.max(bx, 2), cw - 3), cy = Math.min(Math.max(by, 2), ch - 3);
        let s = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const yy = cy + dy, xx = cx + dx;
          if (yy >= 0 && yy < ch && xx >= 0 && xx < cw) { s += bp[yy * cw + xx]; n++; }
        }
        const th = s / n;
        for (let y = by * R; y < by * R + R && y < h; y++) {
          for (let x = bx * R; x < bx * R + R && x < w; x++) out[y * w + x] = gray[y * w + x] <= th ? 1 : 0;
        }
      }
    }
    return out;
  };

  // ------------------------------------------------------------------ 位置検出パターン（1:1:3:1:1）
  const ratioOk = (sc) => {
    let total = 0;
    for (let i = 0; i < 5; i++) { if (!sc[i]) return false; total += sc[i]; }
    if (total < 7) return false;
    const m = total / 7, v = m / 2;
    return Math.abs(m - sc[0]) < v && Math.abs(m - sc[1]) < v && Math.abs(3 * m - sc[2]) < 3 * v && Math.abs(m - sc[3]) < v && Math.abs(m - sc[4]) < v;
  };
  const centerFromEnd = (sc, end) => end - sc[4] - sc[3] - sc[2] / 2;

  const findFinders = (bm, w, h) => {
    const at = (x, y) => bm[y * w + x];
    const found = [];
    /** 縦（または横）方向にも同じ比率で並んでいるか確かめ、中心を返す */
    const cross = (sx, sy, dx, dy, maxCount, origTotal) => {
      const len = dx ? w : h;
      const pos0 = dx ? sx : sy;
      const get = (p) => (dx ? at(p, sy) : at(sx, p));
      const sc = [0, 0, 0, 0, 0];
      let p = pos0;
      while (p >= 0 && get(p)) { sc[2]++; p--; }
      if (p < 0) return NaN;
      while (p >= 0 && !get(p) && sc[1] <= maxCount) { sc[1]++; p--; }
      if (p < 0 || sc[1] > maxCount) return NaN;
      while (p >= 0 && get(p) && sc[0] <= maxCount) { sc[0]++; p--; }
      if (sc[0] > maxCount) return NaN;
      p = pos0 + 1;
      while (p < len && get(p)) { sc[2]++; p++; }
      if (p === len) return NaN;
      while (p < len && !get(p) && sc[3] < maxCount) { sc[3]++; p++; }
      if (p === len || sc[3] >= maxCount) return NaN;
      while (p < len && get(p) && sc[4] < maxCount) { sc[4]++; p++; }
      if (sc[4] >= maxCount) return NaN;
      const tot = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
      if (5 * Math.abs(tot - origTotal) >= 2 * origTotal) return NaN;
      return ratioOk(sc) ? centerFromEnd(sc, p) : NaN;
    };
    const handle = (sc, y, x) => {
      const total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
      let cx = centerFromEnd(sc, x);
      const cy = cross(Math.floor(cx), y, 0, 1, sc[2], total);
      if (Number.isNaN(cy)) return false;
      cx = cross(Math.floor(cx), Math.floor(cy), 1, 0, sc[2], total);
      if (Number.isNaN(cx)) return false;
      const size = total / 7;
      for (const f of found) {
        if (Math.abs(cy - f.y) <= size && Math.abs(cx - f.x) <= size && (Math.abs(size - f.size) <= 1 || Math.abs(size - f.size) <= f.size)) {
          const n = f.count + 1;
          f.x = (f.count * f.x + cx) / n; f.y = (f.count * f.y + cy) / n; f.size = (f.count * f.size + size) / n; f.count = n;
          return true;
        }
      }
      found.push({ x: cx, y: cy, size, count: 1 });
      return true;
    };
    const skip = h > 300 ? 2 : 1;
    for (let y = 0; y < h; y += skip) {
      const sc = [0, 0, 0, 0, 0];
      let st = 0;
      for (let x = 0; x < w; x++) {
        if (at(x, y)) {
          if (st & 1) st++;
          sc[st]++;
        } else if (!(st & 1)) {
          if (st === 4) {
            if (ratioOk(sc) && handle(sc, y, x)) { sc.fill(0); st = 0; continue; }
            sc[0] = sc[2]; sc[1] = sc[3]; sc[2] = sc[4]; sc[3] = 1; sc[4] = 0; st = 3;
          } else { st++; sc[st]++; }
        } else sc[st]++;
      }
      if (ratioOk(sc)) handle(sc, y, w);
    }
    return found;
  };

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /** 候補から「角の3つ」の組を選ぶ（大きさがそろい、直角二等辺に近いもの）。よい順に返す */
  const pickTriplets = (fs) => {
    const cand = fs.slice().sort((a, b) => b.count - a.count).slice(0, 10);
    const out = [];
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) for (let k = j + 1; k < cand.length; k++) {
      const p = [cand[i], cand[j], cand[k]];
      const ms = (p[0].size + p[1].size + p[2].size) / 3;
      if (p.some((q) => Math.abs(q.size - ms) > ms * 0.5)) continue;
      // いちばん離れた2つが右上と左下、残りが左上
      const d = [[0, 1, dist(p[0], p[1])], [0, 2, dist(p[0], p[2])], [1, 2, dist(p[1], p[2])]].sort((a, b) => b[2] - a[2]);
      const [ia, ib, far] = d[0];
      const ic = 3 - ia - ib;
      const tl = p[ic];
      let tr = p[ia], bl = p[ib];
      const z = (tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x);
      if (z < 0) [tr, bl] = [bl, tr];
      const a = dist(tl, tr), b = dist(tl, bl);
      if (a < ms * 7 || b < ms * 7) continue;
      const score = Math.abs(a - b) / Math.max(a, b) + Math.abs(far - Math.hypot(a, b)) / far + (p.reduce((s, q) => s + Math.abs(q.size - ms), 0) / ms) * 0.3;
      if (score > 0.5) continue;
      out.push({ tl, tr, bl, size: ms, score });
    }
    return out.sort((x, y) => x.score - y.score).slice(0, 4);
  };

  /** 1マスの大きさを、パターンどうしを結ぶ線に沿って測る（横方向の長さで測ると斜めのときに大きく見積もってしまう）。
   *  中心から「黒→白→黒→外の白」と進んで外の白に出るまでが 3.5マス */
  const edgeRun = (bm, w, h, from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    let st = 0;
    for (let t = 0; t < L; t += 0.5) {
      const x = Math.round(from.x + ux * t), y = Math.round(from.y + uy * t);
      if (x < 0 || y < 0 || x >= w || y >= h) return NaN;
      const dark = bm[y * w + x];
      if (st === 0 && !dark) st = 1;
      else if (st === 1 && dark) st = 2;
      else if (st === 2 && !dark) return t / 3.5;
    }
    return NaN;
  };
  const moduleAlong = (bm, w, h, tl, tr, bl) => {
    const v = [edgeRun(bm, w, h, tl, tr), edgeRun(bm, w, h, tr, tl), edgeRun(bm, w, h, tl, bl), edgeRun(bm, w, h, bl, tl)].filter((x) => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };

  // ------------------------------------------------------------------ 歪みの補正（射影変換）
  const sq2quad = (x0, y0, x1, y1, x2, y2, x3, y3) => {
    const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    const a13 = (dx3 * dy2 - dx2 * dy3) / den, a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
  };
  // 並びは ZXing と同じ (a11, a21, a31, a12, a22, a32, a13, a23, a33)
  const adj = (m) => {
    const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = m;
    return [a22 * a33 - a23 * a32, a23 * a31 - a21 * a33, a21 * a32 - a22 * a31,
      a13 * a32 - a12 * a33, a11 * a33 - a13 * a31, a12 * a31 - a11 * a32,
      a12 * a23 - a13 * a22, a13 * a21 - a11 * a23, a11 * a22 - a12 * a21];
  };
  const times = (a, o) => {
    const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = a;
    const [b11, b21, b31, b12, b22, b32, b13, b23, b33] = o;
    return [a11 * b11 + a21 * b12 + a31 * b13, a11 * b21 + a21 * b22 + a31 * b23, a11 * b31 + a21 * b32 + a31 * b33,
      a12 * b11 + a22 * b12 + a32 * b13, a12 * b21 + a22 * b22 + a32 * b23, a12 * b31 + a22 * b32 + a32 * b33,
      a13 * b11 + a23 * b12 + a33 * b13, a13 * b21 + a23 * b22 + a33 * b23, a13 * b31 + a23 * b32 + a33 * b33];
  };
  const quad2quad = (src, dst) => times(sq2quad(...dst), adj(sq2quad(...src)));
  const apply = (m, x, y) => {
    const d = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / d, (m[3] * x + m[4] * y + m[5]) / d];
  };

  /** 右下の位置合わせパターン（5×5 の小さな四角）を、見込みの位置のまわりで探す */
  const findAlignment = (bm, w, h, ex, ey, ms, need = 8) => {
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? bm[Math.round(y) * w + Math.round(x)] : 0);
    let best = null;
    for (const allow of [4, 8, 16]) {
      const r = allow * ms;
      const step = Math.max(1, ms / 3);
      for (let y = ey - r; y <= ey + r; y += step) {
        for (let x = ex - r; x <= ex + r; x += step) {
          if (!at(x, y)) continue;
          // 中心が黒・1マス外が白・2マス外が黒
          // 8方向のうち need 方向以上で「1マス外が白・2マス外が黒」なら位置合わせパターンとみなす（厳しい判定 8 → ゆるい判定 7 の順に試す）
          let hit = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            if (!at(x + dx * ms, y + dy * ms) && at(x + dx * ms * 2, y + dy * ms * 2)) hit++;
          }
          if (hit < need) continue;
          const d = Math.hypot(x - ex, y - ey);
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      if (best) {
        // 中心の黒いかたまりの重心に寄せる
        let sx = 0, sy = 0, n = 0;
        const rr = ms * 0.7;
        for (let y = best.y - rr; y <= best.y + rr; y += 0.5) for (let x = best.x - rr; x <= best.x + rr; x += 0.5) if (at(x, y)) { sx += x; sy += y; n++; }
        return n ? { x: sx / n, y: sy / n } : best;
      }
    }
    return null;
  };

  /** 1マスずつ読む（白黒の行列）。dim×dim、[y][x] で 1＝黒 */
  const sample = (bm, w, h, m, dim) => {
    const g = [];
    let outside = 0;
    for (let y = 0; y < dim; y++) {
      const row = new Uint8Array(dim);
      for (let x = 0; x < dim; x++) {
        const [px, py] = apply(m, x + 0.5, y + 0.5);
        const ix = Math.floor(px), iy = Math.floor(py);
        if (ix < 0 || iy < 0 || ix >= w || iy >= h) { outside++; continue; }
        row[x] = bm[iy * w + ix];
      }
      g.push(row);
    }
    return outside > dim * 2 ? null : g;
  };

  // ------------------------------------------------------------------ 誤り訂正（Reed-Solomon、生成多項式の根は α^0 から）
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : T().EXP[T().LOG[a] + T().LOG[b]]);
  const gfPow = (x, p) => T().EXP[(((T().LOG[x] * p) % 255) + 255) % 255];
  const gfInv = (x) => T().EXP[255 - T().LOG[x]];
  const gfDiv = (a, b) => (a === 0 ? 0 : T().EXP[(T().LOG[a] + 255 - T().LOG[b]) % 255]);
  const polyEval = (p, x) => { let y = p[0]; for (let i = 1; i < p.length; i++) y = gfMul(y, x) ^ p[i]; return y; };
  const polyAdd = (p, q) => {
    const r = new Array(Math.max(p.length, q.length)).fill(0);
    p.forEach((v, i) => { r[i + r.length - p.length] = v; });
    q.forEach((v, i) => { r[i + r.length - q.length] ^= v; });
    return r;
  };
  const polyMul = (p, q) => {
    const r = new Array(p.length + q.length - 1).fill(0);
    for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] ^= gfMul(p[i], q[j]);
    return r;
  };
  const polyScale = (p, x) => p.map((v) => gfMul(v, x));
  const polyDivRem = (a, b) => {
    const out = a.slice();
    for (let i = 0; i < a.length - (b.length - 1); i++) {
      const c = out[i];
      if (c) for (let j = 1; j < b.length; j++) if (b[j]) out[i + j] ^= gfMul(b[j], c);
    }
    return out.slice(out.length - (b.length - 1));
  };

  /** 1ブロック（データ＋EC）の誤りを直す。直せなければ null */
  const rsDecode = (msg, nsym) => {
    const synd = [0];
    let bad = false;
    for (let i = 0; i < nsym; i++) { const s = polyEval(msg, gfPow(2, i)); synd.push(s); if (s) bad = true; }
    if (!bad) return msg;
    // Berlekamp-Massey で誤り位置多項式
    let errLoc = [1], oldLoc = [1];
    for (let i = 0; i < nsym; i++) {
      const K = i + 1;
      let delta = synd[K];
      for (let j = 1; j < errLoc.length; j++) delta ^= gfMul(errLoc[errLoc.length - 1 - j], synd[K - j]);
      oldLoc = oldLoc.concat([0]);
      if (delta) {
        if (oldLoc.length > errLoc.length) {
          const nl = polyScale(oldLoc, delta);
          oldLoc = polyScale(errLoc, gfInv(delta));
          errLoc = nl;
        }
        errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
      }
    }
    while (errLoc.length && errLoc[0] === 0) errLoc.shift();
    const errs = errLoc.length - 1;
    if (errs * 2 > nsym) return null;
    // Chien 探索で位置
    const rev = errLoc.slice().reverse();
    const pos = [];
    for (let i = 0; i < msg.length; i++) if (polyEval(rev, gfPow(2, i)) === 0) pos.push(msg.length - 1 - i);
    if (pos.length !== errs) return null;
    // Forney で大きさ
    const coef = pos.map((p) => msg.length - 1 - p);
    let loc = [1];
    coef.forEach((c) => { loc = polyMul(loc, polyAdd([1], [gfPow(2, c), 0])); });
    const sr = synd.slice().reverse();
    const ev = polyDivRem(polyMul(sr, loc), [1].concat(new Array(loc.length).fill(0))).reverse();
    const X = coef.map((c) => gfPow(2, c));
    const out = msg.slice();
    for (let i = 0; i < X.length; i++) {
      const xi = X[i], xinv = gfInv(xi);
      let prime = 1;
      for (let j = 0; j < X.length; j++) if (j !== i) prime = gfMul(prime, 1 ^ gfMul(xinv, X[j]));
      if (!prime) return null;
      const y = gfMul(xi, polyEval(ev.slice().reverse(), xinv));
      out[pos[i]] ^= gfDiv(y, prime);
    }
    for (let i = 0; i < nsym; i++) if (polyEval(out, gfPow(2, i))) return null;
    return out;
  };

  // ------------------------------------------------------------------ 行列 → 文字
  const FORMAT_MASK = 0x5412;
  const formatCode = (d) => {
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return ((d << 10) | r) ^ FORMAT_MASK;
  };
  const popcount = (v) => { let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; };
  const ECL_OF = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };

  const readFormat = (g) => {
    const dim = g.length;
    const get = (x, y) => g[y][x];
    let a = 0, b = 0;
    const push = (v, bit) => (v << 1) | (bit ? 1 : 0);
    for (let i = 0; i < 6; i++) a = push(a, get(i, 8));
    a = push(a, get(7, 8)); a = push(a, get(8, 8)); a = push(a, get(8, 7));
    for (let j = 5; j >= 0; j--) a = push(a, get(8, j));
    for (let j = dim - 1; j >= dim - 7; j--) b = push(b, get(8, j));
    for (let i = dim - 8; i < dim; i++) b = push(b, get(i, 8));
    let best = null;
    for (let d = 0; d < 32; d++) {
      const c = formatCode(d);
      const e = Math.min(popcount(c ^ a), popcount(c ^ b));
      if (!best || e < best.e) best = { d, e };
    }
    if (best.e > 3) return null;
    return { ecl: ECL_OF[best.d >> 3], mask: best.d & 7 };
  };

  const decodeMatrix = (g) => {
    const t = T();
    const dim = g.length;
    const ver = (dim - 17) / 4;
    if (ver < 1 || ver > 40 || ver !== Math.floor(ver)) return null;
    const fmt = readFormat(g);
    if (!fmt) return null;
    // 機能パターン（読み飛ばすところ）は作成側と同じ関数で決める
    const fn = t.newGrid(dim);
    t.drawFunction(fn, ver);
    const maskFn = t.MASKS[fmt.mask];
    const bytes = [];
    let cur = 0, nb = 0;
    for (let right = dim - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let v = 0; v < dim; v++) {
        const y = upward ? dim - 1 - v : v;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (fn[y][x] !== -1) continue;
          let bit = g[y][x];
          if (maskFn(x, y)) bit ^= 1;
          cur = (cur << 1) | bit;
          if (++nb === 8) { bytes.push(cur); cur = 0; nb = 0; }
        }
      }
    }
    const total = t.rawCodewords(ver);
    const nBlocks = t.BLOCKS[fmt.ecl][ver], ecLen = t.ECC[fmt.ecl][ver];
    const shortLen = Math.floor(total / nBlocks) - ecLen;
    const numShort = nBlocks - (total % nBlocks);
    const blocks = [];
    for (let i = 0; i < nBlocks; i++) blocks.push({ len: shortLen + (i < numShort ? 0 : 1), d: [], e: [] });
    let k = 0;
    for (let i = 0; i < shortLen + 1; i++) for (const b of blocks) if (i < b.len) b.d.push(bytes[k++]);
    for (let i = 0; i < ecLen; i++) for (const b of blocks) b.e.push(bytes[k++]);
    const data = [];
    for (const b of blocks) {
      const fixed = rsDecode(b.d.concat(b.e), ecLen);
      if (!fixed) return null;
      data.push(...fixed.slice(0, b.len));
    }
    return parseData(data, ver);
  };

  /** データのビット列 → 文字（数字・英数字・バイト・漢字のモードに対応） */
  const parseData = (bytes, ver) => {
    let pos = 0;
    const left = () => bytes.length * 8 - pos;
    const read = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++) { v = (v << 1) | ((bytes[pos >> 3] >> (7 - (pos & 7))) & 1); pos++; }
      return v;
    };
    const AN = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    const vi = ver < 10 ? 0 : ver < 27 ? 1 : 2;
    let text = '';
    const raw = [];
    while (left() >= 4) {
      const mode = read(4);
      if (mode === 0) break;
      if (mode === 1) {
        let n = read([10, 12, 14][vi]);
        while (n >= 3) { text += String(read(10)).padStart(3, '0'); n -= 3; }
        if (n === 2) text += String(read(7)).padStart(2, '0');
        else if (n === 1) text += String(read(4));
      } else if (mode === 2) {
        let n = read([9, 11, 13][vi]);
        while (n >= 2) { const v = read(11); text += AN[Math.floor(v / 45)] + AN[v % 45]; n -= 2; }
        if (n === 1) text += AN[read(6)];
      } else if (mode === 4) {
        const n = read([8, 16, 16][vi]);
        if (left() < n * 8) return null;
        const b = new Uint8Array(n);
        for (let i = 0; i < n; i++) b[i] = read(8);
        raw.push(...b);
        try { text += new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { text += Array.from(b, (c) => String.fromCharCode(c)).join(''); }
      } else if (mode === 8) {
        const n = read([8, 10, 12][vi]);
        const b = [];
        for (let i = 0; i < n; i++) {
          const v = read(13);
          let c = ((v / 0xc0) << 8) | (v % 0xc0);
          c += c < 0x1f00 ? 0x8140 : 0xc140;
          b.push(c >> 8, c & 0xff);
        }
        try { text += new TextDecoder('shift_jis').decode(new Uint8Array(b)); } catch (e) { return null; }
      } else if (mode === 7) {
        read(8);   // ECI（文字コードの指定）。UTF-8 として読むので読み飛ばす
      } else {
        break;
      }
    }
    return text;
  };

  // ------------------------------------------------------------------ 画像 → 文字
  /** 画像（ImageData か {data,width,height}）から QR を1つ読む。読めなければ null。{ text, corners } */
  QS.decode = (img) => {
    const { width: w, height: h } = img;
    const bm = binarize(toGray(img), w, h);
    const fs = findFinders(bm, w, h);
    if (fs.length < 3) return null;
    for (const tri of pickTriplets(fs)) {
      const { tl, tr, bl, size } = tri;
      const mod = moduleAlong(bm, w, h, tl, tr, bl) || size;
      const base = Math.round((dist(tl, tr) + dist(tl, bl)) / 2 / mod) + 7;
      // 大きさの見込みが1〜2段ずれることがあるので、近い候補も試す
      const dims = [];
      for (const d0 of [base, base + 1, base - 1, base + 2, base - 2, base + 4, base - 4]) {
        const d = d0 % 4 === 1 ? d0 : null;
        if (d && d >= 21 && d <= 177 && !dims.includes(d)) dims.push(d);
      }
      for (const dim of dims) {
        const ver = (dim - 17) / 4;
        // 右下の基準点の候補：位置合わせパターン（厳しい判定 → ゆるい判定）、無ければ平行四辺形の見込み
        const est = { x: tr.x - tl.x + bl.x, y: tr.y - tl.y + bl.y };
        const bases = [];
        if (ver >= 2) {
          const between = dim - 7;
          const corr = 1 - 3 / between;
          const ex = tl.x + corr * (est.x - tl.x), ey = tl.y + corr * (est.y - tl.y);
          const ms = (dist(tl, tr) + dist(tl, bl)) / 2 / between;
          for (const need of [8, 7]) {
            const al = findAlignment(bm, w, h, ex, ey, ms, need);
            if (al && !bases.some((b) => Math.hypot(b.x - al.x, b.y - al.y) < ms)) bases.push({ x: al.x, y: al.y, mod: dim - 6.5 });
          }
        }
        bases.push({ x: est.x, y: est.y, mod: dim - 3.5 });
        for (const { x: brx, y: bry, mod: brMod } of bases) {
        // 右下は見込みの位置なので、ずれていたときに備えて少しずつ動かして読み直す（誤り訂正の検算に通ったものだけ採用）
        const step = mod * 0.6;
        const offs = [[0, 0]];
        for (const r of [1, 2]) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (Math.max(Math.abs(ox), Math.abs(oy)) === r) offs.push([ox, oy]);
        for (const [ox, oy] of offs) {
          const bx = brx + ox * step, by = bry + oy * step;
          const m = quad2quad([3.5, 3.5, dim - 3.5, 3.5, brMod, brMod, 3.5, dim - 3.5], [tl.x, tl.y, tr.x, tr.y, bx, by, bl.x, bl.y]);
          const g = sample(bm, w, h, m, dim);
          if (!g) continue;
          // Web カメラのアプリによっては映像が鏡写し（左右反転）で届く。そのときは行列が元の転置になるので、それも試す
          const tg = g.map((row, y) => row.map((_, x) => g[x][y]));
          const fa = readFormat(g), fb = readFormat(tg);
          if (!fa && !fb) continue;   // 形式情報が読めない位置は飛ばす（速さのため）
          const text = (fa && decodeMatrix(g)) ?? (fb && decodeMatrix(tg)) ?? null;
          if (text != null && text !== false) return { text, corners: [tl, tr, bl] };
        }
        }
      }
    }
    return null;
  };

  // 検証用（node のテストから段階ごとに確かめる）
  QS._i = { toGray, binarize, findFinders, pickTriplets, sample, decodeMatrix, readFormat, quad2quad, findAlignment, rsDecode };

  // ------------------------------------------------------------------ カメラ
  let detector = null;
  const nativeDetector = async () => {
    if (detector !== null) return detector;
    detector = false;
    try {
      if ('BarcodeDetector' in window) {
        const fmts = await window.BarcodeDetector.getSupportedFormats();
        if (fmts.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch (e) { detector = false; }
    return detector;
  };

  QS.supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  /** 使えるカメラの一覧（名前は一度カメラを許可したあとでないと出ない） */
  QS.cameras = async () => {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `カメラ ${i + 1}` }));
    } catch (e) { return []; }
  };

  /**
   * カメラを動かして読み続ける。onRead(text) は読めるたびに呼ぶ（同じ文字は cooldown の間は呼ばない）。
   * 戻り値の stop() で止める。video 要素は呼び出し側が用意する（playsinline・muted）
   */
  QS.start = async (video, onRead, opt = {}) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // カメラを選んであればそれを使う（PC に iPhone を Web カメラとしてつないだとき、内蔵カメラと並ぶため）。無ければ背面カメラ
      video: opt.deviceId ? { deviceId: { exact: opt.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const nat = await nativeDetector();
    const cooldown = opt.cooldown || 1500;
    let last = '', lastAt = 0, stopped = false, busy = false, timer = 0;
    const tick = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        busy = true;
        try {
          let text = null;
          if (nat) {
            const r = await nat.detect(video);
            if (r && r[0]) text = r[0].rawValue;
          }
          if (text == null) {
            // 真ん中の正方形を切り出して縮める（速さのため。タグは真ん中に写す前提）
            const vw = video.videoWidth, vh = video.videoHeight;
            const s = Math.min(vw, vh) * (opt.crop || 0.8);
            const N = opt.size || 520;
            canvas.width = N; canvas.height = N;
            ctx.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, N, N);
            const r = QS.decode(ctx.getImageData(0, 0, N, N));
            if (r) text = r.text;
          }
          const now = Date.now();
          // 同じタグは、いったん写らなくなるまで読み直さない（写したままだと「読み取り済み」が鳴り続けるため）
          if (text != null) {
            if (text === last && now - lastAt < cooldown) lastAt = now;
            else { last = text; lastAt = now; onRead(text); }
          }
        } catch (e) { /* 1コマ読めなくても続ける */ }
        busy = false;
      }
      timer = setTimeout(tick, opt.interval || 90);
    };
    tick();
    return {
      stop: () => {
        stopped = true;
        clearTimeout(timer);
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      },
      native: !!nat,
      deviceId: (stream.getVideoTracks()[0].getSettings() || {}).deviceId || '',
      label: stream.getVideoTracks()[0].label || '',
      torch: async (on) => {
        const tr = stream.getVideoTracks()[0];
        try { await tr.applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch (e) { return false; }
      },
    };
  };
})();
