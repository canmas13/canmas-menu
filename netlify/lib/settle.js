// 付款結果的共用處理：ReturnURL（綠界伺服器通知）、OrderResultURL（付款後瀏覽器導回）、
// 主動查詢（check-payment／排程對帳）都走這裡，冪等，重複呼叫不會重複寄信。
// 回傳："ok"（已處理或不需處理）、"mailError"（寄信失敗，可稍後重試）
const { notifyEmail } = require("./config");
const { toSheetUpdate } = require("./sheet");
const { formatTaipei, describePaymentType } = require("./ecpay");
const { renderCustomerEmail, renderOwnerEmail } = require("./emailTemplates");

async function settlePayment({ order, params, store, deps, cfg, alertOwner }) {
  const orderNo = order.orderNo;
  // 付款未成功：只記錄，不通知客人（已付款的訂單不會被之後的失敗通知覆蓋）
  if (params.RtnCode !== "1") {
    if (order.paid) return "ok";
    order.lastRtn = { code: params.RtnCode, msg: params.RtnMsg, at: deps.now().toISOString() };
    await store.set("order:" + orderNo, order).catch((e) => console.warn("記錄付款失敗狀態失敗", e.message));
    await deps
      .sheetUpdate(toSheetUpdate(order, `❌ 付款失敗（${params.RtnMsg || params.RtnCode}）`, { paymentType: params.PaymentType || "", paidAt: "" }))
      .catch((e) => console.error("更新 Sheet 失敗", e.message));
    return "ok";
  }

  // 正式環境收到「模擬付款」通知一律不當作真的付款
  if (params.SimulatePaid === "1" && cfg.mode === "production") {
    await alertOwner("正式環境收到「模擬付款」通知，已忽略", [`訂單編號：${orderNo}`, "請勿出貨；若是你在綠界後台按了模擬付款，可忽略此信。"]);
    return "ok";
  }

  // 金額必須與訂單一致
  if (Number(params.TradeAmt) !== order.total) {
    await alertOwner("付款金額與訂單不符，未標記為已付款", [
      `訂單編號：${orderNo}`,
      `訂單金額：${order.total}`,
      `綠界通知金額：${params.TradeAmt}`,
      "請登入綠界後台核對後再決定是否出貨。",
    ]);
    return "ok";
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

  return !order.notified.customer || !order.notified.owner ? "mailError" : "ok";
}

module.exports = { settlePayment };
