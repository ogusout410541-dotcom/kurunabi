/* サークル一覧の解析・スペース表記の変換 */
(function () {
  'use strict';
  const HC = window.HC;
  const U = HC.util;
  const P = (HC.parser = {});

  /** "1-6,15-20" → Set{1..6,15..20} */
  P.rangeSet = (spec) => {
    const out = new Set();
    String(spec || '').split(',').forEach((part) => {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    });
    return out;
  };

  /**
   * 「買うもの」のまとめ入力を解析する。1行1品。
   *   新刊 1000 ／ アクスタ ¥1,500 x2 ／ 既刊セット 2000×3 ／ 無料配布
   * 金額と数量は行のどこにあってもよく、残りを品名として扱う
   */
  P.parseItemLines = (text) =>
    String(text || '')
      .split(/\r?\n/)
      .map((raw) => {
        let s = U.toHalf(raw).trim();
        if (!s) return null;
        let qty = 1, price = 0;
        // 「1000×3」のように金額と数量がくっついている形
        s = s.replace(/([\d,]{2,})\s*[x*×]\s*(\d{1,2})(?=\s|$)/i, (_, p, n) => {
          price = +String(p).replace(/,/g, '') || 0;
          qty = Math.min(99, +n || 1);
          return ' ';
        });
        // 数量：x2 / ×2 / *2 / 2個 / 2冊（品名にくっついていてもよい）
        s = s.replace(/([^\d\s]|^)\s*[x*×](\d{1,2})(?=\s|$)/i, (_, pre, n) => { qty = Math.min(99, +n || 1); return pre + ' '; });
        s = s.replace(/(\d{1,2})\s*(?:個|冊|点|部)(?=\s|$)/, (_, n) => { qty = Math.min(99, +n || 1); return ' '; });
        // 金額：¥1,000 / 1000円 / 末尾の数字
        s = s.replace(/[¥￥]\s*([\d,]+)/, (_, n) => { price = +n.replace(/,/g, '') || 0; return ' '; });
        if (!price) s = s.replace(/([\d,]{2,})\s*円/, (_, n) => { price = +n.replace(/,/g, '') || 0; return ' '; });
        if (!price) s = s.replace(/(?:^|\s)([\d,]{2,})(?=\s|$)/, (_, n) => { price = +n.replace(/,/g, '') || 0; return ' '; });
        const name = s.replace(/[¥￥]/g, ' ').replace(/[\s,、・]+/g, ' ').trim();
        if (!name && !price) return null;
        return { name: name || '（無題）', price, qty };
      })
      .filter(Boolean);

  /** 番号表記 "01-02" / "09" / "1〜2" → [1,2] */
  P.parseNums = (s) => {
    const m = U.toHalf(s).trim().match(/^(\d{1,3})(?:\s*[-–~〜,・]\s*(\d{1,3}))?$/);
    if (!m) return null;
    const a = +m[1], b = m[2] ? +m[2] : a;
    const nums = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b) && nums.length < 6; i++) nums.push(i);
    return nums;
  };

  P.spaceLabel = (block, nums) =>
    block + (nums.length > 1 ? `${U.pad2(nums[0])}-${U.pad2(nums[nums.length - 1])}` : U.pad2(nums[0]));

  /** 検索語をスペース指定として解釈（"g23" "Ｇ-２３" "g 23"） */
  P.parseSpaceQuery = (q) => {
    const m = U.toHalf(q).trim().match(/^([a-zA-Z]{1,2})\s*[-‐ー]?\s*(\d{1,3})$/);
    return m ? { block: m[1].toUpperCase(), num: +m[2] } : null;
  };

  /**
   * 数字だけの検索（「24」「23-24」）→ スペース番号の範囲。
   * ブロックをまたいで A24・N24… を拾うために使う
   */
  P.parseNumQuery = (q) => {
    const t = U.toHalf(q).trim();
    if (!/^\d{1,3}(\s*[-‐ー~〜]\s*\d{1,3})?$/.test(t)) return null;
    const ns = t.split(/[-‐ー~〜]/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
    if (!ns.length) return null;
    return { from: Math.min(...ns), to: Math.max(...ns) };
  };

  P.twitterHandle = (url) => {
    if (!url) return '';
    const s = U.toHalf(url).trim();
    const m = s.match(/(?:twitter|x)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,30})/i);
    if (m && !/^(intent|share|home|i|search)$/i.test(m[1])) return m[1];
    const h = s.match(/^@?([A-Za-z0-9_]{1,30})$/);
    return h ? h[1] : '';
  };

  /** pixiv欄 → 数字ID or URL or ''（holokle.info の壊れリンクは捨てる） */
  P.pixiv = (url) => {
    if (!url) return '';
    let s = U.toHalf(url).trim();
    try { s = decodeURIComponent(s); } catch (_) { /* noop */ }
    if (/^\d+$/.test(s)) return s;
    const m =
      s.match(/pixiv\.net\/(?:[a-z]{2}\/)?users\/(\d+)/) ||
      s.match(/member\.php\?id=(\d+)/) ||
      s.match(/pixiv\.net\/#id=(\d+)/) ||
      s.match(/holokle\.info\/(\d+)\/?$/);
    if (m) return m[1];
    if (/holokle\.info/.test(s)) return '';
    return /^https?:\/\//.test(s) ? s : '';
  };

  P.web = (url) => {
    if (!url) return '';
    const s = U.toHalf(url).trim();
    if (/holokle\.info/.test(s) || !/^https?:\/\//.test(s)) return '';
    return s;
  };

  P.pixivUrl = (px) => (!px ? '' : /^\d+$/.test(px) ? `https://www.pixiv.net/users/${px}` : px);
  P.twitterUrl = (tw) => (tw ? `https://x.com/${tw}` : '');

  const mk = (block, nums, name, tw = '', px = '', web = '') => ({
    id: block + U.pad2(nums[0]),
    block,
    nums,
    space: P.spaceLabel(block, nums),
    name: String(name || '').trim(),
    tw,
    px,
    web,
  });

  /** 同梱データの1行1サークル形式 "A01-02|名前|tw|px|web" */
  P.parseCompact = (text) => {
    const out = [];
    String(text || '').split('\n').forEach((line) => {
      if (!line.trim() || line.startsWith('#')) return;
      const [sp, name, tw, px, web] = line.split('|');
      const m = U.toHalf(sp).trim().match(/^([A-Za-z]{1,2})\s*-?\s*(\d.*)$/);
      if (!m) return;
      const nums = P.parseNums(m[2]);
      if (!nums) return;
      out.push(mk(m[1].toUpperCase(), nums, name, (tw || '').trim(), (px || '').trim(), (web || '').trim()));
    });
    return out;
  };

  P.toCompact = (circles) =>
    circles.map((c) => [c.space, c.name.replace(/\|/g, '｜'), c.tw, c.px, c.web].join('|')).join('\n');

  /**
   * 公式サイト(holokle.info)のサークル一覧をコピペしたテキストを解析する。
   *   * A
   *   01-02
   *   サークル名
   *   [Twitter](url)[Pixiv](url)[Web](url)
   * のほか、1行1サークル形式（"A01-02 サークル名 @id" / タブ・カンマ・| 区切り）にも対応。
   */
  P.parseCircleList = (text) => {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
    const out = [];
    let cur = null;
    const flush = () => {
      if (cur && cur.nums && cur.name) out.push(mk(cur.block, cur.nums, cur.name, cur.tw, cur.px, cur.web));
      cur = null;
    };
    const takeLinks = (l) => {
      const re = /\[(Twitter|X|Pixiv|Web)\]\(([^)]*)\)/gi;
      let m, hit = false;
      while ((m = re.exec(l))) {
        hit = true;
        const kind = m[1].toLowerCase();
        if (kind === 'twitter' || kind === 'x') cur.tw = P.twitterHandle(m[2]);
        else if (kind === 'pixiv') cur.px = P.pixiv(m[2]);
        else cur.web = P.web(m[2]);
      }
      return hit;
    };

    for (const raw of lines) {
      if (!raw) continue;
      const l = U.toHalf(raw);
      let m;
      // "* A" → 新しいサークルの開始
      if ((m = l.match(/^[*•・\-]\s*([A-Za-z]{1,2})$/))) {
        flush();
        cur = { block: m[1].toUpperCase(), stage: 'num', tw: '', px: '', web: '' };
        continue;
      }
      if (cur) {
        if (cur.stage === 'num') {
          const nums = P.parseNums(l);
          if (nums) { cur.nums = nums; cur.stage = 'name'; continue; }
          // "* A01-02" 形式
        }
        if (cur.stage === 'name') { cur.name = raw; cur.stage = 'links'; continue; }
        if (cur.stage === 'links') {
          if (takeLinks(l) || /^(twitter|pixiv|web|x)$/i.test(l)) continue;
          if (/^[A-Za-z]$/.test(l)) continue; // ブロック見出し
        }
      }
      // 1行1サークル形式
      if ((m = l.match(/^[*•・]?\s*([A-Za-z]{1,2})\s*-?\s*(\d{1,3}(?:\s*[-–~〜]\s*\d{1,3})?)[\s\t,|]+(.+)$/))) {
        flush();
        const nums = P.parseNums(m[2]);
        if (!nums) continue;
        let rest = m[3].split(/\t|\||,(?=\s*@)/).map((x) => x.trim()).filter(Boolean);
        let tw = '';
        const twIdx = rest.findIndex((x) => /^@[A-Za-z0-9_]+$/.test(x) || /(twitter|x)\.com\//.test(x));
        if (twIdx >= 0) { tw = P.twitterHandle(rest[twIdx]); rest.splice(twIdx, 1); }
        let name = rest[0] || '';
        const at = name.match(/^(.*?)\s+@([A-Za-z0-9_]{1,30})$/);
        if (at) { name = at[1]; tw = tw || at[2]; }
        if (name) out.push(mk(m[1].toUpperCase(), nums, name, tw, '', ''));
        continue;
      }
      if (/^[A-Za-z]$/.test(l)) continue; // ブロック見出し
    }
    flush();

    // スペース重複は後勝ち
    const map = new Map();
    out.forEach((c) => map.set(c.id, c));
    return P.sortCircles(Array.from(map.values()));
  };

  P.sortCircles = (arr) =>
    arr.sort((a, b) => (a.block === b.block ? a.nums[0] - b.nums[0] : a.block.length - b.block.length || (a.block < b.block ? -1 : 1)));

  /** 解析結果の要約 "482件（A:26 B:18 …）" */
  P.summary = (circles) => {
    const by = {};
    circles.forEach((c) => (by[c.block] = (by[c.block] || 0) + 1));
    return { count: circles.length, blocks: by };
  };
})();
