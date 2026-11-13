// POST /.netlify/functions/payment-result   ← 綠界 OrderResultURL
// 客人在綠界付款完成後，瀏覽器會帶著付款結果 POST 到這裡；驗章後結算（與 ReturnURL 共用邏輯、冪等），
// 再把客人導回下單的網站。這條路徑不依賴綠界伺服器能否連到我們。
const { shop, ecpayConfig } = require("../lib/config");
const { readBody } = require("../lib/http");
const { createBlobStore } = require("../lib/store");
const { callAppsScript } = require("../lib/sheet");
const { sendMail } = require("../lib/mailer");
const { verifyCheckMacValue } = require("../lib/ecpay");
const { settlePayment } = require("../lib/settle");
const { makeAlertOwner } = require("../lib/verify");

const defaultDeps = {
  shop,
  now: () => new Date(),
  openStore: (event) => createBlobStore(event),
  sheetUpdate: (payload) => callAppsScript(payload),
  sendMail: (msg) => sendMail(msg),
  ecpay: () => ecpayConfig(),
};

const ORDER_RE = /^CM[0-9A-Z]{6,20}$/;

function makeHandler(deps = defaultDeps) {
  return async function handler(event) {
    let orderNo = "";
    let base = deps.shop.brand.shopUrl;
    try {
      if (event.httpMethod === "POST") {
        const params = Object.fromEntries(new URLSearchParams(readBody(event)));
        orderNo = ORDER_RE.test(params.MerchantTradeNo || "") ? params.MerchantTradeNo : "";
        const cfg = deps.ecpay();
        if (orderNo && verifyCheckMacValue(params, cfg.hashKey, cfg.hashIV) && params.MerchantID === cfg.merchantId) {
          const store = deps.openStore(event);
          const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
          let order = await store.get("order:" + orderNo);
          for (let i = 0; !order && i < 2; i++) {
            await sleep(1000);
            order = await store.get("order:" + orderNo);
          }
          if (order) {
            if (order.returnBase) base = order.returnBase;
            await settlePayment({ order, params, store, deps, cfg, alertOwner: makeAlertOwner(deps) });
          }
        } else if (orderNo) {
          console.error("OrderResultURL 驗章或特店編號不符", orderNo);
        }
      }
    } catch (e) {
      console.error("payment-result 失敗", orderNo, e); // 仍導回網站，前端會再主動查詢
    }
    const location = base + "/" + (orderNo ? "?order=" + orderNo : "");
    return { statusCode: 303, headers: { Location: location, "Cache-Control": "no-store" }, body: "" };
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
