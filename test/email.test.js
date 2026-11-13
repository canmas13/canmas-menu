const test = require("node:test");
const assert = require("node:assert/strict");
const { renderCustomerEmail, renderOwnerEmail, renderAlertEmail } = require("../netlify/lib/emailTemplates");
const { shop } = require("./_helpers");

const order = {
  orderNo: "CM261112K7Q2M",
  createdAtText: "2026/11/12 19:45",
  customer: { name: "王小明", phone: "0912345678", email: "c@example.com", address: "新竹縣竹北市光明六路東二段36號2樓", note: "請磨粗一點" },
  lines: [{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", unit: 480, qty: 2, subtotal: 960 }],
  subtotal: 960,
  shipping: 150,
  total: 1110,
  paymentMethod: "atm",
  paid: false,
};

test("客人版（ATM 待匯款）：含訂單編號、明細、運費、應付總額、匯款帳號與回報後五碼連結", () => {
  const m = renderCustomerEmail(order, shop);
  assert.match(m.subject, /CM261112K7Q2M/);
  assert.match(m.subject, /匯款/);
  for (const needle of ["CM261112K7Q2M", "衣索比亞 耶加雪菲 水洗", "NT$ 960", "NT$ 150", "NT$ 1,110", shop.bank.account, shop.bank.holder, "王小明", "請磨粗一點", "03-260-5030", "93692669"]) {
    assert.ok(m.html.includes(needle), "HTML 缺少：" + needle);
  }
  assert.match(m.html, /mailto:canmas13@gmail\.com\?subject=/);
  assert.match(m.html, /待匯款/);
  assert.ok(!m.html.includes("已收到您的款項"));
  assert.ok(m.text.includes(shop.bank.account) && m.text.includes("NT$ 1,110"));
});

test("客人版（已付款）：顯示付款資訊，不再出現匯款帳號", () => {
  const m = renderCustomerEmail({ ...order, paymentMethod: "card", paid: true, paidAtText: "2026/11/12 19:52:08", paymentTypeLabel: "信用卡" }, shop);
  assert.match(m.subject, /付款成功/);
  assert.ok(m.html.includes("已收到您的款項") && m.html.includes("2026/11/12 19:52:08"));
  assert.ok(!m.html.includes(shop.bank.account));
  assert.ok(!m.text.includes(shop.bank.account));
});

test("滿額免運時顯示「免運費」", () => {
  const m = renderCustomerEmail({ ...order, shipping: 0, subtotal: 2100, total: 2100 }, shop);
  assert.ok(m.html.includes("免運費"));
});

test("客人輸入的內容一律跳脫，不會被當成 HTML", () => {
  const evil = { ...order, customer: { ...order.customer, name: '<script>alert(1)</script>', note: '"><img src=x onerror=alert(1)>', address: "<b>bad</b>" }, lines: [{ ...order.lines[0], name: "<i>豆</i>" }] };
  for (const m of [renderCustomerEmail(evil, shop), renderOwnerEmail(evil, shop)]) {
    assert.ok(!m.html.includes("<script>"));
    assert.ok(!m.html.includes("<img src=x"));
    assert.ok(!m.html.includes("<b>bad</b>"));
    assert.ok(!m.html.includes("<i>豆</i>"));
    assert.ok(m.html.includes("&lt;script&gt;"));
  }
});

test("店主版：主旨含狀態、金額、客人姓名；內容含客人聯絡資料", () => {
  const unpaid = renderOwnerEmail(order, shop);
  assert.match(unpaid.subject, /^【新訂單・待匯款】CM261112K7Q2M・NT\$ 1,110・王小明$/);
  assert.ok(unpaid.html.includes("0912345678") && unpaid.html.includes("c@example.com") && unpaid.html.includes("新竹縣竹北市"));
  const card = renderOwnerEmail({ ...order, paymentMethod: "card" }, shop);
  assert.match(card.subject, /待付款・信用卡/);
  const paid = renderOwnerEmail({ ...order, paymentMethod: "card", paid: true }, shop);
  assert.match(paid.subject, /已付款/);
});

test("警示信：標題與內容都有，且會跳脫", () => {
  const m = renderAlertEmail("金額不符", ["訂單：<x>"], shop);
  assert.match(m.subject, /金額不符/);
  assert.ok(m.html.includes("&lt;x&gt;"));
});

test("信件為 UTF-8 完整 HTML，含預覽文字與寬度限制", () => {
  const m = renderCustomerEmail(order, shop);
  assert.match(m.html, /^<!DOCTYPE html>/);
  assert.match(m.html, /max-width:600px/);
  assert.match(m.html, /charset="utf-8"/);
});
