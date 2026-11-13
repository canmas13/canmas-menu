// 主動向綠界查詢並結算：用於付款後導回（check-payment）與排程對帳（reconcile），
// 不依賴綠界伺服器通知（ReturnURL）是否送得到。
const { queryTradeInfo, queryToNotice } = require("./ecpay");
const { settlePayment } = require("./settle");
const { notifyEmail } = require("./config");
const { renderAlertEmail } = require("./emailTemplates");

function makeAlertOwner(deps) {
  return async function alertOwner(title, lines) {
    try {
      const m = renderAlertEmail(title, lines, deps.shop);
      await deps.sendMail({ to: notifyEmail(), subject: m.subject, html: m.html, text: m.text });
    } catch (e) {
      console.error("警示信寄送失敗：", title, e.message);
    }
  };
}

// 回傳 { paid, tradeStatus }；找不到訂單回傳 null
async function verifyOrderPayment(orderNo, { store, deps }) {
  const order = await store.get("order:" + orderNo);
  if (!order) return null;
  if (order.paid) return { paid: true, tradeStatus: "1" };
  if (order.paymentMethod !== "card") return { paid: false, tradeStatus: "" };
  const cfg = deps.ecpay();
  const q = await (deps.queryTradeInfo || queryTradeInfo)(cfg, orderNo, { fetchImpl: deps.fetchImpl });
  if (q.TradeStatus !== "1") return { paid: false, tradeStatus: q.TradeStatus };
  await settlePayment({ order, params: queryToNotice(q), store, deps, cfg, alertOwner: makeAlertOwner(deps) });
  return { paid: Boolean(order.paid), tradeStatus: "1" };
}

module.exports = { verifyOrderPayment, makeAlertOwner };
