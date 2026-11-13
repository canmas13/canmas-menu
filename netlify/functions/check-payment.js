// POST /.netlify/functions/check-payment  { orderNo }
// 客人從綠界回到網站時，前端呼叫這裡；後端主動向綠界查詢該訂單，已付款就結算（冪等）。
// 只回傳是否已付款，不回傳任何訂單內容。
const { shop, ecpayConfig } = require("../lib/config");
const { header, json, corsHeaders, clientIp, readBody } = require("../lib/http");
const { createBlobStore, rateLimit } = require("../lib/store");
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

function makeHandler(deps = defaultDeps) {
  return async function handler(event) {
    const origin = header(event, "origin");
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(origin), body: "" };
    if (event.httpMethod !== "POST") return json(405, { status: "error", message: "Method Not Allowed" }, origin);
    try {
      let orderNo = "";
      try {
        orderNo = String(JSON.parse(readBody(event) || "{}").orderNo || "");
      } catch {}
      if (!/^CM[0-9A-Z]{6,20}$/.test(orderNo)) return json(400, { status: "error", message: "訂單編號格式不正確" }, origin);
      const store = deps.openStore(event);
      const ok = await rateLimit(store, "chk:" + clientIp(event), { limit: 30, windowSec: 3600, nowMs: deps.now().getTime() });
      if (!ok) return json(429, { status: "error", message: "查詢過於頻繁" }, origin);
      const r = await verifyOrderPayment(orderNo, { store, deps });
      if (!r) return json(404, { status: "error", message: "找不到訂單" }, origin);
      return json(200, { status: "ok", orderNo, paid: r.paid }, origin);
    } catch (e) {
      console.error("check-payment 失敗", e);
      return json(200, { status: "ok", paid: false, unknown: true }, origin);
    }
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
