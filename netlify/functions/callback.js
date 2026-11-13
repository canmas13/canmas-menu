// POST /.netlify/functions/callback   ← 綠界 ReturnURL（伺服器對伺服器的付款結果通知）
// 規則：驗章 → 比對特店編號與金額 → 冪等處理（重複通知不會重複寄信）→ 一律回 1|OK（寄信失敗例外，讓綠界重送）
const { shop, ecpayConfig, notifyEmail } = require("../lib/config");
const { readBody } = require("../lib/http");
const { createBlobStore } = require("../lib/store");
const { callAppsScript, toSheetUpdate } = require("../lib/sheet");
const { sendMail } = require("../lib/mailer");
const { verifyCheckMacValue, formatTaipei, describePaymentType } = require("../lib/ecpay");
const { renderCustomerEmail, renderOwnerEmail, renderAlertEmail } = require("../lib/emailTemplates");

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

      // 付款未成功：只記錄，不通知客人
      if (params.RtnCode !== "1") {
        order.lastRtn = { code: params.RtnCode, msg: params.RtnMsg, at: deps.now().toISOString() };
        await store.set("order:" + orderNo, order).catch((e) => console.warn("記錄付款失敗狀態失敗", e.message));
        await deps
          .sheetUpdate(toSheetUpdate(order, `❌ 付款失敗（${params.RtnMsg || params.RtnCode}）`, { paymentType: params.PaymentType || "", paidAt: "" }))
          .catch((e) => console.error("更新 Sheet 失敗", e.message));
        return plain(200, "1|OK");
      }

      // 正式環境收到「模擬付款」通知一律不當作真的付款
      if (params.SimulatePaid === "1" && cfg.mode === "production") {
        await alertOwner("正式環境收到「模擬付款」通知，已忽略", [`訂單編號：${orderNo}`, "請勿出貨；若是你在綠界後台按了模擬付款，可忽略此信。"]);
        return plain(200, "1|OK");
      }

      // 金額必須與訂單一致
      if (Number(params.TradeAmt) !== order.total) {
        await alertOwner("付款金額與訂單不符，未標記為已付款", [
          `訂單編號：${orderNo}`,
          `訂單金額：${order.total}`,
          `綠界通知金額：${params.TradeAmt}`,
          "請登入綠界後台核對後再決定是否出貨。",
        ]);
        return plain(200, "1|OK");
      }

      // 第一次收到：標記已付款、更新 Sheet
      const firstTime = !order.paid;
      if (firstTime) {
        order.paid = true;
        order.paidAtText = params.PaymentDate || formatTaipei(deps.now());
        order.paymentTypeLabel = describePaymentType(params.PaymentType);
        order.tradeNo = params.TradeNo || "";
        order.status = `✅ 已付款（${order.paymentTypeLabel}）`;
        order.notified = order.notified || { customer: false, owner: false };
        order.notified.owner = false; // 付款成功要再通知店主一次
        await store.set("order:" + orderNo, order).catch((e) => console.error("儲存已付款狀態失敗", e.message));
        await deps
          .sheetUpdate(toSheetUpdate(order, order.status, { paymentType: order.paymentTypeLabel, paidAt: order.paidAtText }))
          .catch((e) => console.error("更新 Sheet 失敗", e.message));
      }

      // 只補寄還沒寄成功的信（重複通知或上次寄信失敗時才會走到）
      const jobs = [];
      if (!order.notified.customer) {
        const m = renderCustomerEmail(order, deps.shop);
        jobs.push(
          deps
            .sendMail({ to: order.customer.email, subject: m.subject, html: m.html, text: m.text })
            .then(() => (order.notified.customer = true))
            .catch((e) => console.error("寄付款成功信給客人失敗", orderNo, e.message))
        );
      }
      if (!order.notified.owner) {
        const m = renderOwnerEmail(order, deps.shop);
        jobs.push(
          deps
            .sendMail({ to: notifyEmail(), subject: m.subject, html: m.html, text: m.text })
            .then(() => (order.notified.owner = true))
            .catch((e) => console.error("寄付款成功信給店主失敗", orderNo, e.message))
        );
      }
      await Promise.all(jobs);
      if (jobs.length) await store.set("order:" + orderNo, order).catch((e) => console.warn("更新通知狀態失敗", e.message));

      if (!order.notified.customer || !order.notified.owner) return plain(500, "0|Mail Error"); // 讓綠界稍後重送
      return plain(200, "1|OK");
    } catch (e) {
      console.error("callback 失敗", e);
      return plain(500, "0|Error");
    }
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
