// 測試共用：假的相依物件（記憶體儲存、假寄信、假 Sheet）
const { parseCatalog } = require("../netlify/lib/catalog");
const { createMemoryStore } = require("../netlify/lib/store");
const realShop = require("../shop-config.json");

const CSV = [
  "region,name,process,notes,half,one,soldOut",
  "非洲,衣索比亞 耶加雪菲 水洗,水洗,花香,480,880,FALSE",
  "南美洲,哥倫比亞 慧蘭 蜜處理,蜜處理,\"莓果, 焦糖\",450,820,FALSE",
  "中美洲,巴拿馬 藝伎 日曬,日曬,茉莉,1200,,FALSE",
  "亞洲,已售完的豆,水洗,x,300,500,TRUE",
].join("\n");

// 測試用店家設定：運費 150、滿 2000 免運
const shop = { ...realShop, shipping: { freeThreshold: 2000, fee: 150 } };

const STAGE = {
  mode: "stage",
  merchantId: "3002607",
  hashKey: "pwFHCqoQZGmho4w6",
  hashIV: "EkRm7iFT261dpevs",
  endpoint: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
  queryEndpoint: "https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5",
};

function makeDeps(overrides = {}) {
  const store = overrides.store || createMemoryStore();
  const sent = [];
  const sheetRows = [];
  const sheetUpdates = [];
  const deps = {
    shop,
    now: () => new Date("2026-11-12T11:45:12Z"), // 台灣 19:45
    openStore: () => store,
    getProducts: async () => parseCatalog(CSV),
    sheetAppend: async (row) => {
      sheetRows.push(row);
      return { status: "ok" };
    },
    sheetUpdate: async (p) => {
      sheetUpdates.push(p);
      return { status: "ok" };
    },
    sendMail: async (m) => {
      if (overrides.failMailTo && overrides.failMailTo(m)) throw new Error("mail down");
      sent.push(m);
      return { provider: "fake" };
    },
    ecpay: () => overrides.ecpayCfg || STAGE,
    generateOrderNo: () => "CM261112K7Q2M",
    ...overrides.deps,
  };
  return { deps, store, sent, sheetRows, sheetUpdates };
}

function postEvent(body, extraHeaders = {}) {
  return {
    httpMethod: "POST",
    headers: {
      origin: "https://menu.canmas.com.tw",
      host: "canmasmenu.netlify.app",
      "x-nf-client-connection-ip": "1.2.3.4",
      ...extraHeaders,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

const customer = {
  name: "王小明",
  phone: "0912345678",
  email: "Customer@Example.com",
  city: "新竹縣",
  district: "竹北市",
  addressDetail: "光明六路東二段36號2樓",
  note: "",
};

module.exports = { CSV, shop, STAGE, makeDeps, postEvent, customer };
