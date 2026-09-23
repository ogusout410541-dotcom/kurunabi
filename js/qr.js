/* QR コード生成（外部ライブラリ不使用・バイトモード）
   共有リンクをスマホのカメラで読み取るためだけの最小実装。
   規格どおり バージョン1〜40 / 誤り訂正 L・M・Q・H に対応する。 */
(function () {
  'use strict';
  const HC = (window.HC = window.HC || {});
  const Q = (HC.qr = {});

  // 誤り訂正レベルごとの「1ブロックあたりのECコード語数」「ブロック数」（index = バージョン）
  const ECC = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  };
  const BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  };
  const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /** 位置合わせパターンの中心座標 */
  const alignPositions = (ver) => {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  };

  /** 機能パターンを除いた総モジュール数 ÷ 8 ＝ 使えるコード語数 */
  const rawCodewords = (ver) => {
    let m = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      m -= (25 * n - 10) * n - 55;
      if (ver >= 7) m -= 36;
    }
    return Math.floor(m / 8);
  };

  const dataCapacity = (ver, ecl) => rawCodewords(ver) - ECC[ecl][ver] * BLOCKS[ecl][ver];

  // ---- GF(256) 演算（原始多項式 0x11D）
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  /** 生成多項式 */
  const genPoly = (deg) => {
    let g = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= gmul(g[j], EXP[i]);
        next[j + 1] ^= g[j];
      }
      g = next;
    }
    return g;
  };

  /** Reed-Solomon 誤り訂正コード語（g は降べきの順にして先頭の 1 を除いて使う） */
  const ecBytes = (data, deg) => {
    const g = genPoly(deg).reverse();
    const res = new Uint8Array(deg);
    for (const b of data) {
      const factor = b ^ res[0];
      res.copyWithin(0, 1);
      res[deg - 1] = 0;
      for (let i = 0; i < deg; i++) res[i] ^= gmul(g[i + 1], factor);
    }
    return res;
  };

  // ---- ビット列
  const bits = () => {
    const a = [];
    a.put = (val, len) => { for (let i = len - 1; i >= 0; i--) a.push((val >>> i) & 1); };
    return a;
  };

  /** 文字列 → UTF-8 バイト */
  const utf8 = (s) => new TextEncoder().encode(s);

  /** データコード語（パディング込み） */
  const dataCodewords = (bytes, ver, ecl) => {
    const cap = dataCapacity(ver, ecl) * 8;
    const bb = bits();
    bb.put(4, 4); // バイトモード
    bb.put(bytes.length, ver < 10 ? 8 : 16);
    for (const b of bytes) bb.put(b, 8);
    bb.put(0, Math.min(4, cap - bb.length)); // 終端
    bb.put(0, (8 - (bb.length % 8)) % 8);
    const out = new Uint8Array(cap / 8);
    for (let i = 0; i < bb.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bb[i + j];
      out[i / 8] = v;
    }
    for (let i = bb.length / 8, pad = 0xec; i < out.length; i++, pad ^= 0xec ^ 0x11) out[i] = pad;
    return out;
  };

  /** ブロック分割＋EC付加＋インターリーブ */
  const interleave = (data, ver, ecl) => {
    const nb = BLOCKS[ecl][ver], ecLen = ECC[ecl][ver];
    const total = rawCodewords(ver);
    const shortLen = Math.floor(total / nb) - ecLen;
    const numShort = nb - (total % nb);
    const dBlocks = [], eBlocks = [];
    for (let i = 0, off = 0; i < nb; i++) {
      const len = shortLen + (i < numShort ? 0 : 1);
      const d = data.subarray(off, off + len);
      off += len;
      dBlocks.push(d);
      eBlocks.push(ecBytes(d, ecLen));
    }
    const out = new Uint8Array(total);
    let k = 0;
    for (let i = 0; i < shortLen + 1; i++) for (let b = 0; b < nb; b++) if (i < dBlocks[b].length) out[k++] = dBlocks[b][i];
    for (let i = 0; i < ecLen; i++) for (let b = 0; b < nb; b++) out[k++] = eBlocks[b][i];
    return out;
  };

  // ---- 描画
  const newGrid = (size) => Array.from({ length: size }, () => new Int8Array(size).fill(-1)); // -1=未使用

  const drawFunction = (g, ver) => {
    const size = g.length;
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < size && y < size) g[y][x] = v; };
    // 位置検出パターン＋分離帯
    [[0, 0], [size - 7, 0], [0, size - 7]].forEach(([ox, oy]) => {
      for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
        const m = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(ox + dx, oy + dy, m === 2 || m > 3 ? 0 : 1);
      }
    });
    // タイミングパターン
    for (let i = 8; i < size - 8; i++) { g[6][i] = i % 2 === 0 ? 1 : 0; g[i][6] = i % 2 === 0 ? 1 : 0; }
    // 位置合わせパターン
    const ap = alignPositions(ver);
    ap.forEach((cy) => ap.forEach((cx) => {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1);
      }
    }));
    // 形式情報の領域を予約（後で上書き）＋常に黒のモジュール
    for (let i = 0; i < 9; i++) { if (g[8][i] === -1) g[8][i] = 0; if (g[i][8] === -1) g[i][8] = 0; }
    for (let i = 0; i < 8; i++) { g[8][size - 1 - i] = 0; g[size - 1 - i][8] = 0; }
    g[size - 8][8] = 1;
    // 型番情報（7以上）
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const v = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const b = (v >>> i) & 1, a = size - 11 + (i % 3), bq = Math.floor(i / 3);
        g[a][bq] = b;
        g[bq][a] = b;
      }
    }
  };

  const drawFormat = (g, ecl, mask) => {
    const size = g.length;
    let rem = (ECL_BITS[ecl] << 3) | mask;
    let d = rem;
    for (let i = 0; i < 10; i++) d = (d << 1) ^ ((d >>> 9) * 0x537);
    const v = (((ECL_BITS[ecl] << 3) | mask) << 10 | d) ^ 0x5412;
    // 左上（縦 → 横の順に1コピー目）
    for (let i = 0; i <= 5; i++) g[i][8] = (v >>> i) & 1;
    g[7][8] = (v >>> 6) & 1;
    g[8][8] = (v >>> 7) & 1;
    g[8][7] = (v >>> 8) & 1;
    for (let i = 9; i < 15; i++) g[8][14 - i] = (v >>> i) & 1;
    // 右上・左下（2コピー目）
    for (let i = 0; i < 8; i++) g[8][size - 1 - i] = (v >>> i) & 1;
    for (let i = 8; i < 15; i++) g[size - 15 + i][8] = (v >>> i) & 1;
    g[size - 8][8] = 1;
  };

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  /** データをジグザグに配置（マスク適用込み） */
  const drawData = (g, codewords, mask) => {
    const size = g.length;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // 縦のタイミングパターンを飛ばす
      for (let v = 0; v < size; v++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - v : v;
          if (g[y][x] !== -1) continue;
          let bit = i < codewords.length * 8 ? (codewords[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
          i++;
          if (MASKS[mask](x, y)) bit ^= 1;
          g[y][x] = bit;
        }
      }
    }
  };

  // 位置検出パターンと紛らわしい並び（規則3）
  const FINDER = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const FINDER_R = FINDER.slice().reverse();

  /** マスクの評価（点数が低いほど良い） */
  const penalty = (g) => {
    const size = g.length;
    let p = 0, dark = 0;
    // 規則1（同色5連以上）と規則3（1011101+空白4）を行・列それぞれで見る
    const scan = (at) => {
      for (let a = 0; a < size; a++) {
        let last = -1, len = 0;
        for (let b = 0; b < size; b++) {
          const v = at(a, b);
          if (v === last) len++; else { last = v; len = 1; }
          if (len === 5) p += 3; else if (len > 5) p += 1;
          if (b >= 10) {
            let f = true, r = true;
            for (let k = 0; k < 11; k++) {
              const m = at(a, b - 10 + k);
              if (m !== FINDER[k]) f = false;
              if (m !== FINDER_R[k]) r = false;
            }
            if (f) p += 40;
            if (r) p += 40;
          }
        }
      }
    };
    scan((y, x) => g[y][x]);
    scan((x, y) => g[y][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const v = g[y][x];
      if (v === g[y][x + 1] && v === g[y + 1][x] && v === g[y + 1][x + 1]) p += 3;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (g[y][x]) dark++;
    const ratio = (dark * 100) / (size * size);
    p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return p;
  };

  /**
   * QR を生成
   * @param {string} text
   * @param {{ecl?: 'L'|'M'|'Q'|'H', minVersion?: number, mask?: number}} opt
   * @returns {{size:number, version:number, ecl:string, mask:number, get:(x,y)=>0|1, modules:number[][]}}
   */
  Q.encode = (text, opt = {}) => {
    const ecl = opt.ecl || 'L';
    const bytes = utf8(text);
    let ver = 0;
    for (let v = Math.max(1, opt.minVersion || 1); v <= 40; v++) {
      const need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCapacity(v, ecl) * 8) { ver = v; break; }
    }
    if (!ver) return null; // 入りきらない
    const cw = interleave(dataCodewords(bytes, ver, ecl), ver, ecl);
    const size = ver * 4 + 17;
    let best = null;
    const masks = opt.mask != null ? [opt.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
    for (const m of masks) {
      const g = newGrid(size);
      drawFunction(g, ver);
      drawData(g, cw, m);
      drawFormat(g, ecl, m);
      const p = penalty(g);
      if (!best || p < best.p) best = { g, p, mask: m };
    }
    const modules = best.g.map((row) => Array.from(row, (v) => (v === 1 ? 1 : 0)));
    return { size, version: ver, ecl, mask: best.mask, modules, get: (x, y) => modules[y][x] };
  };

  /** 文字数が入りきるか（true/false）。ざっくり確認用 */
  Q.fits = (text, ecl = 'L') => utf8(text).length * 8 + 20 <= dataCapacity(40, ecl) * 8;

  /**
   * SVG 文字列を返す（quiet zone 4モジュール込み）
   * @param {string} text
   * @param {{ecl?:string, px?:number, dark?:string, light?:string}} opt
   */
  Q.svg = (text, opt = {}) => {
    const qr = Q.encode(text, opt);
    if (!qr) return null;
    const qz = opt.quiet ?? 4;
    const n = qr.size + qz * 2;
    const dark = opt.dark || '#000';
    const light = opt.light || '#fff';
    let path = '';
    for (let y = 0; y < qr.size; y++) {
      let x = 0;
      while (x < qr.size) {
        if (!qr.modules[y][x]) { x++; continue; }
        let w = 1;
        while (x + w < qr.size && qr.modules[y][x + w]) w++;
        path += `M${x + qz} ${y + qz}h${w}v1h-${w}z`;
        x += w;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" width="${opt.px || 260}" height="${opt.px || 260}" role="img" aria-label="QRコード">` +
      `<rect width="${n}" height="${n}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
  };
})();
