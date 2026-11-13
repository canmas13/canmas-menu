// 綠界 ECPay 全方位金流（AIO）工具：檢查碼、建立訂單參數、驗證回呼
const crypto = require("crypto");

// 官方說明：參數依英文字母 A→Z 排序（不分大小寫）、加上 HashKey/HashIV、
// 以 .NET 規則做 URL encode（空白→「+」、~→%7e、'→%27）、轉小寫、SHA256、轉大寫
function dotNetUrlEncode(str) {
  return encodeURIComponent(str)
    .replace(/%20/g, "+")
    .replace(/~/g, "%7e")
    .replace(/'/g, "%27")
    .toLowerCase();
}

function computeCheckMacValue(params, hashKey, hashIV) {
  const keys = Object.keys(params)
    .filter((k) => k !== "CheckMacValue")
    .sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  let raw = "HashKey=" + hashKey;
  for (const k of keys) raw += "&" + k + "=" + params[k];
  raw += "&HashIV=" + hashIV;
  return crypto.createHash("sha256").update(dotNetUrlEncode(raw)).digest("hex").toUpperCase();
}

function verifyCheckMacValue(params, hashKey, hashIV) {
  const given = String(params.CheckMacValue || "");
  if (!given) return false;
  const expected = computeCheckMacValue(params, hashKey, hashIV);
  const a = Buffer.from(given.toUpperCase());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 台灣時間 yyyy/MM/dd HH:mm:ss
function formatTaipei(date = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// ItemName 上限 400 字元，超過會被截斷而造成檢查碼錯誤，所以自行安全截斷
function buildItemName(order) {
  const clean = (s) => String(s).replace(/[#<>&"'%\\]/g, " ").replace(/\s+/g, " ").trim();
  const parts = order.lines.map((l) => `${clean(l.name)} ${l.size}${l.roast ? " " + clean(l.roast) : ""} x${l.qty}`);
  if (order.shipping > 0) parts.push("運費 x1");
  let out = parts.join("#");
  const chars = Array.from(out);
  if (chars.length > 380) out = chars.slice(0, 380).join("");
  return out;
}

// 建立送往綠界的表單參數（僅信用卡）
function buildCheckoutParams(order, { cfg, returnUrl, clientBackUrl, orderResultUrl, now = new Date() }) {
  const params = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: order.orderNo, // 13 碼英數，符合綠界 20 碼英數限制
    MerchantTradeDate: formatTaipei(now),
    PaymentType: "aio",
    TotalAmount: String(order.total),
    TradeDesc: "CANMAS COFFEE",
    ItemName: buildItemName(order),
    ReturnURL: returnUrl, // 綠界伺服器對伺服器通知，必須回 1|OK
    ChoosePayment: "Credit",
    ClientBackURL: clientBackUrl, // 付款完成頁的「返回商店」按鈕
    EncryptType: "1",
  };
  // 付款完成後由客人的瀏覽器帶結果導回（不依賴綠界伺服器通知能否連到我們）
  if (orderResultUrl) params.OrderResultURL = orderResultUrl;
  params.CheckMacValue = computeCheckMacValue(params, cfg.hashKey, cfg.hashIV);
  return { action: cfg.endpoint, params };
}

// 主動向綠界查詢訂單付款狀態（QueryTradeInfo），回傳已驗章的結果；TradeStatus "1" 代表已付款
async function queryTradeInfo(cfg, orderNo, { fetchImpl = fetch, now = new Date() } = {}) {
  const req = { MerchantID: cfg.merchantId, MerchantTradeNo: orderNo, TimeStamp: String(Math.floor(now.getTime() / 1000)) };
  req.CheckMacValue = computeCheckMacValue(req, cfg.hashKey, cfg.hashIV);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchImpl(cfg.queryEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(req).toString(),
      signal: ctl.signal,
    });
    const text = await res.text();
    const out = Object.fromEntries(new URLSearchParams(text));
    if (!verifyCheckMacValue(out, cfg.hashKey, cfg.hashIV)) throw new Error("綠界查詢結果驗章失敗：" + text.slice(0, 120));
    if (out.MerchantTradeNo !== orderNo || out.MerchantID !== cfg.merchantId) throw new Error("綠界查詢結果與訂單不符");
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// 把查詢結果轉成與付款通知相同的格式，交給 settlePayment
function queryToNotice(q) {
  return {
    MerchantID: q.MerchantID,
    MerchantTradeNo: q.MerchantTradeNo,
    RtnCode: q.TradeStatus === "1" ? "1" : "0",
    RtnMsg: q.TradeStatus === "1" ? "交易成功（主動查詢）" : "TradeStatus=" + q.TradeStatus,
    TradeAmt: q.TradeAmt,
    PaymentDate: q.PaymentDate,
    PaymentType: q.PaymentType,
    TradeNo: q.TradeNo,
  };
}

function describePaymentType(type) {
  const t = String(type || "");
  if (t.startsWith("Credit")) return "信用卡";
  if (t.startsWith("ATM")) return "ATM 虛擬帳號";
  if (t.startsWith("CVS")) return "超商代碼";
  if (t.startsWith("BARCODE")) return "超商條碼";
  return t || "線上付款";
}

module.exports = {
  dotNetUrlEncode,
  computeCheckMacValue,
  verifyCheckMacValue,
  formatTaipei,
  buildItemName,
  buildCheckoutParams,
  describePaymentType,
  queryTradeInfo,
  queryToNotice,
};
