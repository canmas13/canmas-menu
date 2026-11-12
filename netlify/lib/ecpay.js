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
  const parts = order.lines.map((l) => `${clean(l.name)} ${l.size} x${l.qty}`);
  if (order.shipping > 0) parts.push("運費 x1");
  let out = parts.join("#");
  const chars = Array.from(out);
  if (chars.length > 380) out = chars.slice(0, 380).join("");
  return out;
}

// 建立送往綠界的表單參數（僅信用卡）
function buildCheckoutParams(order, { cfg, returnUrl, clientBackUrl, now = new Date() }) {
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
  params.CheckMacValue = computeCheckMacValue(params, cfg.hashKey, cfg.hashIV);
  return { action: cfg.endpoint, params };
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
};
