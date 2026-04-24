// =============================================
// CANMAS Coffee — Google Apps Script
// 功能：
//   1. 接收訂單 → 寫入 Google Sheets
//   2. 建立綠界付款連結 → 透過 LINE 傳給客人
//   3. 接收綠界付款回呼 → 更新訂單狀態
//   4. Gmail + LINE Notify 新訂單通知
// =============================================

// ── 設定區 ──────────────────────────────────
const SPREADSHEET_ID  = "1WTt3GZ7WDMXpeFh-j1btJB28z8aHwRobE4GaJuEr_XY";
const LINE_NOTIFY_TOKEN = "const LINE_NOTIFY_TOKEN = "WIUaYt/xGyngnzUy+81LpYyxml0owSZhr30oMvsZNyG2sDpQLi/nMyfuFYW+GMpZMhaaq+9bzywcxJ8ZFcbLmNI4X7ZJyle7ldIOg0Bhl8J3tovmTiLFb+Gz9x382XQBPNzVuyTVy6dAmgf91upVSAdB04t89/1O/w1cDnyilFU=";  // 填入您的 LINE Notify Token
";        // 填入您的 LINE Notify Token
const NOTIFY_EMAIL      = "canmas13@gmail.com";

// 綠界設定
const ECPAY_MERCHANT_ID = "3419991";
const ECPAY_HASH_KEY    = "Ncehlnu02QkUTdl0";
const ECPAY_HASH_IV     = "g92Gx6DQVKCJPmSv";

// 正式環境 → true；測試環境 → false
const ECPAY_PRODUCTION  = false;
const ECPAY_HOST        = ECPAY_PRODUCTION
  ? "https://payment.ecpay.com.tw"
  : "https://payment-stage.ecpay.com.tw";

// ─────────────────────────────────────────────

// =============================================
// doPost：接收前端訂單 & 綠界回呼
// =============================================
function doPost(e) {
  try {
    const raw = e.postData.contents;

    // 綠界付款回呼（form-urlencoded）
    if (e.contentType && e.contentType.includes("application/x-www-form-urlencoded")) {
      return handleEcpayCallback(e.parameters);
    }

    // 前端訂單（JSON）
    const data = JSON.parse(raw);
    return handleNewOrder(data);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =============================================
// doGet：豆單資料 / 付款頁面 / 綠界回呼
// =============================================
function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};

  // 1. 前端請求豆單資料
  if (p.action === "menu") {
    return serveMenuData();
  }

  // 2. 付款頁面
  if (p.pay) {
    return servePaymentPage(decodeURIComponent(p.pay));
  }

  // 3. 綠界回呼（GET）
  if (p.MerchantTradeNo) {
    return handleEcpayCallback(p);
  }

  return ContentService.createTextOutput("CANMAS Payment Service");
}

// ── 回傳豆單 JSON（從 canmas_coffee_beans 工作表）──
function serveMenuData() {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("canmas_coffee_beans");
    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "找不到豆單工作表" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const rows    = sheet.getDataRange().getValues();
    const headers = rows[0].map(h => h.toString().trim());
    const data    = rows.slice(1)
      .filter(r => r[headers.indexOf("name")] !== "")
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i].toString().trim() : ""; });
        ["soldOut","presale","award"].forEach(k => {
          obj[k] = (obj[k] || "").toUpperCase() === "TRUE";
        });
        return obj;
      });
    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", data: data }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── 輸出付款 HTML 頁面 ──
function servePaymentPage(orderNo) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("付款頁面暫存");
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === orderNo) {
        return HtmlService.createHtmlOutput(data[i][1]);
      }
    }
  }
  return HtmlService.createHtmlOutput("<h2 style=\'font-family:sans-serif;padding:2rem;\'>付款連結已失效，請重新下單</h2>");
}

// =============================================
// 處理新訂單
// =============================================
function handleNewOrder(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. 寫入訂單記錄
  writeOrder(ss, data);

  // 2. 建立或更新顧客資料
  upsertCustomer(ss, data);

  // 3. 產生綠界付款連結
  const paymentURL = createEcpayPaymentURL(data);

  // 4. 發送通知給 David（Gmail + LINE Notify）
  sendOwnerNotification(data, paymentURL);

  // 5. 回傳付款連結給前端
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", paymentURL: paymentURL, orderNo: data.orderNo }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================
// 建立綠界付款連結
// =============================================
function createEcpayPaymentURL(data) {
  const now = new Date();
  const tradeDate = Utilities.formatDate(now, "Asia/Taipei", "yyyy/MM/dd HH:mm:ss");

  // 取得部署網址作為回呼 URL
  const scriptURL = ScriptApp.getService().getUrl();

  const params = {
    MerchantID:        ECPAY_MERCHANT_ID,
    MerchantTradeNo:   data.orderNo.replace("-", "").substring(0, 20), // 最多20碼，不含特殊符號
    MerchantTradeDate: tradeDate,
    PaymentType:       "aio",
    TotalAmount:       String(data.total),
    TradeDesc:         encodeURIComponent("肯馬仕精品咖啡"),
    ItemName:          data.items.substring(0, 200),
    ReturnURL:         scriptURL,           // 付款完成回呼
    OrderResultURL:    scriptURL,           // 客人付款後跳轉頁面
    ChoosePayment:     "ALL",               // 全支付方式
    EncryptType:       "1",                 // SHA256
    ClientBackURL:     "https://menu.canmas.com.tw",
  };

  // 計算 CheckMacValue
  params.CheckMacValue = computeCheckMac(params);

  // 建立自動提交表單的 HTML 頁面（Google Apps Script 作為中介）
  const formHTML = buildPaymentForm(params);

  // 將表單存到試算表暫存，前端取得網址後導向
  const paymentPageURL = createPaymentPage(data.orderNo, formHTML);
  return paymentPageURL;
}

// =============================================
// 計算 CheckMacValue（SHA256）
// =============================================
function computeCheckMac(params) {
  // 排除 CheckMacValue 本身
  const keys = Object.keys(params).filter(k => k !== "CheckMacValue").sort();

  let str = "HashKey=" + ECPAY_HASH_KEY;
  keys.forEach(k => { str += "&" + k + "=" + params[k]; });
  str += "&HashIV=" + ECPAY_HASH_IV;

  // URL Encode（綠界規則）
  str = encodeURIComponent(str)
    .replace(/%2d/gi, "-")
    .replace(/%5f/gi, "_")
    .replace(/%2e/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2a/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .toLowerCase();

  // SHA256
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    str,
    Utilities.Charset.UTF_8
  );

  return digest.map(b => ("0" + (b & 0xff).toString(16)).slice(-2)).join("").toUpperCase();
}

// =============================================
// 建立付款表單 HTML
// =============================================
function buildPaymentForm(params) {
  const action = ECPAY_HOST + "/Checkout/AioCheckout";
  let inputs = "";
  Object.keys(params).forEach(k => {
    inputs += `<input type="hidden" name="${k}" value="${params[k]}">`;
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>肯馬仕咖啡 — 前往付款</title>
<style>
  body{background:#111E4A;color:#EEE8D8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}
  .logo{font-size:22px;color:#D4A843;letter-spacing:0.1em;}
  .msg{font-size:15px;color:#B8C8E8;}
  .spinner{width:36px;height:36px;border:3px solid rgba(212,168,67,0.3);border-top-color:#D4A843;border-radius:50%;animation:spin 0.8s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg);}}
</style>
</head>
<body>
  <div class="logo">CANMAS COFFEE</div>
  <div class="spinner"></div>
  <div class="msg">正在前往付款頁面，請稍候…</div>
  <form id="f" action="${action}" method="POST">${inputs}</form>
  <script>window.onload=()=>document.getElementById('f').submit();</script>
</body>
</html>`;
}

// =============================================
// 將付款頁面存入試算表，回傳可存取的 URL
// =============================================
function createPaymentPage(orderNo, html) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName("付款頁面暫存");
  if (!sheet) {
    sheet = ss.insertSheet("付款頁面暫存");
    sheet.appendRow(["訂單編號", "HTML內容", "建立時間"]);
    sheet.setFrozenRows(1);
  }

  // 檢查是否已存在
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderNo) {
      sheet.getRange(i + 1, 2).setValue(html);
      sheet.getRange(i + 1, 3).setValue(new Date());
      break;
    }
  }
  sheet.appendRow([orderNo, html, new Date()]);

  // 回傳 Apps Script doGet 的付款頁面 URL
  const scriptURL = ScriptApp.getService().getUrl();
  return scriptURL + "?pay=" + encodeURIComponent(orderNo);
}



// =============================================
// 處理綠界付款回呼
// =============================================
function handleEcpayCallback(params) {
  const tradeNo    = params.MerchantTradeNo;
  const rtnCode    = params.RtnCode;    // 1 = 付款成功
  const rtnMsg     = params.RtnMsg;
  const tradeAmt   = params.TradeAmt;
  const paymentType = params.PaymentType;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("訂單記錄");
  if (!sheet) return ContentService.createTextOutput("1|OK");

  const data = sheet.getDataRange().getValues();
  const now  = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });

  for (let i = 1; i < data.length; i++) {
    // 比對訂單編號（去掉橫線後比對）
    const storedNo = String(data[i][0]).replace("-", "");
    if (storedNo === tradeNo || data[i][0] === tradeNo) {
      const newStatus = rtnCode === "1" ? "✅ 已付款" : "❌ 付款失敗（" + rtnMsg + "）";
      sheet.getRange(i + 1, 10).setValue(newStatus);          // 狀態欄
      sheet.getRange(i + 1, 11).setValue(paymentType || "");  // 付款方式
      sheet.getRange(i + 1, 12).setValue(now);                // 付款時間

      // 付款成功 → 通知 David
      if (rtnCode === "1") {
        const orderNo = data[i][0];
        const name    = data[i][2];
        const items   = data[i][6];
        const total   = data[i][7];
        sendPaymentSuccessNotification(orderNo, name, items, total, paymentType, now);
      }
      break;
    }
  }

  // 必須回傳 1|OK 告知綠界處理完成
  return ContentService.createTextOutput("1|OK");
}

// =============================================
// 訂單記錄表
// =============================================
function writeOrder(ss, data) {
  let sheet = ss.getSheetByName("訂單記錄");
  if (!sheet) {
    sheet = ss.insertSheet("訂單記錄");
    sheet.appendRow([
      "訂單編號","下單時間","姓名","電話","Email",
      "寄送地址","品項","合計金額","備註","狀態","付款方式","付款時間"
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,12).setBackground("#162258").setFontColor("#D4A843").setFontWeight("bold");
  }
  sheet.appendRow([
    data.orderNo || "",
    data.timestamp || new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei"}),
    data.name || "",
    data.phone || "",
    data.email || "",
    data.address || "",
    data.items || "",
    data.total || 0,
    data.note || "",
    "⏳ 待付款",
    "",
    ""
  ]);
}

// =============================================
// 顧客資料表
// =============================================
function upsertCustomer(ss, data) {
  let sheet = ss.getSheetByName("顧客資料");
  if (!sheet) {
    sheet = ss.insertSheet("顧客資料");
    sheet.appendRow([
      "顧客編號","姓名","電話","Email",
      "常用地址","首次下單","最近下單","累計訂單數","累計消費金額","備註"
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,10).setBackground("#162258").setFontColor("#D4A843").setFontWeight("bold");
  }

  const phone = data.phone || "";
  if (!phone) return;

  const allData = sheet.getDataRange().getValues();
  const now = new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei"});
  const total = Number(data.total) || 0;

  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][2]) === String(phone)) {
      const row = i + 1;
      sheet.getRange(row, 7).setValue(now);
      sheet.getRange(row, 8).setValue(allData[i][7] + 1);
      sheet.getRange(row, 9).setValue(allData[i][8] + total);
      if (!allData[i][3] && data.email)   sheet.getRange(row, 4).setValue(data.email);
      if (!allData[i][4] && data.address) sheet.getRange(row, 5).setValue(data.address);
      return;
    }
  }

  const customerNo = "C" + String(allData.length).padStart(4, "0");
  sheet.appendRow([customerNo, data.name||"", phone, data.email||"", data.address||"", now, now, 1, total, ""]);
}

// =============================================
// 通知 David — 新訂單
// =============================================
function sendOwnerNotification(data, paymentURL) {
  const msg =
    "【肯馬仕新訂單】\n" +
    "訂單：" + data.orderNo + "\n" +
    "姓名：" + data.name + "\n" +
    "電話：" + data.phone + "\n" +
    "品項：" + data.items + "\n" +
    "合計：$" + data.total + "\n" +
    "時間：" + data.timestamp + "\n" +
    "付款連結已傳送給客人";

  // Gmail
  try {
    GmailApp.sendEmail(
      NOTIFY_EMAIL,
      "【肯馬仕新訂單】" + data.orderNo + " — $" + data.total,
      msg
    );
  } catch(e) { Logger.log("Gmail失敗: " + e); }

  // LINE Notify
  if (LINE_NOTIFY_TOKEN) {
    try {
      UrlFetchApp.fetch("https://notify-api.line.me/api/notify", {
        method: "post",
        headers: { "Authorization": "Bearer " + LINE_NOTIFY_TOKEN },
        payload: { message: "\n" + msg }
      });
    } catch(e) { Logger.log("LINE Notify失敗: " + e); }
  }
}

// =============================================
// 通知 David — 付款成功
// =============================================
function sendPaymentSuccessNotification(orderNo, name, items, total, paymentType, paidAt) {
  const msg =
    "💰【付款成功】\n" +
    "訂單：" + orderNo + "\n" +
    "姓名：" + name + "\n" +
    "品項：" + items + "\n" +
    "金額：$" + total + "\n" +
    "方式：" + (paymentType || "未知") + "\n" +
    "時間：" + paidAt;

  try {
    GmailApp.sendEmail(NOTIFY_EMAIL, "💰【肯馬仕付款成功】" + orderNo, msg);
  } catch(e) {}

  if (LINE_NOTIFY_TOKEN) {
    try {
      UrlFetchApp.fetch("https://notify-api.line.me/api/notify", {
        method: "post",
        headers: { "Authorization": "Bearer " + LINE_NOTIFY_TOKEN },
        payload: { message: "\n" + msg }
      });
    } catch(e) {}
  }
}

// =============================================
// 測試用
// =============================================
function testNewOrder() {
  const fakeData = {
    orderNo:   "CM260424-8888",
    timestamp: new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei"}),
    name:      "測試顧客",
    phone:     "0900000000",
    email:     "test@example.com",
    address:   "新竹縣竹北市光明六路東二段1號",
    items:     "衣索耶加雪菲果丁丁（半磅×1）、哥倫比亞梅德琪（一磅×1）",
    total:     1430,
    note:      "淺焙",
    status:    "待付款"
  };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  writeOrder(ss, fakeData);
  upsertCustomer(ss, fakeData);

  const payURL = createEcpayPaymentURL(fakeData);
  Logger.log("付款連結：" + payURL);
  Logger.log("測試完成，請查看試算表與上方連結");
}
