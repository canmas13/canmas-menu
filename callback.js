// netlify/functions/callback.js
// 接收綠界付款結果回呼

const crypto = require("crypto");

const ECPAY_MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const ECPAY_HASH_KEY    = process.env.ECPAY_HASH_KEY;
const ECPAY_HASH_IV     = process.env.ECPAY_HASH_IV;
const APPS_SCRIPT_URL   = process.env.APPS_SCRIPT_URL;
const LINE_NOTIFY_TOKEN = process.env.LINE_NOTIFY_TOKEN;
const NOTIFY_EMAIL      = process.env.NOTIFY_EMAIL || "canmas13@gmail.com";

exports.handler = async (event) => {
  try {
    // 解析綠界回傳的 form data
    const params = parseFormData(event.body);
    const { MerchantTradeNo, RtnCode, RtnMsg, TradeAmt, PaymentType, CheckMacValue } = params;

    // 驗證 CheckMacValue
    const computed = computeCheckMac(params);
    if (computed !== CheckMacValue) {
      console.error("CheckMacValue 驗證失敗");
      return { statusCode: 200, body: "0|Error" };
    }

    const isPaid = RtnCode === "1";
    const status = isPaid ? "✅ 已付款" : `❌ 付款失敗（${RtnMsg}）`;
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });

    // 通知 Apps Script 更新訂單狀態
    if (APPS_SCRIPT_URL) {
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateOrder",
          orderNo: MerchantTradeNo,
          status,
          paymentType: PaymentType,
          paidAt: now
        })
      }).catch(e => console.error("更新訂單失敗:", e));
    }

    // 付款成功 → 通知 David
    if (isPaid) {
      const msg = `💰【肯馬仕付款成功】\n訂單：${MerchantTradeNo}\n金額：$${TradeAmt}\n方式：${PaymentType}\n時間：${now}`;

      // LINE Notify
      if (LINE_NOTIFY_TOKEN) {
        await fetch("https://notify-api.line.me/api/notify", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + LINE_NOTIFY_TOKEN,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: "message=" + encodeURIComponent("\n" + msg)
        }).catch(e => console.error("LINE Notify失敗:", e));
      }
    }

    // 必須回傳 1|OK 給綠界
    return { statusCode: 200, body: "1|OK" };

  } catch (err) {
    console.error("Callback error:", err);
    return { statusCode: 200, body: "0|Error" };
  }
};

function parseFormData(body) {
  const result = {};
  if (!body) return result;
  body.split("&").forEach(pair => {
    const [k, v] = pair.split("=");
    result[decodeURIComponent(k)] = decodeURIComponent((v || "").replace(/\+/g, " "));
  });
  return result;
}

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
