const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCatalog, parseCsv } = require("../netlify/lib/catalog");
const { priceCart, generateOrderNo } = require("../netlify/lib/pricing");
const { UserError } = require("../netlify/lib/errors");
const { CSV, shop } = require("./_helpers");

const products = parseCatalog(CSV);
const price = (items, s = shop) => priceCart(items, products, s);

test("CSV 解析：引號內的逗號與換行、跳脫引號", () => {
  const rows = parseCsv('a,b\n"x, y","line1\nline2"\n"he said ""hi""",z\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", "line1\nline2"], ['he said "hi"', "z"]]);
});

test("商品表：半磅/一磅價格與售完狀態", () => {
  assert.equal(products.length, 4);
  const eth = products.find((p) => p.name.startsWith("衣索比亞"));
  assert.equal(eth.half, 480);
  assert.equal(eth.one, 880);
  assert.equal(products.find((p) => p.name.startsWith("巴拿馬")).one, null);
  assert.equal(products.find((p) => p.name === "已售完的豆").soldOut, true);
});

test("金額重算：以商品表價格為準，忽略客戶端傳來的價格", () => {
  const q = price([{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "中焙", qty: 2, price: 1, unit: 1, total: 1 }]);
  assert.equal(q.subtotal, 960);
  assert.equal(q.total, 960 + 150);
});

test("免運門檻邊界：1999 元收運費、2000 元免運", () => {
  const edge = [{ key: "edge", name: "edge", half: 1999, one: 2000, soldOut: false }];
  const a = priceCart([{ name: "edge", size: "半磅", roast: "中焙", qty: 1 }], edge, shop);
  assert.deepEqual([a.subtotal, a.shipping, a.total], [1999, 150, 2149]);
  const b = priceCart([{ name: "edge", size: "一磅", roast: "中焙", qty: 1 }], edge, shop);
  assert.deepEqual([b.subtotal, b.shipping, b.total], [2000, 0, 2000]);
});

test("同品名同規格會合併", () => {
  const q = price([{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "中焙", qty: 1 }, { name: " 衣索比亞  耶加雪菲 水洗 ", size: "半磅", roast: "中焙", qty: 2 }]);
  assert.equal(q.lines.length, 1);
  assert.equal(q.lines[0].qty, 3);
});

test("拒絕：空清單、未知商品、已售完、沒有該規格、數量不合法、規格不合法", () => {
  const bad = (items, re) => assert.throws(() => price(items), (e) => e instanceof UserError && re.test(e.message));
  bad([], /空的/);
  bad([{ name: "不存在", size: "半磅", roast: "中焙", qty: 1 }], /找不到商品/);
  bad([{ name: "已售完的豆", size: "半磅", roast: "中焙", qty: 1 }], /已售完/);
  bad([{ name: "巴拿馬 藝伎 日曬", size: "一磅", roast: "中焙", qty: 1 }], /沒有提供一磅/);
  bad([{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "中焙", qty: 0 }], /數量/);
  bad([{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "中焙", qty: 1.5 }], /數量/);
  bad([{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "中焙", qty: 100 }], /數量/);
  bad([{ name: "衣索比亞 耶加雪菲 水洗", size: "兩磅", qty: 1 }], /規格/);
});

test("運費未設定（null）時，未滿免運門檻的訂單被拒絕（503），滿額則不受影響", () => {
  const noFee = { ...shop, shipping: { freeThreshold: 2000, fee: null } };
  assert.throws(
    () => price([{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "中焙", qty: 1 }], noFee),
    (e) => e instanceof UserError && e.status === 503
  );
  assert.equal(price([{ name: "衣索比亞 耶加雪菲 水洗", size: "一磅", roast: "中焙", qty: 3 }], noFee).total, 2640);
});

test("訂單編號：13 碼英數、日期為台灣時間、無易混淆字元", () => {
  const no = generateOrderNo(new Date("2026-12-31T17:00:00Z")); // 台灣已是 2027/01/01
  assert.match(no, /^CM270101[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(no.length, 13);
});

test("烘焙度：必選且只能是設定中的選項；同豆不同烘焙度分開計算", () => {
  const eth = "衣索比亞 耶加雪菲 水洗";
  const bad = (items) => assert.throws(() => price(items), (e) => e instanceof UserError && /烘焙度/.test(e.message));
  bad([{ name: eth, size: "半磅", qty: 1 }]);
  bad([{ name: eth, size: "半磅", roast: "極深焙", qty: 1 }]);
  const q = price([{ name: eth, size: "半磅", roast: "淺焙", qty: 1 }, { name: eth, size: "半磅", roast: "深焙", qty: 2 }]);
  assert.deepEqual(q.lines.map((l) => [l.roast, l.qty]), [["淺焙", 1], ["深焙", 2]]);
  assert.deepEqual(shop.roastLevels, ["淺焙", "淺中焙", "中焙", "中深焙", "深焙"]);
});

test("烘焙度會出現在 Sheet 品項、信件、綠界品名", () => {
  const { toSheetRow } = require("../netlify/lib/sheet");
  const { buildItemName } = require("../netlify/lib/ecpay");
  const q = price([{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "淺中焙", qty: 2 }]);
  const order = { orderNo: "X", createdAtText: "t", customer: { name: "a", phone: "0912345678", email: "a@b.co", address: "x", note: "" }, paymentMethod: "atm", ...q };
  assert.match(toSheetRow(order, "待匯款").items, /衣索比亞 耶加雪菲 水洗（半磅・淺中焙×2）/);
  assert.match(buildItemName(order), /半磅 淺中焙 x2/);
  const tpl = require("../netlify/lib/emailTemplates");
  const out = JSON.stringify(Object.values(tpl).filter((f) => typeof f === "function").map((f) => { try { return f(order, shop); } catch { return ""; } }));
  assert.match(out, /淺中焙/);
});
