// netlify/functions/order.js
// 處理新訂單：寫入 Google Sheets + 產生綠界付款連結

const crypto = require("crypto");

// ── 環境變數（在 Netlify 後台設定，不寫在程式碼裡）──
const ECPAY_MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const ECPAY_HASH_KEY    = process.env.ECPAY_HASH_KEY;
const ECPAY_HASH_IV     = process.env.ECPAY_HASH_IV;
const ECPAY_PRODUCTION  = process.env.ECPAY_PRODUCTION === "true";
const APPS_SCRIPT_URL   = process.env.APPS_SCRIPT_URL;

const ECPAY_HOST = ECPAY_PRODUCTION
  ? "https://payment.ecpay.com.tw"
  : "https://payment-stage.ecpay.com.tw";

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body);
    const { orderNo, timestamp, name, phone, email, address, items, total, note } = data;

    // 1. 寫入 Google Sheets（非同步，不等待）
    if (APPS_SCRIPT_URL) {
      fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo, timestamp, name, phone, email, address, items, total, note, status: "待付款" })
      }).catch(e => console.error("Sheets寫入失敗:", e));
    }

    // 2. 產生綠界付款表單參數
    const now = new Date();
    const tradeDate = formatDate(now);
    const returnURL = `${process.env.URL}/.netlify/functions/callback`;
    const clientBackURL = process.env.SITE_URL || "https://menu.canmas.com.tw";

    const params = {
      MerchantID:        ECPAY_MERCHANT_ID,
      MerchantTradeNo:   orderNo.replace(/-/g, "").substring(0, 20),
      MerchantTradeDate: tradeDate,
      PaymentType:       "aio",
      TotalAmount:       String(total),
      TradeDesc:         "肯馬仕精品咖啡",
      ItemName:          items.substring(0, 200),
      ReturnURL:         returnURL,
      OrderResultURL:    clientBackURL + "?order=" + orderNo,
      ChoosePayment:     "ALL",
      EncryptType:       "1",
      ClientBackURL:     clientBackURL,
    };

    params.CheckMacValue = computeCheckMac(params);

    // 3. 產生自動提交的 HTML 付款頁面
    const paymentHTML = buildPaymentHTML(params);

    // 4. 將 HTML 編碼為 Base64 data URL
    const dataURL = "data:text/html;base64," + Buffer.from(paymentHTML).toString("base64");

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        status: "ok",
        orderNo,
        paymentHTML: paymentHTML,  // 直接回傳 HTML
        ecpayAction: ECPAY_HOST + "/Checkout/AioCheckout",
        ecpayParams: params
      })
    };

  } catch (err) {
    console.error("Order error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ status: "error", message: err.message })
    };
  }
};

// ── 計算 CheckMacValue ──
function computeCheckMac(params) {
  const keys = Object.keys(params)
    .filter(k => k !== "CheckMacValue")
    .sort();

  let str = "HashKey=" + ECPAY_HASH_KEY;
  keys.forEach(k => { str += "&" + k + "=" + params[k]; });
  str += "&HashIV=" + ECPAY_HASH_IV;

  str = encodeURIComponent(str)
    .replace(/%2d/gi, "-").replace(/%5f/gi, "_")
    .replace(/%2e/gi, ".").replace(/%21/gi, "!")
    .replace(/%2a/gi, "*").replace(/%28/gi, "(")
    .replace(/%29/gi, ")").toLowerCase();

  return crypto.createHash("sha256").update(str).digest("hex").toUpperCase();
}

// ── 產生付款 HTML ──
function buildPaymentHTML(params) {
  const action = ECPAY_HOST + "/Checkout/AioCheckout";
  const inputs = Object.keys(params)
    .map(k => `<input type="hidden" name="${k}" value="${params[k]}">`)
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>肯馬仕咖啡 — 前往付款</title>
<style>
  body{background:#111E4A;color:#EEE8D8;font-family:sans-serif;
    display:flex;align-items:center;justify-content:center;
    min-height:100vh;flex-direction:column;gap:16px;}
  .logo{font-size:22px;color:#D4A843;letter-spacing:0.1em;}
  .msg{font-size:15px;color:#B8C8E8;}
  .spinner{width:36px;height:36px;border:3px solid rgba(212,168,67,0.3);
    border-top-color:#D4A843;border-radius:50%;animation:spin 0.8s linear infinite;}
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

// ── 格式化日期 ──
function formatDate(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── CORS headers ──
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}
