// 用模擬的 SpreadsheetApp 驗證 apps-script/Code.gs 的邏輯（無法連真的 Google，僅驗證程式行為）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { callAppsScript } = require("../netlify/lib/sheet");

function makeEnv({ secret } = {}) {
  const grid = []; // grid[r-1][c-1]
  const formats = []; // 每格的 numberFormat
  const frozen = { rows: 0 };
  let sheetExists = false;
  const ensure = (r, c) => {
    while (grid.length < r) grid.push([]);
    while (formats.length < r) formats.push([]);
    void c;
  };
  const sheet = {
    getLastRow: () => grid.filter((row) => row.some((v) => v !== undefined && v !== "")).length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? "")),
        setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { ensure(r + i); grid[r - 1 + i][c - 1 + j] = v; })); return this; },
        setValue(v) { ensure(r); grid[r - 1][c - 1] = v; return this; },
        setNumberFormats(f) { f.forEach((row, i) => row.forEach((x, j) => { ensure(r + i); formats[r - 1 + i][c - 1 + j] = x; })); return this; },
        setNumberFormat(x) { ensure(r); formats[r - 1][c - 1] = x; return this; },
        setFontWeight() { return this; },
      };
    },
    setFrozenRows(n) { frozen.rows = n; },
  };
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => (sheetExists && n === "網站訂單" ? sheet : null),
        insertSheet: (n) => { assert.equal(n, "網站訂單"); sheetExists = true; return sheet; },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "SECRET" ? secret : null) }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), ctx);
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).text);
  return { ctx, grid, formats, frozen, post };
}

const order = {
  orderNo: "CM261113ABCDE", timestamp: "2026/11/13 09:50:00", name: "王小明", phone: "0912345678",
  email: "a@b.co", address: "新竹縣竹北市鳳岡路二段502號", items: "耶加雪菲（半磅×2）", subtotal: 960, shipping: 150,
  total: 1110, paymentMethod: "信用卡", status: "待付款", note: "=HYPERLINK(\"http://x\")",
};

test("新訂單：自動建立分頁與表頭、寫入一列、電話與備註以純文字儲存", () => {
  const e = makeEnv();
  assert.deepEqual(e.post(order), { status: "ok", orderNo: order.orderNo });
  assert.equal(e.frozen.rows, 1);
  assert.deepEqual(e.grid[0].slice(0, 3), ["訂單編號", "下單時間", "姓名"]);
  const row = e.grid[1];
  assert.equal(row[0], "CM261113ABCDE");
  assert.equal(row[3], "0912345678"); // 開頭 0 保留
  assert.equal(row[9], 1110);
  assert.equal(row[14], '=HYPERLINK("http://x")');
  assert.equal(e.formats[1][3], "@");
  assert.equal(e.formats[1][14], "@"); // 備註欄為純文字格式，不會被當公式
  assert.equal(e.formats[1][9], "0");
});

test("同一訂單編號重送不會重複寫入", () => {
  const e = makeEnv();
  e.post(order);
  e.post(order);
  assert.equal(e.grid.length, 2);
});

test("updateOrder：原地更新狀態、付款時間、付款方式，不新增列", () => {
  const e = makeEnv();
  e.post(order);
  const r = e.post({ ...order, action: "updateOrder", status: "✅ 已付款（信用卡）", paymentType: "信用卡", paidAt: "2026/11/13 09:55:10" });
  assert.equal(r.status, "ok");
  assert.equal(e.grid.length, 2);
  assert.equal(e.grid[1][11], "✅ 已付款（信用卡）");
  assert.equal(e.grid[1][12], "2026/11/13 09:55:10");
  assert.equal(e.grid[1][13], "信用卡");
  assert.equal(e.grid[1][2], "王小明"); // 其他欄位不動
});

test("付款失敗只更新狀態，不會把已存在的付款時間清空", () => {
  const e = makeEnv();
  e.post(order);
  e.post({ ...order, action: "updateOrder", status: "✅ 已付款（信用卡）", paidAt: "2026/11/13 09:55:10", paymentType: "信用卡" });
  e.post({ ...order, action: "updateOrder", status: "❌ 付款失敗", paidAt: "", paymentType: "" });
  assert.equal(e.grid[1][12], "2026/11/13 09:55:10");
});

test("updateOrder 找不到原訂單時補寫一列，不遺失付款紀錄", () => {
  const e = makeEnv();
  e.post({ ...order, orderNo: "CM-OTHER", timestamp: "x" });
  const r = e.post({ ...order, action: "updateOrder", status: "✅ 已付款（信用卡）" });
  assert.equal(r.status, "ok");
  assert.equal(e.grid.length, 3);
  assert.equal(e.grid[2][11], "✅ 已付款（信用卡）");
});

test("缺訂單編號 → error；設了 SECRET 時密碼不符 → unauthorized，且不寫入", () => {
  const e = makeEnv({ secret: "s3cret" });
  assert.equal(e.post({ ...order, secret: "s3cret", orderNo: "" }).message, "missing orderNo");
  assert.equal(e.post(order).message, "unauthorized");
  assert.equal(e.post({ ...order, secret: "wrong" }).message, "unauthorized");
  assert.equal(e.grid.length, 0);
  assert.equal(e.post({ ...order, secret: "s3cret" }).status, "ok");
  assert.equal(e.grid.length, 2);
});

test("Netlify 端：有設 APPS_SCRIPT_SECRET 時請求會附上 secret；沒設則不附", async () => {
  const seen = [];
  const fetchImpl = async (_u, o) => { seen.push(JSON.parse(o.body)); return { ok: true, text: async () => '{"status":"ok"}' }; };
  await callAppsScript({ a: 1 }, { fetchImpl, url: "http://x", secret: "k" });
  await callAppsScript({ a: 1 }, { fetchImpl, url: "http://x", secret: undefined });
  assert.deepEqual(seen, [{ a: 1, secret: "k" }, { a: 1 }]);
});
