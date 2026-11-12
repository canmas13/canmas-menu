// 產生通知信預覽檔到 ./preview/（用瀏覽器開啟即可檢視）
// 用法：npm run preview:email
const fs = require("fs");
const path = require("path");
const { shop } = require("../netlify/lib/config");
const { renderCustomerEmail, renderOwnerEmail } = require("../netlify/lib/emailTemplates");

// 範例資料（虛構客人與品項，僅供預覽版面）
const base = {
  orderNo: "CM261112K7Q2M",
  createdAtText: "2026/11/12 19:45",
  customer: {
    name: "王小明",
    phone: "0912345678",
    email: "customer@example.com",
    address: "新竹縣竹北市光明六路東二段36號2樓",
    note: "麻煩磨成手沖粗細，謝謝",
  },
  lines: [
    { name: "衣索比亞 耶加雪菲 水洗", size: "半磅", unit: 480, qty: 2, subtotal: 960 },
    { name: "哥倫比亞 慧蘭 蜜處理", size: "一磅", unit: 880, qty: 1, subtotal: 880 },
  ],
  subtotal: 1840,
  shipping: 0,
  total: 1840,
  paymentMethod: "atm",
  paid: false,
};
const withShipping = { ...base, subtotal: 1360, shipping: 150, total: 1510, lines: [base.lines[0], { ...base.lines[0], name: "巴拿馬 藝伎 日曬", unit: 400, qty: 1, subtotal: 400 }] };
const paidCard = { ...base, orderNo: "CM261112P3F8D", paymentMethod: "card", paid: true, paidAtText: "2026/11/12 19:52:08", paymentTypeLabel: "信用卡" };

const out = path.join(__dirname, "..", "preview");
fs.mkdirSync(out, { recursive: true });
const files = {
  "1-customer-atm.html": renderCustomerEmail(base, shop).html,
  "2-customer-atm-shipping.html": renderCustomerEmail(withShipping, shop).html,
  "3-customer-card-paid.html": renderCustomerEmail(paidCard, shop).html,
  "4-owner-new-atm.html": renderOwnerEmail(base, shop).html,
  "5-owner-card-paid.html": renderOwnerEmail(paidCard, shop).html,
};
for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(out, name), html);
console.log("已輸出：", Object.keys(files).map((f) => "preview/" + f).join("\n        "));
