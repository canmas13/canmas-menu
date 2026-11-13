const test = require("node:test");
const assert = require("node:assert/strict");
const { makeHandler } = require("../netlify/functions/create-order");
const { verifyCheckMacValue } = require("../netlify/lib/ecpay");
const { makeDeps, postEvent, customer, STAGE } = require("./_helpers");

const items1 = [{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "中焙", qty: 2 }]; // 960
const items2 = [{ name: "衣索比亞 耶加雪菲 水洗", size: "一磅", roast: "中焙", qty: 3 }]; // 2640

const call = async (ctx, body, headers) => {
  const res = await makeHandler(ctx.deps)(postEvent(body, headers));
  return { res, body: JSON.parse(res.body) };
};

test("ATM 下單：金額由後端重算（含運費）、寫入 Sheet、寄給店主與客人各一封、不回傳綠界參數", async () => {
  const ctx = makeDeps();
  // 客戶端企圖竄改價格與總額
  const { res, body } = await call(ctx, { paymentMethod: "atm", customer, items: [{ ...items1[0], price: 1 }], total: 1 });
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.orderNo, "CM261112K7Q2M");
  assert.deepEqual([body.subtotal, body.shipping, body.total], [960, 150, 1110]);
  assert.equal(body.email, "sent");
  assert.equal(body.ecpay, undefined);

  assert.equal(ctx.sheetRows.length, 1);
  assert.equal(ctx.sheetRows[0].total, 1110);
  assert.equal(ctx.sheetRows[0].status, "待匯款");
  assert.equal(ctx.sheetRows[0].email, "customer@example.com"); // 已轉小寫
  assert.match(ctx.sheetRows[0].items, /運費 \$150/);

  assert.equal(ctx.sent.length, 2);
  assert.ok(ctx.sent.some((m) => m.to === "canmas13@gmail.com" && /新訂單・待匯款/.test(m.subject)));
  assert.ok(ctx.sent.some((m) => m.to === "customer@example.com" && /已成立/.test(m.subject) && m.html.includes("3410-7172-16576")));

  const saved = await ctx.store.get("order:CM261112K7Q2M");
  assert.equal(saved.total, 1110);
  assert.deepEqual(saved.notified, { customer: true, owner: true });
});

test("滿額免運（2640）：運費為 0", async () => {
  const ctx = makeDeps();
  const { body } = await call(ctx, { paymentMethod: "atm", customer, items: items2 });
  assert.deepEqual([body.subtotal, body.shipping, body.total], [2640, 0, 2640]);
});

test("信用卡下單：回傳可通過驗章的綠界表單；店主與客人都等付款成功才寄", async () => {
  const ctx = makeDeps();
  const { res, body } = await call(ctx, { paymentMethod: "card", customer, items: items1 });
  assert.equal(res.statusCode, 200);
  assert.equal(body.paymentMethod, "card");
  assert.equal(body.ecpay.action, "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5");
  const p = body.ecpay.params;
  assert.equal(p.MerchantTradeNo, "CM261112K7Q2M");
  assert.equal(p.TotalAmount, "1110");
  assert.equal(p.ReturnURL, "https://canmasmenu.netlify.app/.netlify/functions/callback");
  assert.equal(p.ClientBackURL, "https://menu.canmas.com.tw/?order=CM261112K7Q2M");
  assert.equal(p.ChoosePayment, "Credit");
  assert.ok(verifyCheckMacValue(p, STAGE.hashKey, STAGE.hashIV));
  assert.equal(p.OrderResultURL, "https://canmasmenu.netlify.app/.netlify/functions/payment-result");

  assert.equal(ctx.sent.length, 0);
  assert.equal(ctx.sheetRows[0].status, "待付款（信用卡）");
  const saved = await ctx.store.get("order:CM261112K7Q2M");
  assert.equal(saved.paid, false);
  assert.equal(saved.notified.owner, false); // callback 付款成功時會通知店主
});

test("欄位驗證：缺資料、電話格式、Email 格式、付款方式", async () => {
  const bad = async (patch, re) => {
    const ctx = makeDeps();
    const { res, body } = await call(ctx, { paymentMethod: "atm", customer: { ...customer, ...patch.customer }, items: items1, ...patch.top });
    assert.equal(res.statusCode, 400, JSON.stringify(patch));
    assert.match(body.message, re);
    assert.equal(ctx.sent.length, 0);
    assert.equal(ctx.sheetRows.length, 0);
  };
  await bad({ customer: { name: "" } }, /姓名/);
  await bad({ customer: { phone: "12345" } }, /電話/);
  await bad({ customer: { phone: "09123" } }, /10 位/);
  await bad({ customer: { email: "not-an-email" } }, /電子郵件/);
  await bad({ customer: { addressDetail: "短" } }, /完整/);
  await bad({ top: { paymentMethod: "cod" } }, /付款方式/);
});

test("蜜罐欄位有內容：假裝成功但不建立訂單、不寄信", async () => {
  const ctx = makeDeps();
  const { res, body } = await call(ctx, { paymentMethod: "atm", customer, items: items1, hp: "http://spam" });
  assert.equal(res.statusCode, 200);
  assert.equal(body.ignored, true);
  assert.equal(ctx.sent.length, 0);
  assert.equal(ctx.sheetRows.length, 0);
});

test("限流：同一個 Email 每小時第 5 次會被擋下（429）", async () => {
  const ctx = makeDeps();
  for (let i = 0; i < 4; i++) {
    const { res } = await call(ctx, { paymentMethod: "atm", customer, items: items1 }, { "x-nf-client-connection-ip": "9.9.9." + i });
    assert.equal(res.statusCode, 200);
  }
  const { res, body } = await call(ctx, { paymentMethod: "atm", customer, items: items1 }, { "x-nf-client-connection-ip": "9.9.9.99" });
  assert.equal(res.statusCode, 429);
  assert.match(body.message, /頻繁/);
});

test("韌性：Sheet 失敗但店主信成功 → 訂單仍成立；兩者都失敗 → 回 500 且不顯示內部細節", async () => {
  const sheetDown = makeDeps({ deps: { sheetAppend: async () => { throw new Error("apps script down"); } } });
  const a = await call(sheetDown, { paymentMethod: "atm", customer, items: items1 });
  assert.equal(a.res.statusCode, 200);

  const bothDown = makeDeps({
    deps: { sheetAppend: async () => { throw new Error("apps script down"); } },
    failMailTo: (m) => m.to === "canmas13@gmail.com",
  });
  const b = await call(bothDown, { paymentMethod: "atm", customer, items: items1 });
  assert.equal(b.res.statusCode, 500);
  assert.match(b.body.message, /訂單未成立/);
  assert.ok(!b.res.body.includes("apps script down"));
});

test("客人確認信寄不出去：訂單仍成立，email 狀態為 failed", async () => {
  const ctx = makeDeps({ failMailTo: (m) => m.to === "customer@example.com" });
  const { res, body } = await call(ctx, { paymentMethod: "atm", customer, items: items1 });
  assert.equal(res.statusCode, 200);
  assert.equal(body.email, "failed");
  assert.equal((await ctx.store.get("order:CM261112K7Q2M")).notified.customer, false);
});

test("CORS：允許的來源會被回應，不明來源不會；OPTIONS 預檢回 204", async () => {
  const ctx = makeDeps();
  const ok = await makeHandler(ctx.deps)(postEvent({ paymentMethod: "atm", customer, items: items1 }));
  assert.equal(ok.headers["Access-Control-Allow-Origin"], "https://menu.canmas.com.tw");
  const evil = await makeHandler(makeDeps().deps)(postEvent({ paymentMethod: "atm", customer, items: items1 }, { origin: "https://evil.example" }));
  assert.equal(evil.headers["Access-Control-Allow-Origin"], undefined);
  const pre = await makeHandler(ctx.deps)({ httpMethod: "OPTIONS", headers: { origin: "https://menu.canmas.com.tw" } });
  assert.equal(pre.statusCode, 204);
  const get = await makeHandler(ctx.deps)({ httpMethod: "GET", headers: {} });
  assert.equal(get.statusCode, 405);
});

test("壞 JSON、過大內容、不存在的商品都回 4xx", async () => {
  const ctx = makeDeps();
  assert.equal((await makeHandler(ctx.deps)(postEvent("{not json"))).statusCode, 400);
  assert.equal((await makeHandler(ctx.deps)(postEvent("x".repeat(30000)))).statusCode, 413);
  const { res } = await call(ctx, { paymentMethod: "atm", customer, items: [{ name: "亂寫的豆", size: "半磅", roast: "中焙", qty: 1 }] });
  assert.equal(res.statusCode, 400);
});
