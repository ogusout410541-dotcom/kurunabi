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
js/views.js           HC.views  : 各画面の HTML 生成（go/list/map/circles/more ＋ サークル詳細シート）
js/app.js             HC.app / HC.actions : 起動、画面切替、data-act のハンドラ、入力(change)処理、ドラッグ並べ替え
sw.js                 オフラインキャッシュ（リリース時は CACHE のバージョンを上げる）
                      画面から 'status' / 'refresh' を postMessage で問い合わせできる（設定のオフライン欄）
tools/serve.ps1       ローカル確認用サーバー (http://localhost:7827/)
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
  settings: { theme, font, haptics, wakeLock, mapMode:'simple'|'image', mapOrient, routeMode:'must'|'tier'|'short', showRoute, defaultPay:'cash'|'card' },
}
EventData = { budget, cash, reserve, order: [cid], entries: {[cid]: Entry}, extras: [Extra],
              addCircles: [Circle], start: 'door-r'|sid, focus: cid|null, date, updated,
              openAt: 'HH:MM'（自分の入場時刻）, endAt: 'HH:MM'（終了）, startedAt: ms（「いま開始」の時刻）}
// 同梱イベント側の openAt/endAt/schedule が既定値。EventData の値が空ならそちらを使う（S.times()）
Entry = { cid, pri: 1必須|2優先|3通常|4余裕, items: [Item], memo, menu(お品書きURL),
          status: 'todo'|'later'|'done'|'soldout'|'skip', doneAt, snap: {name, tw, space}, addedAt }
Item  = { id, name, price(予定単価, 0=未定), qty, status: 'todo'|'bought'|'soldout'|'skip',
          paid(実際の支払総額 or null=予定通り), pay: 'cash'|'card', planned(false=当日の追加購入), t }
Extra = { id, name, cost, qty, pay, t }     // サークル外の支出（企業ブース・飲食など）
Circle = { id:'A01', block:'A', nums:[1,2], space:'A01-02', name, tw, px(pixiv数字ID or URL), web }
```

- サークル ID は「ブロック＋先頭番号2桁」（`A01-02` → `A01`）。イベントが変わると別物なので、イベント横断の照合は `snap`/`favorites` のキー（X ID か正規化名）で行う（`S.keysOf`, `S.historyOf`）
- 金額: 使用額 = bought の `paid ?? price*qty` ＋ extras。残り予定 = 未完了エントリの todo アイテム。`S.stats()` に集約
- **お品書き画像だけは `HC.store` の外**（IndexedDB `kurunavi` / `shotMeta`＋`shotBlob`）。undo の対象外で、共有リンクにもJSON書き出しにも入らない。
  `shotMeta = {id, ev, cid, thumb(dataURL・最大180px), w, h, size, t}`／`shotBlob = {id, blob}`。保存時に長辺1600pxのJPEGへ縮小する。
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
- 品目入力は**入力回数を減らす**方向で作る：`S.priceHint(品名)` が過去に入れた金額の多数決を返し、プリセットのチップに出す／追加時に自動で入れる。
  同じ品名をもう一度押したら行を増やさず数量+1（トーストから「別の行にする」で戻せる）。
  指の端末（`matchMedia('(pointer: coarse)')`）では価格欄をタップするとアプリのテンキー、マウスならそのままキーボード入力
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

## ルート計算

`Lay.dist`：同じ通路（x差<45）なら直線、違えば `crossY` のどれかを経由するマンハッタン距離。
`Lay.route`：始点固定の最近傍法＋2-opt。`S.optimize(mode, fromCurrent)` が未完了分だけ並べ替え（完了分は先頭に固定）。
mode: `must`=必須を先に回り切ってから残り / `tier`=優先度ごと / `short`=全部まとめて最短。

## 共有・入出力

- 計画: `{app:'kurunavi', kind:'plan', eventId, event(作成イベントなら一覧ごと), data, favorites}`
- 全体: `{app:'kurunavi', kind:'backup', state}`
- 共有リンク: `#import=` ＋ deflate-raw 圧縮 base64url（`U.pack/unpack`）。起動時に検出して確認後に読み込み
- **スリム形式**（`S.exportPlan(id, {slim:true})`、共有リンク／QR専用）: 既定値・タイムスタンプ・アイテムID・`snap` を落として1文字キーにしたもの
  （entry: `{c:cid, r:pri, i:[items], m:memo, u:menu, s:status, k:[name,tw,space]}` / item: `{n,p,q,s,a(paid),y(pay),x(追加購入)}`）。
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
  IndexedDB のお品書き画像は端末ごとに残す
- **競合は base（最後に見たサーバーの更新時刻）で検出**。食い違えばサーバーの内容を返し、画面で「向こうを取り込む／こちらで上書き」を選ばせる
- オフライン時は `dirty` を立てて送らない。`online` イベントで再開。当日の会場で通信が切れても普段どおり使える
- 設定はQRで渡せる（`kind:'sync'` の共有リンク）。**合言葉が入っているので人に見せない**

## オフライン

- https で一度開けば SW が本体一式（現在21ファイル）をキャッシュし、圏外でも計画・記録・地図・お品書き画像はそのまま使える
- 設定の「オフライン」欄から、保存済みファイル数の確認と取り込み直し（SW への `refresh` メッセージ）ができる
- 外部リンク（X・pixiv・お品書きURL）だけは電波が必要。圏外では薄く表示し、押してもトーストで知らせるだけにしている
- **localhost では SW を無効化＆自動で unregister する**ので、ローカル検証でキャッシュに悩まされない
  （逆に SW 自体を試すときは、ページから手動で `navigator.serviceWorker.register('sw.js')` すればよい）

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
- [x] 予算シミュレーション（`S.simulate()` → リストタブの「いくら必要か」表。必須だけ／優先まで／通常まで／全部で、合計・予算残・現金残を比較）
- [x] 品目入力の最適化（価格の学習・同名は数量+1・まとめて入力 `P.parseItemLines`・スマホはテンキー・＋の長押しで優先度選択）
- 同行者と分担は**作らない**（1人で行くため。2026-09-23 に本人確認済み）
- [x] 配置図を公式PDFから作り直し（600席すべて実測。最大15pxあったズレを解消）＋タイムテーブル（12:00開始／13:00当日券／16:00終了）
- [x] 開催日を基準にした時刻表示（別の日に開いても「終了」と出ない。state: before/live/after/none）
- [x] オフライン対応（SWキャッシュ＋オフライン表示・外部リンク抑止・設定から取り込み直し）
- [ ] サークル画像の取り込み：URLをもらってから。**目的のサークルのみ**・**アプリに同梱**（`data/cuts/`）で本人合意済み（2026-09-24）。
      CORSのため端末側での直接取得は不可なので、こちらで取得→長辺800pxのWebPに縮小→同梱→一覧・詳細・当日カードに表示する
- 運用方針（2026-09-24 本人確認）：スマホは **GitHub Pages に公開**して開く／当日の記録は**チェックだけ**が基本（予定額で自動計上、違ったときだけ金額を直す）
- [ ] 今後の候補：列・待ち時間の記録／購入履歴の年間集計・家計簿CSV／会場メモのピン
- [ ] 12th のサークル一覧は貼り付けが Q38 で途切れていた（Q39以降は未収録。本人判断で当面このまま。手動追加で対応）
- [ ] 印刷の巡回表は A4縦・1ページ40件くらいが目安。2ページ以上のときのヘッダー繰り返しは未対応
