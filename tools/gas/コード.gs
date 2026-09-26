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
 *
 * お品書き画像（1.2.0〜）
 *   計画のJSONとは別に、画像を1枚ずつ「kurunavi_<k>_<id>.jpg」として同じフォルダに置き、
 *   一覧を「kurunavi_<k>_shots.json」に持つ。アプリの「画像を送る／受け取る」を押したときだけ使う。
 *   1.1.x のコードのままだと画像は送れない（アプリが「GASを更新してください」と出す）ので、貼り直して再デプロイする
 */

var FOLDER_NAME = 'クルナビ同期';

function doGet(e) {
  var p = (e && e.parameter) || {};
  var k = keyOf(p);
  if (!k) return out({ ok: false, error: 'key' });
  if (p.op === 'shots') return out({ ok: true, shots: 1, list: readIndex(k) });
  if (p.op === 'shot') {
    var id = idOf(p.id);
    var f = id && findFile(k, shotName(k, id));
    if (!f) return out({ ok: false, error: 'notfound' });
    return out({ ok: true, type: 'image/jpeg', data: Utilities.base64Encode(f.getBlob().getBytes()) });
  }
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
    if (body.op === 'shotPut') return out(shotPut(k, body));
    if (body.op === 'shotDel') return out(shotDel(k, body));
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

function idOf(id) {
  id = String(id || '');
  return /^[a-z0-9]{4,40}$/.test(id) ? id : '';   // アプリが作る画像ID（英小文字と数字）だけ
}

function shotName(k, id) {
  return 'kurunavi_' + k + '_' + id + '.jpg';
}

function indexName(k) {
  return 'kurunavi_' + k + '_shots.json';
}

function folder() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function findFile(k, name) {
  var it = folder().getFilesByName(name || fileName(k));
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

// ---- お品書き画像 ------------------------------------------------------

function readIndex(k) {
  var f = findFile(k, indexName(k));
  if (!f) return [];
  try {
    var list = JSON.parse(f.getBlob().getDataAsString());
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function writeIndex(k, list) {
  var json = JSON.stringify(list);
  var f = findFile(k, indexName(k));
  if (f) f.setContent(json);
  else folder().createFile(indexName(k), json, MimeType.PLAIN_TEXT);
}

/** 画像を1枚置く。meta は一覧に載せる情報（サークル・大きさなど） */
function shotPut(k, body) {
  var id = idOf(body.id);
  var m = body.meta || {};
  if (!id || !body.data) return { ok: false, error: 'bad' };
  var bytes = Utilities.base64Decode(String(body.data));
  var name = shotName(k, id);
  var old = findFile(k, name);
  if (old) old.setTrashed(true);
  folder().createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
  var list = readIndex(k).filter(function (x) { return x.id !== id; });
  list.push({
    id: id,
    ev: String(m.ev || ''),
    cid: String(m.cid || ''),
    w: Number(m.w) || 0,
    h: Number(m.h) || 0,
    size: bytes.length,
    t: Number(m.t) || Date.now(),
    dev: String(body.device || ''),
  });
  writeIndex(k, list);
  return { ok: true, n: list.length };
}

/** 画像を消す（送った端末で消したものを、次に送るときに片付ける） */
function shotDel(k, body) {
  var ids = (body.ids || []).map(idOf).filter(Boolean);
  ids.forEach(function (id) {
    var f = findFile(k, shotName(k, id));
    if (f) f.setTrashed(true);
  });
  var list = readIndex(k).filter(function (x) { return ids.indexOf(x.id) < 0; });
  writeIndex(k, list);
  return { ok: true, n: list.length };
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
