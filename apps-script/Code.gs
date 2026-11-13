/**
 * CANMAS COFFEE 訂單接收（Google Apps Script Web App）
 *
 * 由 Netlify 後端呼叫（POST，Content-Type: text/plain，內容為 JSON）：
 *   - 新訂單：{ orderNo, timestamp, name, phone, email, address, items, subtotal, shipping, total, paymentMethod, status, note }
 *   - 付款結果：{ action: "updateOrder", orderNo, status, paymentType, paidAt, ...同上 }
 * 回傳 JSON：{ status: "ok" } 或 { status: "error", message }
 *
 * 訂單會寫入本試算表的「網站訂單」分頁（不存在時自動建立）。
 * 選用：在「專案設定 → 指令碼屬性」新增 SECRET，並在 Netlify 設同值的 APPS_SCRIPT_SECRET，
 * 之後只有你的網站後端寫得進來。
 */
var SHEET_NAME = '網站訂單';

// [payload 欄位, 表頭, 型別]；text 欄位一律以純文字寫入（保留電話開頭的 0，也避免 =、+ 開頭的內容被當成公式）
var COLUMNS = [
  ['orderNo', '訂單編號', 'text'],
  ['timestamp', '下單時間', 'text'],
  ['name', '姓名', 'text'],
  ['phone', '電話', 'text'],
  ['email', 'Email', 'text'],
  ['address', '地址', 'text'],
  ['items', '品項', 'text'],
  ['subtotal', '商品小計', 'num'],
  ['shipping', '運費', 'num'],
  ['total', '應付總額', 'num'],
  ['paymentMethod', '付款方式', 'text'],
  ['status', '狀態', 'text'],
  ['paidAt', '付款時間', 'text'],
  ['paymentType', '綠界付款方式', 'text'],
  ['note', '備註', 'text']
];

function col_(key) {
  for (var i = 0; i < COLUMNS.length; i++) if (COLUMNS[i][0] === key) return i + 1;
  throw new Error('未知欄位 ' + key);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('請從試算表的「擴充功能 → Apps Script」開啟本專案，而不是在 script.google.com 單獨建立');
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    var head = sheet.getRange(1, 1, 1, COLUMNS.length);
    head.setValues([COLUMNS.map(function (c) { return c[1]; })]);
    head.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRow_(sheet, orderNo) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(orderNo)) return i + 2;
  }
  return -1;
}

function rowValues_(data) {
  return COLUMNS.map(function (c) {
    var v = data[c[0]];
    if (c[2] === 'num') return Number(v) || 0;
    return v === null || v === undefined ? '' : String(v);
  });
}

function writeRow_(sheet, row, values) {
  var range = sheet.getRange(row, 1, 1, COLUMNS.length);
  range.setNumberFormats([COLUMNS.map(function (c) { return c[2] === 'text' ? '@' : '0'; })]);
  range.setValues([values]);
}

function setText_(sheet, row, key, value) {
  var cell = sheet.getRange(row, col_(key));
  cell.setNumberFormat('@');
  cell.setValue(String(value));
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (secret && data.secret !== secret) return out_({ status: 'error', message: 'unauthorized' });
    if (!data.orderNo) return out_({ status: 'error', message: 'missing orderNo' });

    lock.waitLock(20000);
    var sheet = getSheet_();
    var row = findRow_(sheet, data.orderNo);

    if (data.action === 'updateOrder') {
      if (row < 0) {
        // 找不到原訂單（例如下單時寫入失敗）：把這筆當新資料補寫，不要遺失付款紀錄
        writeRow_(sheet, sheet.getLastRow() + 1, rowValues_(data));
      } else {
        if (data.status) setText_(sheet, row, 'status', data.status);
        if (data.paidAt) setText_(sheet, row, 'paidAt', data.paidAt);
        if (data.paymentType) setText_(sheet, row, 'paymentType', data.paymentType);
      }
    } else if (row < 0) {
      writeRow_(sheet, sheet.getLastRow() + 1, rowValues_(data));
    } // 同一訂單編號重複送來：視為重送，不重複寫入

    return out_({ status: 'ok', orderNo: data.orderNo });
  } catch (err) {
    return out_({ status: 'error', message: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

// 瀏覽器開啟網址時的健康檢查
function doGet() {
  return out_({ status: 'ok', service: 'canmas-orders' });
}
