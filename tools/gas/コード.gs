/**
 * クルナビ 同期用の Web アプリ（Google Apps Script）
 *
 * やること：合言葉ごとに JSON をひとつ、自分の Google ドライブに置いて読み書きするだけ。
 * アプリからは合言葉そのものではなく、そのハッシュ（k）が飛んでくる。
 *
 * 置き方
 *   1. https://script.google.com/ で「新しいプロジェクト」
 *   2. このファイルの中身を貼り付けて保存
 *   3. 右上「デプロイ」→「新しいデプロイ」→ 種類は「ウェブアプリ」
 *        次のユーザーとして実行：自分
 *        アクセスできるユーザー：全員        ← 匿名でも呼べるようにする（合言葉が鍵）
 *   4. 出てきた .../exec のURLを、クルナビの「設定 → 同期」に貼る
 *
 * 更新したときは「デプロイを管理」→ 鉛筆 →「バージョン：新規」→ デプロイ（URLは変わりません）
 */

var FOLDER_NAME = 'クルナビ同期';

function doGet(e) {
  var k = keyOf((e && e.parameter) || {});
  if (!k) return out({ ok: false, error: 'key' });
  var rec = read(k);
  return out({ ok: true, updated: rec.updated, data: rec.data, device: rec.device });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: 'json' });
  }
  var k = keyOf(body);
  if (!k) return out({ ok: false, error: 'key' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return out({ ok: false, error: 'busy' });
  }
  try {
    var cur = read(k);
    // base（アプリが最後に見たサーバーの更新時刻）が食い違う＝別の端末が先に保存している
    if (body.base != null && Number(body.base) !== Number(cur.updated)) {
      return out({ ok: false, conflict: true, updated: cur.updated, data: cur.data, device: cur.device });
    }
    var rec = {
      updated: Date.now(),
      data: String(body.data || ''),
      device: String(body.device || ''),
    };
    write(k, rec);
    return out({ ok: true, updated: rec.updated });
  } finally {
    lock.releaseLock();
  }
}

// ---- 中身 ------------------------------------------------------------

function keyOf(o) {
  var k = String((o && o.k) || '');
  return /^[a-f0-9]{16,64}$/.test(k) ? k : '';   // アプリが作るハッシュ以外は受け付けない
}

function fileName(k) {
  return 'kurunavi_' + k + '.json';
}

function folder() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function findFile(k) {
  var it = folder().getFilesByName(fileName(k));
  return it.hasNext() ? it.next() : null;
}

function read(k) {
  var f = findFile(k);
  if (!f) return { updated: 0, data: '', device: '' };
  try {
    var o = JSON.parse(f.getBlob().getDataAsString());
    return { updated: Number(o.updated) || 0, data: String(o.data || ''), device: String(o.device || '') };
  } catch (err) {
    return { updated: 0, data: '', device: '' };
  }
}

function write(k, rec) {
  var json = JSON.stringify(rec);
  var f = findFile(k);
  if (f) f.setContent(json);
  else folder().createFile(fileName(k), json, MimeType.PLAIN_TEXT);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
