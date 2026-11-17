// 排程（每 10 分鐘，見 netlify.toml；只在正式部署執行）：
// 找出 26 小時內建立、尚未付款的信用卡訂單，主動向綠界查詢，已付款就結算。
// 用來補上「綠界伺服器通知沒送到、客人付款後又直接關掉頁面」的情況。
// 順便清掉超過保存期限（預設 90 天）的訂單暫存與過期的限流紀錄：客戶個資不永久留在 Netlify（正式紀錄在 Google Sheet）。
const { shop, ecpayConfig } = require("../lib/config");
const { createBlobStore } = require("../lib/store");
const { callAppsScript } = require("../lib/sheet");
const { sendMail } = require("../lib/mailer");
const { verifyOrderPayment } = require("../lib/verify");

const defaultDeps = {
  shop,
  now: () => new Date(),
  openStore: (event) => createBlobStore(event),
  sheetUpdate: (payload) => callAppsScript(payload),
  sendMail: (msg) => sendMail(msg),
  ecpay: () => ecpayConfig(),
};

const RETENTION_DAYS = 90;

function makeHandler(deps = defaultDeps) {
  return async function handler(event) {
    const store = deps.openStore(event);
    const now = deps.now().getTime();
    const retentionMs = (Number(deps.retentionDays) || RETENTION_DAYS) * 86400 * 1000;
    let checked = 0, settled = 0, purged = 0;
    const keys = await store.list("order:");
    for (const key of keys) {
      const order = await store.get(key).catch(() => null);
      if (!order) continue;
      const age = now - Date.parse(order.createdAt || 0);
      if (age > retentionMs && purged < 100) {
        await store.delete(key).then(() => purged++).catch((e) => console.warn("清除過期訂單暫存失敗", key, e.message));
        continue;
      }
      if (checked >= 60 || order.paid || order.paymentMethod !== "card") continue;
      if (!(age > 2 * 60 * 1000 && age < 26 * 3600 * 1000)) continue;
      checked++;
      try {
        const r = await verifyOrderPayment(order.orderNo, { store, deps });
        if (r && r.paid) settled++;
      } catch (e) {
        console.error("對帳查詢失敗", order.orderNo, e.message);
      }
    }
    // 限流紀錄過期就沒用了，一併清掉
    for (const key of await store.list("rl:")) {
      const rec = await store.get(key).catch(() => null);
      if (rec && rec.resetAt && rec.resetAt < now) await store.delete(key).catch(() => {});
    }
    console.log(`對帳完成：查詢 ${checked} 筆，補登已付款 ${settled} 筆，清除過期暫存 ${purged} 筆`);
    return { statusCode: 200, body: JSON.stringify({ checked, settled, purged }) };
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
