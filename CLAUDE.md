# クルナビ — 開発メモ（Claude Code 引き継ぎ用）

ホロクル（ホロライブオンリー即売会）用の個人向け「購入計画＋当日ナビ＋予算管理」PWA。
**計画は PC、当日はスマホ（片手・電波弱い・急いでいる）** が前提。ユーザーは1人（本人のみ）で、サーバーもアカウントもない。

## 技術方針（変えるときは要相談）

- **ビルド無し・依存ゼロの素の JS**。`<script>` を順に読み込み、全モジュールは `window.HC` 名前空間にぶら下げる（ES Modules は `file://` で動かないため不採用）
- `index.html` をダブルクリックでも動くこと（`file://`）。スマホは GitHub Pages 等の https で配信し、`sw.js` でオフライン化
- データは `localStorage`（キー `kurunavi.v1`）。読み込み直前の状態を `kurunavi.backup` に1世代保存
- UI 文言は日本語。コメントも日本語で、今のコード程度の密度

## ファイル構成

```
index.html            シェル（ヘッダー・タブ・各画面の <section>）。script の読み込み順＝依存順
css/app.css           全スタイル。CSS変数でライト/ダーク。≥960px で PC レイアウト
js/util.js            HC.util   : esc/yen/norm(検索正規化)/pack・unpack(共有リンク圧縮)/icon/イベントバス
js/parser.js          HC.parser : サークル一覧の貼り付け解析、スペース表記、X/pixiv リンク正規化
js/layout.js          HC.layout : 配置図 spec → セル座標、通路距離、ルート最適化（最近傍＋2-opt）
js/qr.js              HC.qr     : QRコード生成（外部ライブラリ不使用・バイトモード・v1〜40）
js/shots.js           HC.shots  : お品書き画像＋配置図画像の保管（IndexedDB。localStorage とは別系統）
js/sync.js            HC.sync   : PCとスマホの同期（GASに置いたJSONを読み書き。オフライン優先）
js/editor.js          HC.editor : 配置図エディタ（画像の上に島・壁・入口・通路を置いて spec を作る）
data/holocle12.js     同梱イベント（サークル500件＋12thの配置図レイアウト＋タイムテーブル）
data/holocle12-map.webp  公式配置図（公式PDFから書き出し。4046x1800、座標系は 2000x890）
hall_holo12_配置図.pdf   公式配置図の原本（ベクター。座標の出どころ。アプリからは読まない）
js/store.js           HC.store  : 状態・永続化・集計・undo・入出力。データ変更はここ経由のみ
js/ui.js              HC.ui     : シート（スマホ=ボトムシート / PC=右パネル）、トースト、テンキー、確認
js/map.js             HC.map    : SVG 配置図（色分け・番号・ルート線・ピンチ/パン・縦持ちで90°回転）
js/views.js           HC.views  : 各画面の HTML 生成（go/list/map/log/circles/more ＋ サークル詳細シート ＋ 当日モードの画面 V.day/V.dayMenu）
js/app.js             HC.app / HC.actions : 起動、画面切替、data-act のハンドラ、入力(change)処理、ドラッグ並べ替え
sw.js                 オフラインキャッシュ（リリース時は CACHE のバージョンを上げる）
                      画面から 'status' / 'refresh' を postMessage で問い合わせできる（設定のオフライン欄）
tools/serve.ps1       ローカル確認用サーバー (http://localhost:7827/)
tools/cacheserve.js   更新の確認用サーバー（GitHub Pages と同じ max-age=600 を返す。/__ver?v=X で版を切り替え）
tools/gas/コード.gs    同期用の Google Apps Script（貼り付けてウェブアプリとしてデプロイする。手順は先頭のコメント）
```

## データモデル（`HC.store.state`）

```js
{
  v: 1,
  eventId: 'holocle12',                // 現在のイベント
  customEvents: { [id]: { id, name, short, date, circles: '<compact>', layoutFrom: 'holocle12'|'' } },
  data: { [eventId]: EventData },      // イベントごとの利用者データ
  favorites: { 'tw:<id小文字>' | 'nm:<正規化名>': { name, tw, t } },   // イベントをまたいで有効
  layouts: { [eventId]: layoutSpec },  // 配置図エディタで作ったもの（同梱の配置図より優先）
  settings: { theme, font, haptics, wakeLock, mapMode:'simple'|'image', mapOrient, routeMode:'must'|'tier'|'short', wallFirst(壁を先に回る), showRoute, defaultPay:'cash'|'card', dayMode(当日モード) },
  demo: null | { eventId, snap, offset, day, syncDirty, t },   // デモ中の控え（下の「当日モード・デモモード」）
}
EventData = { budget, cash（財布の現金。cashBreak があるとその合計で上書きされる）, cashBreak: {[金種]: 枚数}, reserve,
              order: [cid], entries: {[cid]: Entry}, extras: [Extra],
              addCircles: [Circle], start: 'door-r'|sid, focus: cid|null, date, updated,
              openAt: 'HH:MM'（自分の入場時刻）, endAt: 'HH:MM'（終了）, startedAt: ms（「いま開始」の時刻）,
              cashSettled: 現金の支出のうち金種に反映済みの額, cashStart: 買い物前の金種（リセットで戻す）, routedAt: 最後にルートを作った時刻}
// 同梱イベント側の openAt/endAt/schedule が既定値。EventData の値が空ならそちらを使う（S.times()）
Entry = { cid, pri: 1必須|2優先|3通常|4余裕, items: [Item], memo, menu(お品書きURL),
          status: 'todo'|'later'|'done'|'soldout'|'skip', doneAt, snap: {name, tw, space}, addedAt,
          cashPaid: いくら財布（金種）から引いたか。二重に引かないための控え（共有リンクには乗せない） }
Item  = { id, name, price(予定単価, 0=未定), qty, status: 'todo'|'bought'|'soldout'|'skip',
          paid(実際の支払総額 or null=予定通り), pay: 'cash'|'card', planned(false=当日の追加購入), t }
Extra = { id, name, cost, qty, pay, t }     // サークル外の支出（企業ブース・飲食など）
Circle = { id:'A01', block:'A', nums:[1,2], space:'A01-02', name, tw, px(pixiv数字ID or URL), web }
```

- サークル ID は「ブロック＋先頭番号2桁」（`A01-02` → `A01`）。イベントが変わると別物なので、イベント横断の照合は `snap`/`favorites` のキー（X ID か正規化名）で行う（`S.keysOf`, `S.historyOf`）
- 金額: 使用額 = bought の `paid ?? price*qty` ＋ extras。残り予定 = 未完了エントリの todo アイテム。`S.stats()` に集約
- **お品書き画像だけは `HC.store` の外**（IndexedDB `kurunavi` / `shotMeta`＋`shotBlob`）。undo の対象外で、共有リンクにもJSON書き出しにも入らない。
  `shotMeta = {id, ev, cid, thumb(dataURL・最大180px), w, h, size, t, remote(別の端末から受け取った), sent(この端末から送信済み)}`／`shotBlob = {id, blob}`。保存時に長辺1600pxのJPEGへ縮小する。
  起動時に `HC.shots.load()` がメタだけメモリに読み込むので、`HC.shots.list(ev, cid)` は同期で呼べる（描画から直接使ってよい）。
  IndexedDB が使えない環境では `HC.shots.ready === false` になるので、**画像まわりのUIは必ず `ready` で出し分ける**

## 実装ルール

- **絵文字は使わない**。画面に出す記号は `U.icon(name)` の SVG ピクトグラムで表す（線は 24x24・stroke 2。塗りで描くものは `FILLED` に登録）

- **データ変更は必ず `HC.store.mutate(label, fn)`**。`label` を渡すと undo 対象（トーストの「元に戻す」/Ctrl+Z）。テキスト入力のような細かい変更は `label=null`
- mutate は `change` を emit → `app.refresh()` が表示中の画面だけ再描画し、他は dirty 扱い（表示時に描画）
- クリックは全部 **`data-act="名前"` ＋ `data-*`** → `HC.actions[名前](dataset)`。入力欄は **`data-f`** → `app.js` の `onFieldChange`
- サークル詳細シート内の入力から来た変更では DOM を作り直さない（`app.quiet`）。作り直すとスマホでタップが消えるため
- シートは `HC.ui.sheet({id, side, center, ...})`。`side:true` は PC で右パネル（背後を操作可）。Android の戻るボタンで閉じる履歴処理あり
- 画面テキストの `innerHTML` は必ず `U.esc()` を通す
- **お品書き待ち**（`S.isPending(e)`）＝買うものが1件も入っていないエントリ。entry の `noItems: true` で「入れないと決めた」印にすると対象から外れる。
  リストの上部カード・行の印・絞り込み「待ち」・試算表の注記で目立たせている（お品書きが後から出るサークル向け）
- **お品書き画像が未登録**（`S.noShotCids()`）＝まだ回っていないのに画像が1枚も無いサークル。entry の `noShot: true`（詳細の「登録しない」）で対象から外れる。
  リスト上部の青いカード（`V.noShot`、お品書き待ちのオレンジと見分ける）・絞り込み「画像なし」・行の印（`V.shotMark`：画像があれば枚数）・
  サークル詳細の注記・準備欄の「お品書き画像の登録」で出す。画像まわりなので `HC.shots.ready` が false の端末では全部出さない。
  画面の言葉は「買うもの」「画像」とも「登録」で揃えている
- **現金の金種**（`EventData.cashBreak`）：設定の予算カードと当日タブの「金種」ボタン（`A.wallet`）から枚数を入れる。
  `S.payPlan(金額)` が手持ちの枚数の範囲で「ちょうど出せる出し方（枚数が最小）」と「小銭を減らす出し方」を返し、
  テンキーの `opt.hint` に出す（現金のときだけ）。OKで「財布の中身から引く」が入っていれば `S.applyPay` が
  出した分を引き、**おつりを金種に戻して**足す。計算は金種ごとの個数制限つきDP（`planFor`）で、手持ちを超える案は出ない。
  枚数を入れている間は `cash`（財布の現金）は自動計算になる（入力欄は readonly）。
  テンキーを通さず「チェックだけ」で終えたときは、完了のトーストに「財布から ¥N 引く」が出る（`S.cashUnpaid(cid)`＝
  現金で買った額 − すでに引いた額。押すと `S.applyPay(plan, cid)` が `entry.cashPaid` に控えるので二重には引かれない）。
  **財布の現金の表示**（`stats().cashLeft`）は、金種があれば「金種の合計 −（現金の支出 − `cashSettled`）」。`applyPay` で引いた額と、
  金種を手で入れ直したとき（`markCounted`＝数え直した中身が正）に `cashSettled` が進むので、二重には引かれない（1.1.2 までは二重に引いていた）。
  まだ何も買っていないときの金種は `cashStart` に控え、「当日の記録だけリセット」で戻す（リハーサルで引いた分も戻る）。
  金種の欄は打つ・押すたびに画面を作り直さず `app.paintDenoms()` で数字だけ差し替える（作り直すと次のタップが空振りするため）
- 指で押す前提のため、**操作系は最低でも36〜40px**の当たり判定にする（`.chip` 38 / `.seg.sm button` 36 / `.icon-btn.sm` 38 / `.link-btn` 38）。
  トーストは `pointer-events: none`（中のボタンだけ `auto`）にして、下のボタンを塞がないようにしてある
- 品目入力は**入力回数を減らす**方向で作る：`S.priceHint(品名)` が過去に入れた金額の多数決を返し、プリセットのチップに出す／追加時に自動で入れる。
  同じ品名をもう一度押したら行を増やさず数量+1（トーストから「別の行にする」で戻せる）。
  指の端末（`matchMedia('(pointer: coarse)')`）では価格欄をタップするとアプリのテンキー、マウスならそのままキーボード入力
- **無料配布**：価格0で品名に「無料」などを含む品物は `S.isFree`＝未定ではない。価格未定の判定は必ず `S.isUnknown` を使う
  （`!i.price` で判定すると無料配布がテンキー必須になり、0円ではOKが押せず詰まる）。記録用のテンキーは0円も通す
- **売切を戻す**：サークルごと売切にすると品物に `byEntry` の印が付き、未購入／あとでに戻すとその品物も未購入に戻る
- **連打の保険**：完了して次のカードに切り替わった直後の 0.7 秒は、当日カードのボタンを押しても反応しない（`app.curGuard` と `.cur.enter`）
- **当日までの準備**（`V.prep`）：開催前（と、まだ1件も回っていない間）の当日タブに、開催日・予算・お品書き待ち・価格未定・ルート・
  財布・オフライン保存・同期・新しい版の抜けを出す。始まってからは抜けがあるときだけ、たたんで出す。開け閉めは `V.prepOpen` に覚える。
  ルートは `routedAt`（自動ルート・ドラッグ並べ替え・スペース順で更新）より後に追加したサークルがあると「作り直し」を促す
- 当日タブの時計は1秒ごとに `V.tickClock()` が**文字だけ**差し替える（画面ごと作り直さない）。`app.clockTick()` が表示中タブと可視状態を見てタイマーを止め／動かしする
- `S.clock()` は**開催日（`S.eventDate()`）を基準に**時刻を組む。日付が入っていれば別の日に開いても「終了」にならず、
  `state: 'before' | 'live' | 'after' | 'none'` と `days`（開催前の残り日数）を返す。日付が無いときだけ「今日の HH:MM」として扱う
- オフラインは `navigator.onLine` ＋ `online/offline` イベントで `body.offline` を付け外し（`app.paintNet()`）。
  圏外では外部リンク（`a[target="_blank"]`）をクリックしても開かずトーストで知らせる

## 配置図レイアウト仕様（`data/*.js` の `layout`）

座標系は**公式配置図画像のピクセル座標**。こうしておくと「公式図の上に色を重ねる」表示がそのまま合う。

```js
layout: {
  image: { src, w, h },              // 公式配置図（任意）
  view: [x, y, w, h],                // 初期表示範囲
  hall: [x, y, w, h],                // シンプル表示の会場枠
  cell: { w: 22, h: 13 },            // 島の1スペースの大きさ
  rows: [y0 .. y19],                 // 島の行ごとのY（柱・通路のすき間込み）
  crossY: [...],                     // 横に通り抜けられる通路のY（距離計算とルート線に使用）
  blocks: [
    // 公式PDFから1席ずつ座標を取り込んだ形（12th はこれ）。E/W/N/S = 通路がある向き、中身は [番号, x, y]
    { type: 'cells', block: 'G', w: 22.2, h: 12.8, letterAt: [[x, y]], E: [[1, x, y], ...], W: [...] },
    { type: 'island', block: 'G', x: 島の中心X, right: '1-20', left: '21-40', yOf: {番号: y} },
    //   右列は上→下に right、左列は下→上に left（コミケ式U字）。欠けは範囲指定、不規則は yOf で上書き
    { type: 'column', block: 'B', x, ys: [..], face: 'W', nums: '1-20' },   // 1列だけの机
    { type: 'wall',   block: 'A', y, w, h, face: 'N', cells: [[x, 番号], ...] }, // 壁サークル
  ],
  labels: [{ text, x, y, size, kind: 'facility'|'dim' }],
  starts: [{ id, label, x, y }],     // ルートの出発点候補（入口）
}
```

**12th の配置図は公式PDF（`hall_holo12_配置図.pdf`）から機械的に作ってある。** PyMuPDF でページの文字を拾うと、
席番号がベクター文字として1席ずつ取れる（島は横書き2桁、壁は縦書きで1桁ずつなので上下2スパンを結合する）。
600席すべての x/y と、島の並び・通路・壁の開口部（入口）はこの実測値。画像も同じPDFを 1.5倍で書き出したもので、
`2000/2697` を掛けると座標系がそのまま重なる。作り直すときは同じ手順で。

新しい配置図を作る手順（13th 以降）：
1. 公式配置図を `data/holocleNN-map.webp` に置く（画像サイズを確認）
2. 各島の中心X・行Yを画像から読み取り（12th の数値が同じ会場なら流用可）、`blocks` を書く
3. `node` で「全サークルにセルがあるか」を確認（下のテスト参照）→ ブラウザで公式図モードにして重なりを目視確認
4. `data/holocleNN.js` を作り `index.html` と `sw.js` の ASSETS に追加
   - 配置図が無い場合は、アプリ内「新しいイベントを作る」で 12th の配置を流用するか簡易マップ（自動生成）を選べる

## サークル一覧の取り込み

`HC.parser.parseCircleList(text)` は公式サイト(holokle.info)の一覧をそのままコピペした形式
（`* A` / `01-02` / 名前 / `[Twitter](..)[Pixiv](..)[Web](..)`）と、1行1サークル形式（`G23 名前 @id`、タブ/`|`区切り）に対応。
holokle.info 経由の壊れた pixiv/Web リンクは捨て、数字IDだけ拾う。同梱データは `スペース|名前|X|pixiv|web` のコンパクト形式。

## サークル検索の決まり（`V.circles.matches`）

入力の形で探し方を切り替える。**数字だけのときは必ずスペース番号**として扱う
（X の ID に数字が入っていて、`24` で検索すると `@jdisj24dle5` のようなものが邪魔をするため）。

| 入力 | 探すもの |
|---|---|
| `24` / `23-24` | スペース番号。ブロックを横断して A24・N24… を出す（`P.parseNumQuery`） |
| `G23` / `g 23` | そのブロックの番号（`P.parseSpaceQuery`） |
| `@id` | X の ID だけ（`@` を書いたときのみ） |
| その他の文字 | サークル名 → スペース表記 → メモ・品名 → 最後の保険として X の ID |

## ルート計算

`Lay.dist`：同じ通路（x差<45）なら直線、違えば `crossY` のどれかを経由するマンハッタン距離。
`Lay.route`：始点固定の最近傍法＋2-opt。`S.optimize(mode, fromCurrent)` が未完了分だけ並べ替え（完了分は先頭に固定）。
mode: `must`=必須を先に回り切ってから残り / `tier`=優先度ごと / `short`=全部まとめて最短。

- `settings.wallFirst`（既定 ON）：壁サークル（`S.isWall`＝配置図の `type:'wall'` に席がある）を先頭グループにまとめる。
  壁は列が長くなりやすいので、必須の壁 → 残りの壁 → ふつうの島、の順で回る
- **区間ナビ**：`V.map.inst.legs()` が「入口→A、A→B…」の区間一覧を返し、`showLeg(i)` でその区間だけ太く描いて拡大する
  （ほかの線は薄く残す）。`clearLeg()` で全体表示に戻る。画面側は `V.mapSeg()` の `◀ 1/7 ▶ 全体` バー
- **ルート線の太さ**は `vector-effect: non-scaling-stroke` で画面上の px に固定し、下に縁取り（`.route-casing`）を敷く。
  座標系の太さのままだと、スマホ縦持ちの全体表示で約1.3pxまで細くなり「線が出ない」と見えていた（1.3.0）。
  非表示にしているときは地図の下に「ルート線は非表示です。押すと表示します」を出す（ボタンを押した自覚がないまま消えていることがあるため）

## 当日モード・デモモード（1.3.0）

- **当日モード**（`settings.dayMode`。端末ごと＝同期しない）：`body.day` で文字を 1.12 倍（`applyLook` が `--fs` に掛ける）、
  薄い灰色の文字と罫線を濃くする。タブは「いま・マップ・記録・メニュー」だけ（リスト・サークルはメニューの奥）。
  - 「いま」＝`V.day.render`：上の帯（`V.dayStrip`：時計・残り時間・予算の残り・財布・残り件数）＋ `V.dayCard`（大きなスペース番号、
    お品書き画像を大きく表示＝まずサムネで描いて `hydrateShots` が本体の Blob URL に差し替える、品物、メモ）。
    完了・売切・あとで・見送りは `.day-actions` で**画面下に固定**（親指の届くところ）。`.card.cur` の中にあるので連打の保険もそのまま効く
  - 「記録」＝`V.log`（使った金額・予算・財布・購入の記録を新しい順）、「メニュー」＝`V.dayMenu`（当日に使う操作のタイル。「すべての設定」で通常の設定へ）
  - 当日モードで地図を開くと、いま向かう区間だけを出す（`autoLeg`。次の目的地が変わるたびに1回。「全体」を押したらその目的地の間は戻さない）
  - 開催日にアプリを開くと切り替えを聞く（`dayPrompt`。1日1回、`localStorage['kurunavi.dayAsk']`）。画面を消さない設定はどの画面でも効く
- **デモモード**（`state.demo = { eventId, snap, offset, day, syncDirty, t }`）：自宅で本番どおりに練習する。
  `S.startDemo()` がいまのイベントのデータを JSON で控え、記録をまっさらにし（`resetRecords`）、時計を開催日の開始時刻に合わせる。
  **時刻は `S.now()`**（デモ中は `offset` だけずれる）。購入・完了の時刻や `S.clock()` はこれを使う。`S.endDemo()` で控えを書き戻す
  （終了後のデータは開始前とバイト単位で一致することを確認済み）。デモ中は：同期の送受信を止める（`sync.js` が `skipped:'demo'`）、
  共有リンク・書き出し・読み込みを断る（`demoBlock`）、画面上部にしま模様の帯（`V.demoBar`、+10分・終了）を常に出す。
  開催日にデモが残っていたら起動時に終了を促す
- 今日の日付は **`U.today()`**（端末の時刻）。`toISOString()` は UTC なので、日本の朝9時前は前日になる。日付の比較に使わないこと

## 共有・入出力

- 計画: `{app:'kurunavi', kind:'plan', eventId, event(作成イベントなら一覧ごと), data, favorites}`
- 全体: `{app:'kurunavi', kind:'backup', state}`
- スリム形式には開催日（`date`）・金種（`cashBreak`/`cashSettled`/`cashStart`）・`routedAt` も載せる（1.2.0）
- 共有リンク: `#import=` ＋ deflate-raw 圧縮 base64url（`U.pack/unpack`）。起動時に検出して確認後に読み込み
- **スリム形式**（`S.exportPlan(id, {slim:true})`、共有リンク／QR専用）: 既定値・タイムスタンプ・アイテムID・`snap` を落として1文字キーにしたもの
  （entry: `{c:cid, r:pri, i:[items], m:memo, u:menu, s:status, k:[name,tw,space], ni:noItems, ns:noShot}` / item: `{n,p,q,s,a(paid),y(pay),x(追加購入)}`）。
  `k` はイベントの一覧から引けないサークルだけ持つ。読み込み側の `fatten()` が通常形式へ戻すので、**スリム形式のキーを変えたら fatten も直すこと**。
  実測：31サークル（品目・メモ入り）で 2880 → 860 文字。QRは v40-L の 2953 バイトが上限で、おおよそ100サークル前後まで。
  お気に入りはキーだけ（`favKeys`）送る（値は `S.isFav` が見ないため）
- QR: `HC.qr.svg(text, {ecl:'L', px, quiet})` → SVG文字列（入りきらなければ `null`）。ダークテーマでも白地のまま出す（`.qrbox`）

## 配置図エディタ（js/editor.js）

- 設定 →「配置図エディタを開く」。`S.state.layouts[eventId]` に保存し、`S.ev()` が同梱 spec より優先して使う
- 編集しやすいように、島／1列は `ey0`（先頭のY）`estep`（行間隔）`en`（片側の数）、壁は `ex0`/`estep`/`en` を持つ。
  保存時に `bake()` が `rows`/`ys`/`cells` を組み立てるので、**出力はそのまま data/*.js に貼れる**（「JSON」ボタン）
- 取り込んだ配置図画像は IndexedDB（`files` ストア、キー `map:<eventId>`）に入れ、spec には `image.src = 'idb'` と記録する。
  表示時は `HC.shots.mapUrl(eventId)` で Blob URL に解決する（map.js / editor.js の両方）
- 上部の「席が無いサークル N件」が編集中の検算。0件なら一覧の全サークルに席がある

## 同期（js/sync.js）

- 保存先は GAS のウェブアプリ。`S.state.sync = { url, phrase, auto, syncedAt, dirty, lastAt, device }`
- 合言葉はサーバーに送らず、`SHA-256('kurunavi:' + phrase)` の先頭16バイトを置き場所のキー `k` にする
- POST は `Content-Type: text/plain` で送る（preflight を起こさないため。GAS は CORS の事前確認に応答できない）
- 送るのは **data / customEvents / favorites / layouts / eventId** だけ。`settings`（テーマ・地図の向きなど）と
  IndexedDB のお品書き画像は自動では送らない（下の「お品書き画像の受け渡し」）
- **競合は base（最後に見たサーバーの更新時刻）で検出**。食い違えばサーバーの内容を返し、画面で「向こうを取り込む／こちらで上書き」を選ばせる
- オフライン時は `dirty` を立てて送らない。`online` イベントで再開。当日の会場で通信が切れても普段どおり使える
- 設定はQRで渡せる（`kind:'sync'` の共有リンク）。**合言葉が入っているので人に見せない**
- **お品書き画像の受け渡し**（1.2.0。PCで入れて、スマホは会場で見るだけ、という使い方のため）：
  画像は重いので自動同期には混ぜず、「設定 → 同期 → 画像を送る／受け取る」を押したときだけ動く（`Sy.shotsPush` / `Sy.shotsPull`）。
  GAS 側は画像を1枚ずつ `kurunavi_<k>_<id>.jpg`、一覧を `kurunavi_<k>_shots.json`（id・ev・cid・w・h・t・dev）で持つ
  （`?op=shots` / `?op=shot&id=` の GET、`op:'shotPut'` / `op:'shotDel'` の POST）。
  送る＝この端末で入れた画像のうちサーバーに無いもの。**この端末から送ったあと消したもの（dev が自分）はサーバーからも消す**。
  受け取る＝サーバーにあって手元に無いもの（同じIDで保存し `remote:true`）。送り元で消えた remote 画像は手元からも消す。
  受け取った画像を手元で消したら `localStorage['kurunavi.shotSkip']` に覚え、次から受け取らない。
  起動時に `Sy.shotsCheck()` が受け取れる枚数だけ見て、あればトーストで「受け取る」を出す（本体は落とさない）。
  **1.1.x の GAS は op を知らず、POST をそのまま計画の保存として扱ってしまう**ので、①先に `op=shots` の GET で `shots:1` を確かめる
  ②画像の POST には `base:-1` を付けて、古い GAS なら必ず競合で弾かれるようにしてある。GAS を更新したら「新しいバージョン」で再デプロイ。
  確認はモック（GAS と同じ受け答えをする node のサーバー）＋ Chrome 2つ（PC役・スマホ役）で行った
- PC では、サークル詳細を開いて Ctrl+V（`paste`）か、画像ファイルをサークル詳細／リストの行／一覧の行へドロップで画像を入れられる
  （ブラウザの画像を直接ドラッグしたときは URL から取りに行き、だめなら「画像をコピー→貼り付け」を案内する）
- 取り込みは「起動時」と「画面に戻ってきたとき（visibilitychange / focus、前回から15秒以上あいていれば）」。
  端末を持ち替えたら自動で最新になるが、**両方を同時に開いて編集すると競合**する（片方だけが残る）

## オフライン

- https で一度開けば SW が本体一式（現在22ファイル）をキャッシュし、圏外でも計画・記録・地図・お品書き画像はそのまま使える
- 設定の「オフライン」欄から、保存済みファイル数の確認と取り込み直し（SW への `refresh` メッセージ）ができる
- 外部リンク（X・pixiv・お品書きURL）だけは電波が必要。圏外では薄く表示し、押してもトーストで知らせるだけにしている
- **localhost では SW を無効化＆自動で unregister する**ので、ローカル検証でキャッシュに悩まされない
  （逆に SW 自体を試すときは、ページから手動で `navigator.serviceWorker.register('sw.js')` すればよい）

## 版の更新（ここを間違えると「いつまでも古い版のまま」になる）

- リリースのたびに **`sw.js` の `CACHE`** と **`js/app.js` の `HC.VERSION`** を同じ番号に上げる（現在 1.3.0）
- **SW の install はブラウザのHTTPキャッシュを避けて取り込む**（`freshRequests()`＝`cache:'reload'` ＋ `?v=CACHE`）。
  GitHub Pages は `Cache-Control: max-age=600` を返すので、ふつうに `cache.addAll(ASSETS)` すると
  **新しい版のキャッシュに古いファイルが入り**、プッシュしても画面がいつまでも古いままになる。2026-09-24 に実際にこれで詰まった
- 本体（ASSETS）は fetch でも裏更新しない。1ファイルずつ差し替えると「古いJSと新しいJS」が混ざるため、差し替えは install にまかせる
- `skipWaiting()` を使っているので `reg.waiting` では判定できない。**画面の `HC.VERSION` と、SWに聞いたキャッシュ名（`status`）を突き合わせる**
  （`storedVersion()`）。設定の「バージョン」欄（`app.paintVersion`）に
  「保存されている版も v1.1.2。最新の状態です」／「保存されている版は v2.0.0（画面は v1.1.2）」と出るので、
  更新したあと新しい版になったかが画面で分かる。更新は必ず本人の操作で（入力中に勝手に読み込み直さない）
- 確認手順：`node tools/cacheserve.js <プロジェクトの絶対パス> 7828` で
  **GitHub Pages と同じ `max-age=600`** を返すサーバーを立て、`/__ver?v=2.0.0` で「デプロイ」を切り替える。
  SWを入れる → 版を切り替える → `reg.update()` → キャッシュの中の `js/app.js` の版を見る、で再現・確認できる
  （ブラウザのプロファイル `%TEMP%\kuru-cdp-prof` は消してから始めると素直）

## 動作確認

- `preview_start kurunavi`（`tools/serve.ps1`、port 7827）。**localhost では Service Worker を無効化**している（古いキャッシュで混乱するため）
- ロジック単体テスト（DOM不要部分）:
  ```js
  // node で util/parser/layout/data を vm.runInThisContext し、
  // 全サークルの Lay.cellsOf(L,c).length === c.nums.length を確認、parseCircleList のサンプル解析など
  ```
- ブラウザ実機の確認は Chrome を `--headless=new --remote-debugging-port=...` で起動し、CDP（node 22+ の組み込み WebSocket で十分）で
  `Runtime.evaluate` / `Page.captureScreenshot` を叩くのが速い。`file://` を見るときは `--allow-file-access-from-files` を付ける
- QRの検証：Python の `qrcode`（生成の参照実装）と突き合わせ、`pyzbar` で実際にデコードできるか確認する。
  2026-09-23 時点で L/M/Q/H × バージョン1〜40 × マスク総当たりの模様が参照実装と完全一致することを確認済み
- 確認観点：スマホ幅(375px)縦持ちのマップ回転、PC幅(≥960px)の右パネル、ダーク/ライト、戻るボタンでシートが閉じる
- オフラインの確認は CDP の `Network.emulateNetworkConditions { offline: true }`。SW を試したあとは
  `getRegistrations().unregister()` ＋ `caches.delete()` で消さないと、次の検証で古いJSを掴む

## 既知の制限・今後のアイデア

- [x] 共有リンクの QR コード表示（`js/qr.js` を自作。スリム形式と併せて実装済み）
- [x] お品書き画像の添付（`js/shots.js`。サークル詳細で追加、当日画面にサムネ表示、設定に容量と一括削除）
- [x] 現在時刻（秒まで）と開場からの経過時間（当日タブ上部）。遅れ警告は本人希望で作らない
- [x] 配置図エディタ（`js/editor.js`）
- [x] 入口位置：公式PDFの壁の開口部を実測（PDF座標 x=701 / x=1867 → 配置図座標 1385 / 520。「会場入口」表記は 1867 側）。ずれていればエディタで直せる
- [x] 近くの未訪問サークル（`S.nearby`）／その場でメモ／巡回表の印刷
- [x] PCとスマホの同期（`js/sync.js` ＋ `tools/gas/コード.gs`。自動送信・競合の選択・設定QR）
- [x] お品書き待ちの見える化（`S.isPending` / リスト上部カード・絞り込み・試算表の注記）
- [x] 予算シミュレーション（`S.simulate()` → リストタブの「いくら必要か」表。必須だけ／優先まで／通常まで／全部で、合計・予算残・現金残を比較）
- [x] 品目入力の最適化（価格の学習・同名は数量+1・まとめて入力 `P.parseItemLines`・スマホはテンキー・＋の長押しで優先度選択）
- 同行者と分担は**作らない**（1人で行くため。2026-09-23 に本人確認済み）
- [x] 配置図を公式PDFから作り直し（600席すべて実測。最大15pxあったズレを解消）＋タイムテーブル（12:00開始／13:00当日券／16:00終了）
- [x] 開催日を基準にした時刻表示（別の日に開いても「終了」と出ない。state: before/live/after/none）
- [x] オフライン対応（SWキャッシュ＋オフライン表示・外部リンク抑止・設定から取り込み直し）
- [x] 区間ごとのルート表示（`◀ 1/7 ▶ 全体`。線が重なって分かりにくい問題への対処。1.1.0）
- [x] 現金の金種と最適な出し方（`cashBreak` / `S.payPlan` / テンキーのヒント／おつりも戻す。1.1.0）
- [x] 壁サークルを先に回る（`settings.wallFirst`。列が長くなりやすいため。1.1.0）
- [x] 更新したあと新しい版になったかの表示（画面の版とキャッシュの版を並べて出す。1.1.0。→「版の更新」の節）
- [x] 当日タブの「時刻」から開催日を直せる（未設定だと「今日の時間帯」として扱われるため。1.1.2）
- [x] 巡回表（印刷）に壁とお品書き待ちの印（1.1.2）
- [x] 財布の現金の二重引きを修正・無料配布をタップで記録・売切を戻すと品物も戻る・連打の保険・当日までの準備欄・お品書き画像をPCからスマホへ（GAS経由の差分転送、貼り付け・ドロップ）（1.2.0）
- [x] 画面文言の見直し（「買うもの」まわりは「登録」に統一）・共有リンクの読み込みでルートの「作ったあとに追加」が誤って出るのを修正（1.2.1）
- [x] お品書き画像が未登録のサークルを見える化（リストのカード・絞り込み・行の印・詳細の注記・準備欄。「登録しない」で外せる）（1.2.2）
- [x] まとめカード（お品書き待ち・画像なし）の「残り◯件も表示」をカードの中で広げる形に（以前は下の一覧を絞り込むだけで、押しても変化が見えなかった）（1.2.3）
- [x] 当日モード（大きな文字・画面下に固定した操作ボタン・当日に使うタブだけ・区間の道順）とデモモード（開始時刻からの時計・終了で元に戻る・同期停止）。ルート線が細くて見えない問題の修正、取り消し後に価格のあたりが残る問題の修正（1.3.0）
- [ ] サークル画像の取り込み：URLをもらってから。**目的のサークルのみ**・**アプリに同梱**（`data/cuts/`）で本人合意済み（2026-09-24）。
      CORSのため端末側での直接取得は不可なので、こちらで取得→長辺800pxのWebPに縮小→同梱→一覧・詳細・当日カードに表示する
- 運用方針（2026-09-24 本人確認）：スマホは **GitHub Pages に公開**して開く／当日の記録は**チェックだけ**が基本（予定額で自動計上、違ったときだけ金額を直す）
- [ ] 今後の候補：列・待ち時間の記録／購入履歴の年間集計・家計簿CSV／会場メモのピン
- [ ] 12th のサークル一覧は貼り付けが Q38 で途切れていた（Q39以降は未収録。本人判断で当面このまま。手動追加で対応）
- [ ] 印刷の巡回表は A4縦・1ページ40件くらいが目安。2ページ以上のときのヘッダー繰り返しは未対応
