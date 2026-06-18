// netlify/functions/order.js
const crypto = require("crypto");

const ECPAY_MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const ECPAY_HASH_KEY    = process.env.ECPAY_HASH_KEY;
const ECPAY_HASH_IV     = process.env.ECPAY_HASH_IV;

// 🏆 強制寫死正式機網址，徹底排除測試機房干擾
const ECPAY_HOST = "https://payment.ecpay.com.tw";

exports.handler = async (event) => {
  // CORS 預檢請求
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  // 阻擋非 POST 請求
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body);
    const { orderNo, total } = data;

    const now = new Date();
    const tradeDate = formatDate(now);
    
    // 返回網址設定
    const returnURL = "https://canmasmenu.netlify.app/.netlify/functions/callback";
    const clientBackURL = "https://menu.canmas.com.tw";

    const params = {
      MerchantID:        ECPAY_MERCHANT_ID,
      MerchantTradeNo:   orderNo.replace(/-/g, "").substring(0, 20),
      MerchantTradeDate: tradeDate,
      PaymentType:       "aio",
      TotalAmount:       String(total),
      TradeDesc:         "CANMAS COFFEE",
      // 🏆 綠界對商品名稱的符號極度敏感，為求絕對穩定，改用統一名稱
      ItemName:          "肯馬仕精品咖啡 - 訂單商品",
      ReturnURL:         returnURL,
      OrderResultURL:    clientBackURL + "?order=" + orderNo,
      ChoosePayment:     "Credit", // 精準指定信用卡
      EncryptType:       "1",
      ClientBackURL:     clientBackURL,
    };

    // 計算檢查碼
    params.CheckMacValue = computeCheckMac(params);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        status: "ok",
        orderNo,
        ecpayAction: ECPAY_HOST + "/Checkout/AioCheckout",
        ecpayParams: params
      })
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ status: "error", message: err.message }) };
  }
};

function computeCheckMac(params) {
  const keys = Object.keys(params).filter(k => k !== "CheckMacValue").sort();
  let str = "HashKey=" + ECPAY_HASH_KEY;
  keys.forEach(k => { str += "&" + k + "=" + params[k]; });
  str += "&HashIV=" + ECPAY_HASH_IV;
  str = encodeURIComponent(str).replace(/%2d/gi, "-").replace(/%5f/gi, "_").replace(/%2e/gi, ".").replace(/%21/gi, "!").replace(/%2a/gi, "*").replace(/%28/gi, "(").replace(/%29/gi, ")").toLowerCase();
  return crypto.createHash("sha256").update(str).digest("hex").toUpperCase();
}

function formatDate(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}
