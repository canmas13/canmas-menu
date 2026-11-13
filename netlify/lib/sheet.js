// Google Apps Script 客戶端：把訂單寫入 / 更新 Google Sheet
// 沿用既有的 Apps Script 介面（POST text/plain，內容為 JSON，回傳 {status:"ok"}）
const { appsScriptUrl } = require("./config");

async function callAppsScript(payload, { fetchImpl = fetch, url = appsScriptUrl(), secret = process.env.APPS_SCRIPT_SECRET } = {}) {
  // 若設了 APPS_SCRIPT_SECRET，隨請求附上；新版 Apps Script 設了同值的 SECRET 後只收這種請求
  const body = secret ? { ...payload, secret } : payload;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error("Apps Script 回應不是 JSON：" + text.slice(0, 120));
    }
    if (result.status !== "ok") throw new Error("Apps Script 回報錯誤：" + (result.message || "未知"));
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// 新訂單：欄位維持原本 Apps Script 已在用的格式，另附帶幾個新欄位
function toSheetRow(order, statusText) {
  const items =
    order.lines.map((l) => `${l.name}（${l.size}${l.roast ? "・" + l.roast : ""}×${l.qty}）`).join("、") +
    (order.shipping > 0 ? `、運費 $${order.shipping}` : "");
  return {
    orderNo: order.orderNo,
    timestamp: order.createdAtText,
    name: order.customer.name,
    phone: order.customer.phone,
    email: order.customer.email,
    address: order.customer.address,
    items,
    total: order.total,
    note: order.customer.note,
    status: statusText,
    // 以下為新增欄位（舊版 Apps Script 會直接忽略）
    subtotal: order.subtotal,
    shipping: order.shipping,
    paymentMethod: order.paymentMethod === "card" ? "信用卡" : "ATM匯款",
  };
}

// 更新既有訂單的狀態（付款成功／失敗）。
// 新版 Apps Script 看 action === "updateOrder" 就原地更新那一列；
// 同時附上完整訂單欄位，萬一接到的是不認得 action 的舊腳本（會當成新訂單寫入一列），
// 多出來的那一列也是內容完整、狀態正確的紀錄，而不是只有訂單編號的空白列。
function toSheetUpdate(order, statusText, { paymentType = "", paidAt = "" } = {}) {
  return {
    ...toSheetRow(order, statusText),
    action: "updateOrder",
    status: statusText,
    paymentType,
    paidAt,
  };
}

module.exports = { callAppsScript, toSheetRow, toSheetUpdate };
