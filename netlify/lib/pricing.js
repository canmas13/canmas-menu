// 後端重算金額：只信任「品名、規格、數量」，價格一律以商品表為準
const crypto = require("crypto");
const { UserError } = require("./errors");
const { normName } = require("./catalog");

const SIZES = { 半磅: "half", 一磅: "one" };

function priceCart(items, products, shop) {
  const limits = shop.order;
  if (!Array.isArray(items) || items.length === 0) throw new UserError("購物清單是空的");
  if (items.length > limits.maxLines) throw new UserError("品項過多，請分次下單");

  const merged = new Map(); // 同品名同規格合併
  for (const it of items) {
    const name = String(it && it.name ? it.name : "");
    const size = String(it && it.size ? it.size : "");
    const qty = Number(it && it.qty);
    if (!name || !SIZES[size]) throw new UserError("商品規格不正確，請重新整理頁面後再試");
    if (!Number.isInteger(qty) || qty < 1 || qty > limits.maxQtyPerLine) {
      throw new UserError(`每項商品數量需介於 1 到 ${limits.maxQtyPerLine}`);
    }
    const k = normName(name) + "|" + size;
    const prev = merged.get(k);
    if (prev) prev.qty += qty;
    else merged.set(k, { name, size, qty });
  }

  const lines = [];
  for (const it of merged.values()) {
    const product = products.find((p) => p.key === normName(it.name));
    if (!product) throw new UserError(`找不到商品「${it.name}」，商品表可能已更新，請重新整理頁面`);
    if (product.soldOut) throw new UserError(`「${product.name}」目前已售完`);
    const unit = product[SIZES[it.size]];
    if (!unit) throw new UserError(`「${product.name}」沒有提供${it.size}規格`);
    if (it.qty > limits.maxQtyPerLine) throw new UserError(`每項商品數量上限為 ${limits.maxQtyPerLine}`);
    lines.push({ name: product.name, size: it.size, unit, qty: it.qty, subtotal: unit * it.qty });
  }

  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  let shipping = 0;
  if (subtotal < shop.shipping.freeThreshold) {
    if (!Number.isInteger(shop.shipping.fee) || shop.shipping.fee < 0) {
      throw new UserError("運費尚未設定，暫時無法接受未滿免運門檻的訂單，請聯繫店家", 503);
    }
    shipping = shop.shipping.fee;
  }
  const total = subtotal + shipping;
  if (total > limits.maxTotal) throw new UserError("單筆金額過大，請聯繫店家協助下單");
  return { lines, subtotal, shipping, total };
}

// 例：CM261112K7Q2M（13 碼英數，無連字號；去掉易混淆的 0/O/1/I）
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateOrderNo(date = new Date(), randomInt = crypto.randomInt) {
  const tw = new Date(date.getTime() + 8 * 3600 * 1000); // 以 UTC 欄位讀出台灣日期
  const yy = String(tw.getUTCFullYear()).slice(2);
  const mm = String(tw.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tw.getUTCDate()).padStart(2, "0");
  let suffix = "";
  for (let i = 0; i < 5; i++) suffix += ALPHABET[randomInt(0, ALPHABET.length)];
  return `CM${yy}${mm}${dd}${suffix}`;
}

module.exports = { priceCart, generateOrderNo };
