// netlify/functions/order.js
const crypto = require("crypto");

const ECPAY_MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const ECPAY_HASH_KEY    = process.env.ECPAY_HASH_KEY;
const ECPAY_HASH_IV     = process.env.ECPAY_HASH_IV;

// 強制鎖死綠界正式機網址
const ECPAY_HOST = "https://payment.ecpay.com.tw";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: "Method Not Allowed" };
  }

  try {
    // 加上環境變數防呆檢查，如果 Netlify 保險箱沒開成功，會直接在網頁報錯
    if (!ECPAY_MERCHANT_ID || !ECPAY_HASH_KEY || !ECPAY_HASH_IV) {
      throw new Error("綠界環境變數遺失，請檢查 Netlify 後台設定");
    }

    const data = JSON.parse(event.body);
    const { orderNo, total } = data;

    // 核心修正一：強制轉換為台灣時間 (UTC+8)，精準對齊綠界安檢
    const tradeDate = getTaiwanTradeDate();
    
    const returnURL = "https://canmasmenu.netlify.app/.netlify/functions/callback";
    const clientBackURL = "https://menu.canmas.com.tw";

    const params = {
      MerchantID:        ECPAY_MERCHANT_ID,
      MerchantTradeNo:   orderNo.replace(/-/g, "").substring(0, 20),
      MerchantTradeDate: tradeDate,
      PaymentType:       "aio",
      TotalAmount:       String(total),
      TradeDesc:         "CANMAS COFFEE",
      // 核心修正二：拔除所有中文特殊符號與空格，避免綠界亂碼誤判
      ItemName:          "CANMAS_COFFEE_ORDER",
      ReturnURL:         returnURL,
      OrderResultURL:    clientBackURL + "?order=" + orderNo,
      ChoosePayment:     "ALL", 
      EncryptType:       "1",
      ClientBackURL:     clientBackURL,
    };

    // 產生防偽檢查碼
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

// 專屬台灣時間轉換器
function getTaiwanTradeDate() {
  const now = new Date();
  const taiwanTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000));
  const pad = n => String(n).padStart(2, "0");
  return `${taiwanTime.getFullYear()}/${pad(taiwanTime.getMonth()+1)}/${pad(taiwanTime.getDate())} ${pad(taiwanTime.getHours())}:${pad(taiwanTime.getMinutes())}:${pad(taiwanTime.getSeconds())}`;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}
