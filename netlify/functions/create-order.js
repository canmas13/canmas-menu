// POST /.netlify/functions/create-order
// 前端「確認送出」唯一的入口：驗證 → 後端重算金額 → 建立訂單 → 通知 →（信用卡）回傳綠界表單參數
const { shop, ecpayConfig, sheetCsvUrl, notifyEmail, env } = require("../lib/config");
const { UserError } = require("../lib/errors");
const { header, json, corsHeaders, clientIp, readBody } = require("../lib/http");
const { validateCustomer, validatePaymentMethod } = require("../lib/validate");
const { fetchCatalog } = require("../lib/catalog");
const { priceCart, generateOrderNo } = require("../lib/pricing");
const { createBlobStore, rateLimit } = require("../lib/store");
const { callAppsScript, toSheetRow } = require("../lib/sheet");
const { sendMail } = require("../lib/mailer");
const { buildCheckoutParams, formatTaipei } = require("../lib/ecpay");
const { renderCustomerEmail, renderOwnerEmail } = require("../lib/emailTemplates");

const defaultDeps = {
  shop,
  now: () => new Date(),
  openStore: (event) => createBlobStore(event),
  getProducts: () => fetchCatalog(sheetCsvUrl()),
  sheetAppend: (row) => callAppsScript(row),
  sendMail: (msg) => sendMail(msg),
  ecpay: () => ecpayConfig(),
  generateOrderNo: () => generateOrderNo(),
};

// 綠界付款結果通知（ReturnURL）要打到「這個函式所在的網址」，部署預覽也能自己測
function callbackUrl(event) {
  const override = env("CALLBACK_BASE_URL");
  let base;
  if (override) base = override.replace(/\/$/, "");
  else {
    const host = header(event, "x-forwarded-host") || header(event, "host") || "";
    base = /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? "https://" + host : "https://canmasmenu.netlify.app";
  }
  return base + "/.netlify/functions/callback";
}

function makeHandler(deps = defaultDeps) {
  return async function handler(event) {
    const origin = header(event, "origin");
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(origin), body: "" };
    if (event.httpMethod !== "POST") return json(405, { status: "error", message: "Method Not Allowed" }, origin);

    try {
      const raw = readBody(event);
      if (raw.length > 20000) throw new UserError("資料過大", 413);
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        throw new UserError("資料格式錯誤");
      }
      // 蜜罐欄位：真人看不到也不會填，機器人填了就假裝成功並丟棄
      if (input.hp) return json(200, { status: "ok", ignored: true }, origin);

      const paymentMethod = validatePaymentMethod(input.paymentMethod);
      const customer = validateCustomer(input.customer);
      const now = deps.now();
      const store = deps.openStore(event);

      const ipOk = await rateLimit(store, "ip:" + clientIp(event), { limit: 8, windowSec: 3600, nowMs: now.getTime() });
      const mailOk = await rateLimit(store, "mail:" + customer.email, { limit: 4, windowSec: 3600, nowMs: now.getTime() });
      if (!ipOk || !mailOk) throw new UserError("操作過於頻繁，請稍後再試，或直接聯繫我們", 429);

      const products = await deps.getProducts();
      const quote = priceCart(input.items, products, deps.shop);

      const orderNo = deps.generateOrderNo();
      const order = {
        orderNo,
        createdAt: now.toISOString(),
        createdAtText: formatTaipei(now).slice(0, 16),
        customer,
        lines: quote.lines,
        subtotal: quote.subtotal,
        shipping: quote.shipping,
        total: quote.total,
        paymentMethod,
        paid: false,
        status: paymentMethod === "card" ? "待付款（信用卡）" : "待匯款",
        notified: { customer: false, owner: false },
      };

      // 先存一份，之後綠界的付款通知才找得回訂單內容
      try {
        await store.set("order:" + orderNo, order);
      } catch (e) {
        console.error("訂單暫存失敗", orderNo, e);
        if (paymentMethod === "card") {
          throw new UserError("系統暫時無法建立付款，請稍後再試，或改用 ATM 匯款", 503);
        }
      }

      // 寫入 Google Sheet 與寄信給店主同時進行；只要其中一個成功，訂單就不會遺失
      const ownerMail = renderOwnerEmail(order, deps.shop);
      const [sheetRes, ownerRes] = await Promise.allSettled([
        deps.sheetAppend(toSheetRow(order, order.status)),
        deps.sendMail({ to: notifyEmail(), subject: ownerMail.subject, html: ownerMail.html, text: ownerMail.text }),
      ]);
      if (sheetRes.status === "rejected") console.error("寫入 Google Sheet 失敗", orderNo, sheetRes.reason);
      if (ownerRes.status === "rejected") console.error("寄訂單通知給店主失敗", orderNo, ownerRes.reason);
      if (sheetRes.status === "rejected" && ownerRes.status === "rejected") {
        throw new Error("Sheet 與店主通知信都失敗，訂單 " + orderNo + " 未能送達店家");
      }
      order.notified.owner = ownerRes.status === "fulfilled";

      // ATM：立刻寄訂單確認＋匯款資訊給客人；信用卡：付款成功後才由 callback 寄
      let emailStatus = "pending";
      if (paymentMethod === "atm") {
        const customerMail = renderCustomerEmail(order, deps.shop);
        try {
          await deps.sendMail({ to: customer.email, subject: customerMail.subject, html: customerMail.html, text: customerMail.text });
          order.notified.customer = true;
          emailStatus = "sent";
        } catch (e) {
          console.error("寄訂單確認信給客人失敗", orderNo, e);
          emailStatus = "failed";
        }
      }
      try {
        await store.set("order:" + orderNo, order);
      } catch (e) {
        console.warn("更新通知狀態失敗", orderNo, e.message);
      }

      const result = {
        status: "ok",
        orderNo,
        paymentMethod,
        subtotal: order.subtotal,
        shipping: order.shipping,
        total: order.total,
        email: emailStatus,
      };
      if (paymentMethod === "card") {
        result.ecpay = buildCheckoutParams(order, {
          cfg: deps.ecpay(),
          returnUrl: callbackUrl(event),
          clientBackUrl: deps.shop.brand.shopUrl + "/?order=" + orderNo,
          now,
        });
      }
      return json(200, result, origin);
    } catch (e) {
      if (e instanceof UserError) return json(e.status, { status: "error", message: e.message }, origin);
      const ref = Date.now().toString(36);
      console.error("create-order 失敗 ref=" + ref, e);
      return json(500, { status: "error", message: `系統忙碌，訂單未成立，請稍後再試或直接聯繫我們（代碼 ${ref}）` }, origin);
    }
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
