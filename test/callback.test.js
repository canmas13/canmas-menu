const test = require("node:test");
const assert = require("node:assert/strict");
const { makeHandler } = require("../netlify/functions/callback");
const { computeCheckMacValue } = require("../netlify/lib/ecpay");
const { makeDeps, STAGE } = require("./_helpers");

const seedOrder = (over = {}) => ({
  orderNo: "CM261112K7Q2M",
  createdAtText: "2026/11/12 19:45",
  customer: { name: "王小明", phone: "0912345678", email: "customer@example.com", address: "新竹縣竹北市光明六路東二段36號2樓", note: "" },
  lines: [{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", unit: 480, qty: 2, subtotal: 960 }],
  subtotal: 960,
  shipping: 150,
  total: 1110,
  paymentMethod: "card",
  paid: false,
  status: "待付款（信用卡）",
  notified: { customer: false, owner: true },
  ...over,
});

// 模擬綠界送來的付款結果通知（application/x-www-form-urlencoded，空白會變成 +）
const cbParams = (over = {}) => ({
  MerchantID: "3002607",
  MerchantTradeNo: "CM261112K7Q2M",
  StoreID: "",
  RtnCode: "1",
  RtnMsg: "交易成功",
  TradeNo: "2611121952183709",
  TradeAmt: "1110",
  PaymentDate: "2026/11/12 19:52:08",
  PaymentType: "Credit_CreditCard",
  PaymentTypeChargeFee: "30",
  TradeDate: "2026/11/12 19:45:12",
  SimulatePaid: "0",
  CustomField1: "",
  CustomField2: "",
  CustomField3: "",
  CustomField4: "",
  ...over,
});
function cbEvent(params, { sign = true, key = STAGE.hashKey, iv = STAGE.hashIV } = {}) {
  const p = { ...params };
  if (sign) p.CheckMacValue = computeCheckMacValue(p, key, iv);
  return { httpMethod: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(p).toString() };
}
async function setup(over = {}, orderOver) {
  const ctx = makeDeps(over);
  await ctx.store.set("order:CM261112K7Q2M", seedOrder(orderOver));
  return ctx;
}

test("付款成功：標記已付款、更新 Sheet、寄付款成功信給客人、再通知店主，並回 1|OK", async () => {
  const ctx = await setup();
  const res = await makeHandler(ctx.deps)(cbEvent(cbParams()));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "1|OK");

  const order = await ctx.store.get("order:CM261112K7Q2M");
  assert.equal(order.paid, true);
  assert.equal(order.paidAtText, "2026/11/12 19:52:08");
  assert.equal(order.paymentTypeLabel, "信用卡");
  assert.deepEqual(order.notified, { customer: true, owner: true });

  assert.equal(ctx.sheetUpdates.length, 1);
  assert.deepEqual(
    [ctx.sheetUpdates[0].action, ctx.sheetUpdates[0].orderNo, ctx.sheetUpdates[0].status],
    ["updateOrder", "CM261112K7Q2M", "✅ 已付款（信用卡）"]
  );
  // 同時帶完整訂單欄位：就算接到不認得 action 的舊 Apps Script，多寫的那列也是完整紀錄
  assert.equal(ctx.sheetUpdates[0].name, "王小明");
  assert.equal(ctx.sheetUpdates[0].total, order.total);
  assert.equal(ctx.sheetUpdates[0].paidAt, "2026/11/12 19:52:08");
  assert.equal(ctx.sent.length, 2);
  const toCustomer = ctx.sent.find((m) => m.to === "customer@example.com");
  assert.match(toCustomer.subject, /付款成功/);
  assert.ok(toCustomer.html.includes("已收到您的款項") && toCustomer.html.includes("NT$ 1,110"));
  assert.match(ctx.sent.find((m) => m.to === "canmas13@gmail.com").subject, /新訂單・已付款/);
});

test("綠界重複通知：不會重複寄信、不會重複更新 Sheet，仍回 1|OK", async () => {
  const ctx = await setup();
  const h = makeHandler(ctx.deps);
  await h(cbEvent(cbParams()));
  const again = await h(cbEvent(cbParams()));
  assert.equal(again.body, "1|OK");
  assert.equal(ctx.sent.length, 2);
  assert.equal(ctx.sheetUpdates.length, 1);
});

test("簽章錯誤：拒絕（400），不改狀態、不寄信", async () => {
  const ctx = await setup();
  const res = await makeHandler(ctx.deps)(cbEvent(cbParams(), { sign: false }));
  assert.equal(res.statusCode, 400);
  assert.notEqual(res.body, "1|OK");
  const res2 = await makeHandler(ctx.deps)(cbEvent(cbParams(), { key: "wrongKey" }));
  assert.equal(res2.statusCode, 400);
  assert.equal((await ctx.store.get("order:CM261112K7Q2M")).paid, false);
  assert.equal(ctx.sent.length, 0);
});

test("特店編號不符：拒絕", async () => {
  const ctx = await setup();
  const res = await makeHandler(ctx.deps)(cbEvent(cbParams({ MerchantID: "1234567" })));
  assert.equal(res.statusCode, 400);
  assert.equal((await ctx.store.get("order:CM261112K7Q2M")).paid, false);
});

test("金額與訂單不符：不標記已付款、不寄客人，寄警示信給店主", async () => {
  const ctx = await setup();
  const res = await makeHandler(ctx.deps)(cbEvent(cbParams({ TradeAmt: "1" })));
  assert.equal(res.body, "1|OK");
  assert.equal((await ctx.store.get("order:CM261112K7Q2M")).paid, false);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].to, "canmas13@gmail.com");
  assert.match(ctx.sent[0].subject, /金額與訂單不符/);
  assert.equal(ctx.sheetUpdates.length, 0);
});

test("找不到訂單：警示店主，仍回 1|OK 以免綠界無限重送", async () => {
  const ctx = makeDeps();
  const res = await makeHandler(ctx.deps)(cbEvent(cbParams()));
  assert.equal(res.body, "1|OK");
  assert.equal(ctx.sent.length, 1);
  assert.match(ctx.sent[0].subject, /找不到對應訂單/);
});

test("付款失敗（RtnCode≠1）：只記錄與更新 Sheet，不寄客人信", async () => {
  const ctx = await setup();
  const res = await makeHandler(ctx.deps)(cbEvent(cbParams({ RtnCode: "10100058", RtnMsg: "授權失敗" })));
  assert.equal(res.body, "1|OK");
  assert.equal((await ctx.store.get("order:CM261112K7Q2M")).paid, false);
  assert.equal(ctx.sent.length, 0);
  assert.match(ctx.sheetUpdates[0].status, /付款失敗/);
});

test("寄信失敗：回 0|Mail Error 讓綠界重送；重送時只補寄沒寄成功的信，Sheet 不重複更新", async () => {
  let failCustomer = true;
  const ctx = await setup({ failMailTo: (m) => failCustomer && m.to === "customer@example.com" });
  const h = makeHandler(ctx.deps);

  const first = await h(cbEvent(cbParams()));
  assert.equal(first.statusCode, 500);
  assert.equal(first.body, "0|Mail Error");
  let order = await ctx.store.get("order:CM261112K7Q2M");
  assert.equal(order.paid, true);
  assert.deepEqual(order.notified, { customer: false, owner: true });
  assert.equal(ctx.sent.length, 1); // 只有店主那封成功

  failCustomer = false;
  const retry = await h(cbEvent(cbParams()));
  assert.equal(retry.body, "1|OK");
  order = await ctx.store.get("order:CM261112K7Q2M");
  assert.deepEqual(order.notified, { customer: true, owner: true });
  assert.equal(ctx.sent.length, 2);
  assert.equal(ctx.sent[1].to, "customer@example.com");
  assert.equal(ctx.sheetUpdates.length, 1);
});

test("Sheet 更新失敗不影響付款確認與寄信", async () => {
  const ctx = await setup({ deps: { sheetUpdate: async () => { throw new Error("apps script down"); } } });
  const res = await makeHandler(ctx.deps)(cbEvent(cbParams()));
  assert.equal(res.body, "1|OK");
  assert.equal(ctx.sent.length, 2);
});

test("正式環境收到模擬付款：忽略並警示；測試環境則照常處理", async () => {
  const prod = await setup({ ecpayCfg: { ...STAGE, mode: "production" } });
  const r1 = await makeHandler(prod.deps)(cbEvent(cbParams({ SimulatePaid: "1" })));
  assert.equal(r1.body, "1|OK");
  assert.equal((await prod.store.get("order:CM261112K7Q2M")).paid, false);
  assert.match(prod.sent[0].subject, /模擬付款/);

  const stage = await setup();
  await makeHandler(stage.deps)(cbEvent(cbParams({ SimulatePaid: "1" })));
  assert.equal((await stage.store.get("order:CM261112K7Q2M")).paid, true);
});

test("Netlify 以 base64 傳送表單內容時也能解析；非 POST 回 405", async () => {
  const ctx = await setup();
  const ev = cbEvent(cbParams());
  const res = await makeHandler(ctx.deps)({ ...ev, body: Buffer.from(ev.body).toString("base64"), isBase64Encoded: true });
  assert.equal(res.body, "1|OK");
  assert.equal((await makeHandler(ctx.deps)({ httpMethod: "GET", headers: {} })).statusCode, 405);
});
