/**
 * CANMAS COFFEE 訂單接收（Google Apps Script Web App）— 合併版
 *
 * 用來「取代」現有 canmas_coffee_beans 專案裡的 程式碼.gs，沿用同一份試算表：
 *   - 訂單寫入「訂單記錄」（原本的 10 欄不動，右邊新增 3 欄：付款方式、付款時間、綠界付款管道）
 *   - 顧客寫入／更新「顧客資料」（原本的 10 欄不動）
 *
 * 和舊版的差異：
 *   1. Netlify 送來的訂單不再寄信 —— 店主通知與客人確認信改由 Netlify 後端統一寄出（避免重複寄兩次）。
 *      過渡期：舊版前端直接送來的訂單（沒有 paymentMethod）仍照舊寄信，PR 上線後自然不再發生。
 *   2. 認得 { action: "updateOrder" }：付款成功／失敗時，原地更新該筆訂單的狀態、付款時間、付款管道。
 *   3. 電話一律以純文字寫入，保留開頭的 0；顧客比對時會把「912345678」與「0912345678」視為同一支電話，
 *      不會再為同一位客人重複建檔。
 *   4. 同一訂單編號重複送來（網路重送）只寫一次。
 *   5. 顧客累計：ATM 下單即計入；信用卡付款成功才計入。付款失敗／取消扣回，之後付款成功再加回。
 *   6. expireStaleCardOrders()（設每小時觸發）：信用卡單超過 2 小時未付款自動標為「逾時未付款（已取消）」。
 *
 * 由 Netlify 後端呼叫（POST，Content-Type: text/plain，內容為 JSON）：
 *   - 新訂單：{ orderNo, timestamp, name, phone, email, address, items, total, note, status, paymentMethod, ... }
 *   - 付款結果：{ action: "updateOrder", orderNo, status, paidAt, paymentType, ...同上 }
 * 回傳 JSON：{ status: "ok", orderNo } 或 { status: "error", message }
 *
 * 選用：在「專案設定 → 指令碼屬性」新增 SECRET，並在 Netlify 設同值的 APPS_SCRIPT_SECRET，
 * 之後只有你的網站後端寫得進來。
 */
var SPREADSHEET_ID = '1WTt3GZ7WDMXpeFh-j1btJB28z8aHwRobE4GaJuEr_XY';
var ORDER_SHEET = '訂單記錄';
var CUSTOMER_SHEET = '顧客資料';
var HEADER_BG = '#1a1a24';
var HEADER_FG = '#C9A84C';

// [payload 欄位, 表頭, 型別]。前 10 欄與舊版完全相同（位置不可調動）；text 一律以純文字寫入，
// 保留電話開頭的 0，也避免 =、+ 開頭的內容被當成公式。
var ORDER_COLS = [
  ['orderNo', '訂單編號', 'text'],
  ['timestamp', '下單時間', 'text'],
  ['name', '姓名', 'text'],
  ['phone', '電話', 'text'],
  ['email', 'Email', 'text'],
  ['address', '寄送地址', 'text'],
  ['items', '品項', 'text'],
  ['total', '合計金額', 'num'],
  ['note', '備註', 'text'],
  ['status', '狀態', 'text'],
  ['paymentMethod', '付款方式', 'text'],
  ['paidAt', '付款時間', 'text'],
  ['paymentType', '綠界付款管道', 'text']
];
var CUSTOMER_HEADERS = ['顧客編號', '姓名', '電話', 'Email', '常用地址', '首次下單', '最近下單', '累計訂單數', '累計消費金額', '備註'];

function orderCol_(key) {
  for (var i = 0; i < ORDER_COLS.length; i++) if (ORDER_COLS[i][0] === key) return i + 1;
  throw new Error('未知欄位 ' + key);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function now_() {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

function styleHeader_(range) {
  range.setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
}

// 電話正規化：只留數字；+886 轉 0 開頭；被試算表吃掉開頭 0 的手機（9 開頭、9 碼）補回 0
function normPhone_(v) {
  var d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  if (d.indexOf('886') === 0 && d.length >= 11) d = '0' + d.slice(3);
  if (d.length === 9 && d.charAt(0) === '9') d = '0' + d;
  return d;
}

function isFailed_(status) {
  return /❌|失敗|取消/.test(String(status || ''));
}

// 這筆訂單是否計入顧客累計：信用卡要付款成功才算；ATM／舊資料下單即算，被取消或失敗則不算
function counts_(status, method) {
  if (String(method || '') === '信用卡') return /已付款/.test(String(status || ''));
  return !isFailed_(status);
}

// 信用卡單建立後超過這麼多小時仍未付款，自動標為逾時取消（綠界付款頁已失效）
var CARD_EXPIRE_HOURS = 2;
var EXPIRED_STATUS = '⌛ 逾時未付款（已取消）';

// 解析「2026/11/13 16:24」「2026/11/13 下午 4:24:10」等台灣時間字串，回傳毫秒；無法解析回傳 0
function parseTw_(v) {
  if (v instanceof Date) return v.getTime();
  var m = String(v || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\D*?(上午|下午)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  var h = Number(m[5]);
  if (m[4] === '下午' && h < 12) h += 12;
  if (m[4] === '上午' && h === 12) h = 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h - 8, Number(m[6]), Number(m[7] || 0));
}

function getOrderSheet_(ss) {
  var sheet = ss.getSheetByName(ORDER_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ORDER_SHEET);
    var head = sheet.getRange(1, 1, 1, ORDER_COLS.length);
    head.setValues([ORDER_COLS.map(function (c) { return c[1]; })]);
    styleHeader_(head);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // 既有分頁：只補上右邊缺少的新欄位表頭，不動原本的欄位
  for (var c = 11; c <= ORDER_COLS.length; c++) {
    var cell = sheet.getRange(1, c);
    if (String(cell.getValues()[0][0] || '') === '') {
      cell.setValues([[ORDER_COLS[c - 1][1]]]);
      styleHeader_(cell);
    }
  }
  return sheet;
}

function getCustomerSheet_(ss) {
  var sheet = ss.getSheetByName(CUSTOMER_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CUSTOMER_SHEET);
    var head = sheet.getRange(1, 1, 1, CUSTOMER_HEADERS.length);
    head.setValues([CUSTOMER_HEADERS]);
    styleHeader_(head);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findOrderRow_(sheet, orderNo) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(orderNo)) return i + 2;
  }
  return -1;
}

function orderValues_(data) {
  return ORDER_COLS.map(function (c) {
    var v = data[c[0]];
    if (c[2] === 'num') return Number(v) || 0;
    if (c[0] === 'timestamp' && !v) return now_();
    if (c[0] === 'status' && !v) return '待確認';
    if (c[0] === 'email') return String(v === null || v === undefined ? '' : v).trim();
    return v === null || v === undefined ? '' : String(v);
  });
}

function appendOrder_(sheet, data) {
  var row = sheet.getLastRow() + 1;
  var range = sheet.getRange(row, 1, 1, ORDER_COLS.length);
  range.setNumberFormats([ORDER_COLS.map(function (c) { return c[2] === 'text' ? '@' : '0'; })]);
  range.setValues([orderValues_(data)]);
  return row;
}

function setText_(sheet, row, key, value) {
  var cell = sheet.getRange(row, orderCol_(key));
  cell.setNumberFormat('@');
  cell.setValues([[String(value)]]);
}

// 找到顧客所在列（用正規化後的電話比對）；回傳 { row, values } 或 null
function findCustomer_(sheet, phoneN) {
  var last = sheet.getLastRow();
  if (last < 2 || !phoneN) return null;
  var vals = sheet.getRange(2, 1, last - 1, CUSTOMER_HEADERS.length).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (normPhone_(vals[i][2]) === phoneN) return { row: i + 2, values: vals[i] };
  }
  return null;
}

function nextCustomerNo_(sheet) {
  var last = sheet.getLastRow();
  var max = 0;
  if (last >= 2) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var n = parseInt(String(ids[i][0]).replace(/\D/g, ''), 10);
      if (n > max) max = n;
    }
  }
  return 'C' + String(max + 1).padStart(4, '0');
}

// 新訂單成立：顧客建檔，或累計訂單數 +1、消費金額加上本單
function upsertCustomer_(ss, data) {
  var phoneN = normPhone_(data.phone);
  if (!phoneN) return;
  var sheet = getCustomerSheet_(ss);
  var total = Number(data.total) || 0;
  var email = String(data.email || '').trim();
  var found = findCustomer_(sheet, phoneN);
  var stamp = now_();

  if (found) {
    var v = found.values;
    var r = found.row;
    sheet.getRange(r, 2).setValues([[data.name || v[1]]]);
    var phoneCell = sheet.getRange(r, 3);
    phoneCell.setNumberFormat('@');
    phoneCell.setValues([[phoneN]]); // 順便把被吃掉的開頭 0 補回來
    if (email) sheet.getRange(r, 4).setValues([[email]]);
    if (data.address) sheet.getRange(r, 5).setValues([[data.address]]);
    sheet.getRange(r, 7).setValues([[stamp]]);
    sheet.getRange(r, 8).setValues([[(Number(v[7]) || 0) + 1]]);
    sheet.getRange(r, 9).setValues([[(Number(v[8]) || 0) + total]]);
    return;
  }

  var row = sheet.getLastRow() + 1;
  var range = sheet.getRange(row, 1, 1, CUSTOMER_HEADERS.length);
  range.setNumberFormats([['@', '@', '@', '@', '@', '@', '@', '0', '0', '@']]);
  range.setValues([[nextCustomerNo_(sheet), data.name || '', phoneN, email, data.address || '', stamp, stamp, 1, total, '新客建檔']]);
}

// 付款失敗／恢復時調整顧客累計（delta 為 +1 或 -1）
function adjustCustomer_(ss, phone, delta, total) {
  var phoneN = normPhone_(phone);
  if (!phoneN) return;
  var sheet = getCustomerSheet_(ss);
  var found = findCustomer_(sheet, phoneN);
  if (!found) return;
  var v = found.values;
  sheet.getRange(found.row, 8).setValues([[Math.max(0, (Number(v[7]) || 0) + delta)]]);
  sheet.getRange(found.row, 9).setValues([[Math.max(0, (Number(v[8]) || 0) + delta * (Number(total) || 0))]]);
}

function rowData_(values) {
  var d = {};
  ORDER_COLS.forEach(function (c, i) { d[c[0]] = values[i]; });
  return d;
}

function updateOrder_(ss, sheet, row, data) {
  var prev = sheet.getRange(row, 1, 1, ORDER_COLS.length).getValues()[0];
  var prevStatus = prev[orderCol_('status') - 1];
  var prevMethod = prev[orderCol_('paymentMethod') - 1] || data.paymentMethod;

  if (data.status) setText_(sheet, row, 'status', data.status);
  if (data.paymentMethod) setText_(sheet, row, 'paymentMethod', data.paymentMethod);
  if (data.paidAt) setText_(sheet, row, 'paidAt', data.paidAt);
  if (data.paymentType) setText_(sheet, row, 'paymentType', data.paymentType);

  if (data.status) {
    var method = data.paymentMethod || prevMethod;
    var wasCounted = counts_(prevStatus, prevMethod);
    var nowCounted = counts_(data.status, method);
    var d = rowData_(prev);
    var phone = d.phone || data.phone;
    var total = Number(d.total) || Number(data.total) || 0;
    if (nowCounted && !wasCounted) {
      // 信用卡付款成功（或逾時取消後又收到付款）：此時才建檔／計入顧客
      upsertCustomer_(ss, { name: d.name || data.name, phone: phone, email: d.email || data.email, address: d.address || data.address, total: total });
    } else if (wasCounted && !nowCounted) {
      adjustCustomer_(ss, phone, -1, total);
    }
  }
}

// 排程（每小時）：把逾時未付款的信用卡單標為取消。也可在編輯器手動執行。
function expireStaleCardOrders() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getOrderSheet_(SpreadsheetApp.openById(SPREADSHEET_ID));
    var last = sheet.getLastRow();
    if (last < 2) return 0;
    var vals = sheet.getRange(2, 1, last - 1, ORDER_COLS.length).getValues();
    var now = Date.now();
    var n = 0;
    for (var i = 0; i < vals.length; i++) {
      var d = rowData_(vals[i]);
      if (String(d.paymentMethod) !== '信用卡' || !/^待付款/.test(String(d.status))) continue;
      var t = parseTw_(d.timestamp);
      if (t && now - t > CARD_EXPIRE_HOURS * 3600 * 1000) {
        setText_(sheet, i + 2, 'status', EXPIRED_STATUS);
        n++;
      }
    }
    Logger.log('標為逾時取消：' + n + ' 筆');
    return n;
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (secret && data.secret !== secret) return out_({ status: 'error', message: 'unauthorized' });
    if (!data.orderNo) return out_({ status: 'error', message: 'missing orderNo' });

    lock.waitLock(20000);
    locked = true;
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = getOrderSheet_(ss);
    var row = findOrderRow_(sheet, data.orderNo);

    if (data.action === 'updateOrder') {
      if (row < 0) {
        // 找不到原訂單（例如下單時寫入失敗）：把這筆當新資料補寫，不要遺失付款紀錄
        appendOrder_(sheet, data);
        if (counts_(data.status, data.paymentMethod)) upsertCustomer_(ss, data);
      } else {
        updateOrder_(ss, sheet, row, data);
      }
    } else if (row < 0) {
      appendOrder_(sheet, data);
      if (counts_(data.status, data.paymentMethod)) upsertCustomer_(ss, data);
      if (isLegacyRequest_(data)) sendLegacyMails_(data);
    } // 同一訂單編號重複送來：視為重送，不重複寫入（也不重複寄信）

    return out_({ status: 'ok', orderNo: data.orderNo });
  } catch (err) {
    return out_({ status: 'error', message: String((err && err.message) || err) });
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  }
}

// ---- 過渡期相容：舊版前端（目前正式站 main 分支）直接 POST 到本腳本，沒有 paymentMethod 欄位，
// 也沒有 Netlify 幫它寄信。這類請求照舊寄店主通知與客人確認信；PR 合併上線後就不會再有這種請求。
var SHOP_EMAIL = 'canmas13@gmail.com';
var SHOP_NAME = '肯馬仕 CANMAS Coffee';
var BANK_INFO_TEXT = '銀行代碼：006（合作金庫 六家分行）\n帳戶號碼：3410-7172-16576\n戶名：肯馬仕有限公司';

function isLegacyRequest_(data) {
  return !data.action && !data.paymentMethod;
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function sendLegacyMails_(data) {
  var email = String(data.email || '').trim();
  var ts = data.timestamp || now_();
  var lines = [
    '訂單編號：' + (data.orderNo || ''),
    '下單時間：' + ts,
    '姓名：' + (data.name || ''),
    '電話：' + (data.phone || ''),
    'Email：' + email,
    '寄送地址：' + (data.address || ''),
    '訂購品項：' + (data.items || ''),
    '合計金額：$' + (data.total || 0),
    '備註：' + (data.note || '無')
  ];
  try {
    MailApp.sendEmail({ to: SHOP_EMAIL, subject: '【肯馬仕咖啡新訂單】' + (data.orderNo || ''), body: lines.join('\n') });
  } catch (e) { Logger.log('店主通知信發送失敗: ' + e.message); }

  if (!email) return;
  try {
    var plain = (data.name || '您好') + '，感謝您的訂購！\n\n' + lines.join('\n') +
      '\n\n請透過以下帳號完成匯款，並回覆本信告知匯款帳號後五碼，我們將儘快為您安排出貨：\n\n' + BANK_INFO_TEXT +
      '\n\n若有任何問題，歡迎直接回覆本信或聯繫 ' + SHOP_EMAIL + '。\n\n' + SHOP_NAME + ' 敬上';
    var html = '<div style="font-family:sans-serif;color:#222;line-height:1.8;max-width:560px;margin:0 auto;">' +
      '<h2 style="color:#B8860B;border-bottom:2px solid #D4A843;padding-bottom:10px;">訂單確認通知</h2>' +
      '<p>' + esc_(data.name || '您好') + '，感謝您的訂購！</p>' +
      '<p>' + lines.map(esc_).join('<br>') + '</p>' +
      '<div style="background:#f7f3ea;border:1px solid #D4A843;border-radius:8px;padding:14px 16px;margin:16px 0;">' +
      '<strong>匯款資訊</strong><br>' + esc_(BANK_INFO_TEXT).replace(/\n/g, '<br>') + '</div>' +
      '<p>完成匯款後，請回覆本信告知匯款帳號後五碼，我們將儘快為您安排出貨。</p>' +
      '<p style="color:#999;">' + esc_(SHOP_NAME) + ' 敬上</p></div>';
    MailApp.sendEmail({ to: email, subject: '【' + SHOP_NAME + '】訂單確認 - ' + (data.orderNo || ''), body: plain, htmlBody: html, name: SHOP_NAME, replyTo: SHOP_EMAIL });
  } catch (e) { Logger.log('訂購人確認信發送失敗: ' + e.message); }
}

// 瀏覽器開啟網址時的健康檢查（不碰試算表）
function doGet() {
  return out_({ status: 'ok', service: 'canmas-orders' });
}

// 手動測試：在編輯器選 testPost 按「執行」，會在「訂單記錄」「顧客資料」各寫一筆測試資料（不寄信）。
// 測完請自行刪除那兩列。
function testPost() {
  var id = 'CM-TEST-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd-HHmmss');
  var res = doPost({
    postData: {
      contents: JSON.stringify({
        orderNo: id,
        name: '測試伯樂',
        phone: '0912345678',
        email: 'unikch@gmail.com',
        address: '新竹縣竹北市光明六路東二段36號',
        items: '精品莊園咖啡豆（半磅×2）',
        total: 1200,
        note: '合併版 Apps Script 測試',
        status: '待匯款',
        paymentMethod: 'ATM匯款'
      })
    }
  });
  Logger.log(res.getContent());
}
