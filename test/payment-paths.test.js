// 不依賴 ReturnURL 的付款確認路徑：OrderResultURL（瀏覽器導回）、主動查詢（check-payment）、排程對帳（reconcile）
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeCheckMacValue, queryTradeInfo } = require("../netlify/lib/ecpay");
const { makeDeps, STAGE, postEvent } = require("./_helpers");

const ORDER = "CM261112K7Q2M";
const seed = (over = {}) => ({
  orderNo: ORDER,
  createdAt: "2026-11-12T11:30:00Z",
  createdAtText: "2026/11/12 19:30",
  customer: { name: "王小明", phone: "0912345678", email: "customer@example.com", address: "新竹縣竹北市光明六路東二段36號2樓", note: "" },
  lines: [{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", roast: "中焙", unit: 480, qty: 2, subtotal: 960 }],
  subtotal: 960, shipping: 150, total: 1110,
  paymentMethod: "card", paid: false, status: "待付款（信用卡）",
  notified: { customer: false, owner: false },
  returnBase: "https://deploy-preview-1--canmasmenu.netlify.app",
  ...over,
});
const signed = (p) => ({ ...p, CheckMacValue: computeCheckMacValue(p, STAGE.hashKey, STAGE.hashIV) });
const notice = (over = {}) => signed({ MerchantID: "3002607", MerchantTradeNo: ORDER, RtnCode: "1", RtnMsg: "交易成功", TradeNo: "T1", TradeAmt: "1110", PaymentDate: "2026/11/12 19:52:08", PaymentType: "Credit_CreditCard", SimulatePaid: "0", ...over });
// 模擬綠界 QueryTradeInfo 回應
const fakeQuery = (status, over = {}) => async (_url, opts) => {
  const req = Object.fromEntries(new URLSearchParams(opts.body));
  const out = signed({ MerchantID: req.MerchantID, MerchantTradeNo: req.MerchantTradeNo, TradeStatus: status, TradeAmt: "1110", PaymentDate: "2026/11/12 19:52:08", PaymentType: "Credit_CreditCard", TradeNo: "T9", HandlingCharge: "11", ...over });
  return { ok: true, text: async () => new URLSearchParams(out).toString() };
};

test("OrderResultURL：驗章通過即結算（Sheet 更新、客人與店主各一封），並 303 導回下單的網站", async () => {
  const { makeHandler } = require("../netlify/functions/payment-result");
  const ctx = makeDeps({ deps: { sleep: async () => {} } });
  await ctx.store.set("order:" + ORDER, seed());
  const res = await makeHandler(ctx.deps)(postEvent(new URLSearchParams(notice()).toString()));
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, "https://deploy-preview-1--canmasmenu.netlify.app/?order=" + ORDER);
  const o = await ctx.store.get("order:" + ORDER);
  assert.equal(o.paid, true);
  assert.equal(ctx.sent.length, 2);
  assert.match(ctx.sheetUpdates[0].status, /已付款/);
  // 之後 ReturnURL 或重複導回都不會重寄
  await makeHandler(ctx.deps)(postEvent(new URLSearchParams(notice()).toString()));
  assert.equal(ctx.sent.length, 2);
});

test("OrderResultURL：驗章失敗不結算，仍導回正式站", async () => {
  const { makeHandler } = require("../netlify/functions/payment-result");
  const ctx = makeDeps({ deps: { sleep: async () => {} } });
  await ctx.store.set("order:" + ORDER, seed());
  const bad = { ...notice(), TradeAmt: "1" };
  const res = await makeHandler(ctx.deps)(postEvent(new URLSearchParams(bad).toString()));
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, "https://menu.canmas.com.tw/?order=" + ORDER);
  assert.equal((await ctx.store.get("order:" + ORDER)).paid, false);
  assert.equal(ctx.sent.length, 0);
});

test("queryTradeInfo：送出正確簽章、驗證回應；回應被竄改則拒絕", async () => {
  let sentReq;
  const ok = await queryTradeInfo(STAGE, ORDER, { now: new Date(1794561394000), fetchImpl: async (u, o) => { sentReq = { u, body: Object.fromEntries(new URLSearchParams(o.body)) }; return fakeQuery("1")(u, o); } });
  assert.equal(sentReq.u, STAGE.queryEndpoint);
  assert.equal(sentReq.body.TimeStamp, "1794561394");
  assert.equal(sentReq.body.CheckMacValue, computeCheckMacValue({ MerchantID: "3002607", MerchantTradeNo: ORDER, TimeStamp: "1794561394" }, STAGE.hashKey, STAGE.hashIV));
  assert.equal(ok.TradeStatus, "1");
  const tampered = async (u, o) => { const r = await fakeQuery("1")(u, o); const t = (await r.text()).replace("TradeAmt=1110", "TradeAmt=1"); return { text: async () => t }; };
  await assert.rejects(queryTradeInfo(STAGE, ORDER, { fetchImpl: tampered }), /驗章失敗/);
});

test("check-payment：綠界查詢為已付款 → 結算並回 paid:true；未付款 → paid:false 不動訂單", async () => {
  const { makeHandler } = require("../netlify/functions/check-payment");
  const ctx = makeDeps({ deps: { fetchImpl: fakeQuery("0") } });
  await ctx.store.set("order:" + ORDER, seed());
  let res = await makeHandler(ctx.deps)(postEvent({ orderNo: ORDER }));
  assert.deepEqual(JSON.parse(res.body), { status: "ok", orderNo: ORDER, paid: false });
  assert.equal(ctx.sent.length, 0);
  ctx.deps.fetchImpl = fakeQuery("1");
  res = await makeHandler(ctx.deps)(postEvent({ orderNo: ORDER }));
  assert.deepEqual(JSON.parse(res.body), { status: "ok", orderNo: ORDER, paid: true });
  const o = await ctx.store.get("order:" + ORDER);
  assert.equal(o.paid, true);
  assert.equal(o.tradeNo, "T9");
  assert.equal(ctx.sent.length, 2);
  res = await makeHandler(ctx.deps)(postEvent({ orderNo: ORDER }));
  assert.equal(ctx.sent.length, 2);
});

test("check-payment：金額不符不標記已付款並通知店主；格式錯誤與找不到訂單", async () => {
  const { makeHandler } = require("../netlify/functions/check-payment");
  const ctx = makeDeps({ deps: { fetchImpl: fakeQuery("1", { TradeAmt: "10" }) } });
  await ctx.store.set("order:" + ORDER, seed());
  const res = await makeHandler(ctx.deps)(postEvent({ orderNo: ORDER }));
  assert.equal(JSON.parse(res.body).paid, false);
  assert.match(ctx.sent[0].subject, /金額/);
  assert.equal((await makeHandler(ctx.deps)(postEvent({ orderNo: "x" }))).statusCode, 400);
  assert.equal((await makeHandler(ctx.deps)(postEvent({ orderNo: "CMNOPE99" }))).statusCode, 404);
});

test("reconcile：只查 2 分鐘～26 小時內未付款的信用卡單，已付款就補登", async () => {
  const { makeHandler } = require("../netlify/functions/reconcile");
  const queried = [];
  const ctx = makeDeps({ deps: { fetchImpl: async (u, o) => { queried.push(new URLSearchParams(o.body).get("MerchantTradeNo")); return fakeQuery("1")(u, o); } } });
  const now = Date.parse("2026-11-12T11:45:12Z");
  const at = (min) => new Date(now - min * 60000).toISOString();
  await ctx.store.set("order:CMOK0001", seed({ orderNo: "CMOK0001", createdAt: at(15) }));
  await ctx.store.set("order:CMTOONEW", seed({ orderNo: "CMTOONEW", createdAt: at(1) }));
  await ctx.store.set("order:CMTOOOLD", seed({ orderNo: "CMTOOOLD", createdAt: at(27 * 60) }));
  await ctx.store.set("order:CMATM001", seed({ orderNo: "CMATM001", createdAt: at(15), paymentMethod: "atm" }));
  await ctx.store.set("order:CMPAID01", seed({ orderNo: "CMPAID01", createdAt: at(15), paid: true }));
  await ctx.store.set("rl:abc", { n: 1 });
  const res = await makeHandler(ctx.deps)({});
  assert.deepEqual(JSON.parse(res.body), { checked: 1, settled: 1 });
  assert.deepEqual(queried, ["CMOK0001"]);
  assert.equal((await ctx.store.get("order:CMOK0001")).paid, true);
});
