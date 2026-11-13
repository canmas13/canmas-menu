// POST /.netlify/functions/callback   ← 綠界 ReturnURL（伺服器對伺服器的付款結果通知）
// 規則：驗章 → 比對特店編號與金額 → 冪等處理（重複通知不會重複寄信）→ 一律回 1|OK（寄信失敗例外，讓綠界重送）
const { shop, ecpayConfig, notifyEmail } = require("../lib/config");
const { readBody } = require("../lib/http");
const { createBlobStore } = require("../lib/store");
const { callAppsScript } = require("../lib/sheet");
const { sendMail } = require("../lib/mailer");
const { verifyCheckMacValue } = require("../lib/ecpay");
const { settlePayment } = require("../lib/settle");
const { renderAlertEmail } = require("../lib/emailTemplates");

const defaultDeps = {
  shop,
  now: () => new Date(),
  openStore: (event) => createBlobStore(event),
  sheetUpdate: (payload) => callAppsScript(payload),
  sendMail: (msg) => sendMail(msg),
  ecpay: () => ecpayConfig(),
};

const plain = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "text/plain; charset=utf-8" },
  body,
});

function makeHandler(deps = defaultDeps) {
  async function alertOwner(title, lines) {
    try {
      const m = renderAlertEmail(title, lines, deps.shop);
      await deps.sendMail({ to: notifyEmail(), subject: m.subject, html: m.html, text: m.text });
    } catch (e) {
      console.error("警示信寄送失敗：", title, e.message);
    }
  }

  return async function handler(event) {
    if (event.httpMethod !== "POST") return plain(405, "Method Not Allowed");

    let cfg;
    try {
      cfg = deps.ecpay();
    } catch (e) {
      console.error(e.message);
      return plain(500, "0|Config Error");
    }

    try {
      const params = Object.fromEntries(new URLSearchParams(readBody(event)));
      const orderNo = params.MerchantTradeNo || "";

      if (!verifyCheckMacValue(params, cfg.hashKey, cfg.hashIV)) {
        console.error("CheckMacValue 驗證失敗", orderNo);
        return plain(400, "0|CheckMacValue Error");
      }
      if (params.MerchantID !== cfg.merchantId) {
        console.error("MerchantID 不符", params.MerchantID);
        return plain(400, "0|MerchantID Error");
      }

      const store = deps.openStore(event);
      // 儲存為最終一致，剛建立的訂單偶爾要等一下才讀得到；先重讀幾次再判定找不到
      const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
      let order = await store.get("order:" + orderNo);
      for (let i = 0; !order && i < 2; i++) {
        await sleep(1500);
        order = await store.get("order:" + orderNo);
      }
      if (!order) {
        await alertOwner("收到綠界付款通知，但找不到對應訂單", [
          `訂單編號：${orderNo}`,
          `綠界交易編號：${params.TradeNo || "-"}`,
          `金額：${params.TradeAmt || "-"}`,
          `結果：RtnCode=${params.RtnCode} ${params.RtnMsg || ""}`,
        ]);
        return plain(200, "1|OK"); // 已通知店主人工處理，不需要綠界重送
      }

      const outcome = await settlePayment({ order, params, store, deps, cfg, alertOwner });
      if (outcome === "mailError") return plain(500, "0|Mail Error"); // 讓綠界稍後重送
      return plain(200, "1|OK");
    } catch (e) {
      console.error("callback 失敗", e);
      return plain(500, "0|Error");
    }
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
