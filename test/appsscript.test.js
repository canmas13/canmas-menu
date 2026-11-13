// 用模擬的 SpreadsheetApp 驗證 apps-script/Code.gs 的邏輯（無法連真的 Google，僅驗證程式行為）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { callAppsScript } = require("../netlify/lib/sheet");

const CODE = fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8");

const ORDER_HEAD10 = ["訂單編號", "下單時間", "姓名", "電話", "Email", "寄送地址", "品項", "合計金額", "備註", "狀態"];
const CUSTOMER_HEAD = ["顧客編號", "姓名", "電話", "Email", "常用地址", "首次下單", "最近下單", "累計訂單數", "累計消費金額", "備註"];

function makeSheet(name, rows = []) {
  const grid = rows.map((r) => r.slice());
  const formats = [];
  const state = { frozen: 0, styled: [] };
  const ensure = (r) => {
    while (grid.length < r) grid.push([]);
    while (formats.length < r) formats.push([]);
  };
  const lastRow = () => {
    for (let i = grid.length; i > 0; i--) if (grid[i - 1].some((v) => v !== undefined && v !== "")) return i;
    return 0;
  };
  const sheet = {
    name, grid, formats, state,
    getLastRow: lastRow,
    getRange(r, c, nr = 1, nc = 1) {
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? "")),
        setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { ensure(r + i); grid[r - 1 + i][c - 1 + j] = v; })); return rng; },
        setNumberFormats(f) { f.forEach((row, i) => row.forEach((x, j) => { ensure(r + i); formats[r - 1 + i][c - 1 + j] = x; })); return rng; },
        setNumberFormat(x) { ensure(r); formats[r - 1][c - 1] = x; return rng; },
        setBackground() { state.styled.push([r, c]); return rng; },
        setFontColor() { return rng; },
        setFontWeight() { return rng; },
      };
      return rng;
    },
    setFrozenRows(n) { state.frozen = n; },
  };
  return sheet;
}

// seed: { 訂單記錄: [[...header], [...row]], 顧客資料: [...] }
function makeEnv({ secret, seed = {} } = {}) {
  const sheets = {};
  for (const [n, rows] of Object.entries(seed)) sheets[n] = makeSheet(n, rows);
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
  };
  const ctx = {
    SpreadsheetApp: { openById: (id) => { assert.equal(id, "1WTt3GZ7WDMXpeFh-j1btJB28z8aHwRobE4GaJuEr_XY"); return ss; } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "SECRET" ? secret : null) }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ text: t, getContent: () => t, setMimeType() { return this; } }) },
    Utilities: { formatDate: () => "261113-100000" },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).text);
  return { ctx, sheets, post };
}

const order = {
  orderNo: "CM261113ABCDE", timestamp: "2026/11/13 上午 9:50:00", name: "王小明", phone: "0912345678",
  email: " a@b.co ", address: "新竹縣竹北市鳳岡路二段502號", items: "耶加雪菲（半磅×2）、運費 $80", total: 1040,
  note: '=HYPERLINK("http://x")', status: "待付款（信用卡）", paymentMethod: "信用卡",
};
const paid = (extra = {}) => ({ ...order, action: "updateOrder", status: "✅ 已付款（信用卡）", paymentType: "信用卡", paidAt: "2026/11/13 上午 9:55:10", ...extra });

// 模擬 David 現有的試算表：10 欄表頭、舊資料（電話被試算表吃掉開頭 0 變成數字）
function legacySeed() {
  return {
    訂單記錄: [ORDER_HEAD10, ["CM260621-1297", "2026/6/21 下午 5:09:10", "huang", 935333333, "unikch@gmail.com", "新竹市東區新竹路100號", "印尼黃金曼特寧（半磅×1）", 520, "", "待匯款"]],
    顧客資料: [CUSTOMER_HEAD, ["C0001", "測試伯樂", 912345678, "t@example.com", "舊地址", "2026/6/18", "2026/6/18", 1, 1200, "新客建檔"], ["C0007", "huang", 935333333, "unikch@gmail.com", "新竹市東區新竹路100號", "2026/6/21", "2026/6/21", 1, 520, "新客建檔"]],
  };
}

test("全新試算表：建立兩個分頁與表頭，訂單與顧客各寫一筆，電話與備註以純文字儲存", () => {
  const e = makeEnv();
  assert.deepEqual(e.post(order), { status: "ok", orderNo: order.orderNo });
  const o = e.sheets["訂單記錄"];
  assert.equal(o.state.frozen, 1);
  assert.deepEqual(o.grid[0].slice(0, 10), ORDER_HEAD10);
  assert.deepEqual(o.grid[0].slice(10), ["付款方式", "付款時間", "綠界付款管道"]);
  const row = o.grid[1];
  assert.equal(row[0], "CM261113ABCDE");
  assert.equal(row[3], "0912345678"); // 開頭 0 保留
  assert.equal(row[4], "a@b.co"); // Email 去頭尾空白
  assert.equal(row[7], 1040);
  assert.equal(row[8], '=HYPERLINK("http://x")');
  assert.equal(row[9], "待付款（信用卡）");
  assert.equal(row[10], "信用卡");
  assert.equal(o.formats[1][3], "@");
  assert.equal(o.formats[1][8], "@"); // 備註為純文字，不會被當公式
  assert.equal(o.formats[1][7], "0");
  const c = e.sheets["顧客資料"];
  assert.deepEqual(c.grid[0], CUSTOMER_HEAD);
  assert.deepEqual([c.grid[1][0], c.grid[1][1], c.grid[1][2], c.grid[1][7], c.grid[1][8], c.grid[1][9]], ["C0001", "王小明", "0912345678", 1, 1040, "新客建檔"]);
});

test("既有試算表：原有表頭與舊資料原封不動，只在右側補上 3 個新表頭", () => {
  const e = makeEnv({ seed: legacySeed() });
  const before = JSON.stringify(e.sheets["訂單記錄"].grid);
  e.post(order);
  const o = e.sheets["訂單記錄"];
  assert.deepEqual(o.grid[0].slice(0, 10), ORDER_HEAD10);
  assert.deepEqual(o.grid[0].slice(10, 13), ["付款方式", "付款時間", "綠界付款管道"]);
  assert.equal(JSON.stringify(o.grid[1]), JSON.stringify(JSON.parse(before)[1])); // 舊訂單那一列沒變
  assert.equal(o.grid.length, 3);
  assert.equal(o.grid[2][0], "CM261113ABCDE");
});

test("顧客比對：被吃掉 0 的舊電話、+886、含連字號都視為同一人，不重複建檔，並補回開頭 0", () => {
  const e = makeEnv({ seed: legacySeed() });
  e.post({ ...order, orderNo: "N1", phone: "0912345678", total: 800 });
  e.post({ ...order, orderNo: "N2", phone: "+886 912-345-678", total: 200 });
  e.post({ ...order, orderNo: "N3", phone: "0912-345-678", total: 100 });
  const c = e.sheets["顧客資料"];
  assert.equal(c.grid.length, 3); // 表頭 + C0001 + C0007，沒有新增
  assert.equal(c.grid[1][2], "0912345678");
  assert.equal(c.grid[1][7], 4); // 原 1 + 3 筆
  assert.equal(c.grid[1][8], 1200 + 800 + 200 + 100);
  assert.equal(c.grid[1][3], "a@b.co"); // 以最新 Email 更新
  assert.equal(c.grid[1][4], order.address);
  assert.equal(c.grid[2][2], 935333333); // 其他客人不動
});

test("新顧客編號取現有最大號 +1（中間有缺號也不會重複）", () => {
  const e = makeEnv({ seed: legacySeed() });
  e.post({ ...order, phone: "0922333444" });
  const c = e.sheets["顧客資料"];
  assert.equal(c.grid[3][0], "C0008");
  assert.equal(c.grid[3][2], "0922333444");
});

test("同一訂單編號重送不會重複寫入，顧客累計也不會重複加", () => {
  const e = makeEnv();
  e.post(order);
  e.post(order);
  assert.equal(e.sheets["訂單記錄"].grid.length, 2);
  assert.equal(e.sheets["顧客資料"].grid[1][7], 1);
});

test("updateOrder：原地更新狀態、付款時間、付款管道，不新增列、不重複計入顧客", () => {
  const e = makeEnv();
  e.post(order);
  const r = e.post(paid());
  assert.equal(r.status, "ok");
  const o = e.sheets["訂單記錄"];
  assert.equal(o.grid.length, 2);
  assert.equal(o.grid[1][9], "✅ 已付款（信用卡）");
  assert.equal(o.grid[1][11], "2026/11/13 上午 9:55:10");
  assert.equal(o.grid[1][12], "信用卡");
  assert.equal(o.grid[1][2], "王小明"); // 其他欄位不動
  assert.equal(e.sheets["顧客資料"].grid[1][7], 1);
  assert.equal(e.sheets["顧客資料"].grid[1][8], 1040);
});

test("付款失敗只更新狀態，不清掉已存在的付款時間", () => {
  const e = makeEnv();
  e.post(order);
  e.post(paid());
  e.post({ ...order, action: "updateOrder", status: "❌ 付款失敗（交易失敗）", paidAt: "", paymentType: "" });
  assert.equal(e.sheets["訂單記錄"].grid[1][11], "2026/11/13 上午 9:55:10");
});

test("付款失敗：顧客累計扣回（重複回報不重複扣），之後同一筆付款成功再加回", () => {
  const e = makeEnv();
  e.post(order);
  const fail = { ...order, action: "updateOrder", status: "❌ 付款失敗（交易失敗）", paidAt: "", paymentType: "" };
  e.post(fail);
  e.post(fail);
  let c = e.sheets["顧客資料"].grid[1];
  assert.deepEqual([c[7], c[8]], [0, 0]);
  e.post(paid());
  c = e.sheets["顧客資料"].grid[1];
  assert.deepEqual([c[7], c[8]], [1, 1040]);
  e.post(paid()); // 綠界重送成功通知
  c = e.sheets["顧客資料"].grid[1];
  assert.deepEqual([c[7], c[8]], [1, 1040]);
});

test("updateOrder 找不到原訂單時補寫一列並建顧客，不遺失付款紀錄", () => {
  const e = makeEnv();
  e.post({ ...order, orderNo: "CM-OTHER", phone: "0900000001" });
  const r = e.post(paid());
  assert.equal(r.status, "ok");
  const o = e.sheets["訂單記錄"];
  assert.equal(o.grid.length, 3);
  assert.equal(o.grid[2][9], "✅ 已付款（信用卡）");
  assert.equal(e.sheets["顧客資料"].grid.length, 3);
});

test("缺訂單編號 → error；設了 SECRET 時密碼不符 → unauthorized，且不寫入", () => {
  const e = makeEnv({ secret: "s3cret" });
  assert.equal(e.post({ ...order, secret: "s3cret", orderNo: "" }).message, "missing orderNo");
  assert.equal(e.post(order).message, "unauthorized");
  assert.equal(e.post({ ...order, secret: "wrong" }).message, "unauthorized");
  assert.equal(Object.keys(e.sheets).length, 0);
  assert.equal(e.post({ ...order, secret: "s3cret" }).status, "ok");
  assert.equal(e.sheets["訂單記錄"].grid.length, 2);
});

test("不再寄信：程式碼（不含註解）沒有 MailApp / GmailApp，免寄信權限", () => {
  const codeOnly = CODE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/MailApp|GmailApp/.test(codeOnly));
  assert.ok(/MailApp/.test(CODE), "說明註解仍會提到已移除寄信（確認 codeOnly 的過濾確實有作用）");
});

test("doGet 健康檢查不碰試算表；testPost 可執行且寫入一筆", () => {
  const e = makeEnv();
  assert.equal(JSON.parse(e.ctx.doGet().text).status, "ok");
  assert.equal(Object.keys(e.sheets).length, 0);
  e.ctx.testPost();
  assert.equal(e.sheets["訂單記錄"].grid[1][0], "CM-TEST-261113-100000");
});

test("Netlify 端：有設 APPS_SCRIPT_SECRET 時請求會附上 secret；沒設則不附", async () => {
  const seen = [];
  const fetchImpl = async (_u, o) => { seen.push(JSON.parse(o.body)); return { ok: true, text: async () => '{"status":"ok"}' }; };
  await callAppsScript({ a: 1 }, { fetchImpl, url: "http://x", secret: "k" });
  await callAppsScript({ a: 1 }, { fetchImpl, url: "http://x", secret: undefined });
  assert.deepEqual(seen, [{ a: 1, secret: "k" }, { a: 1 }]);
});
