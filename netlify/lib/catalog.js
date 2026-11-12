// 商品目錄：由 Google Sheet 發佈的 CSV 讀取，後端依品名與規格重算價格
// 標準 CSV 解析（支援引號內逗號、換行與 "" 跳脫）
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

// 與前端 index.html 的 parsePrice 相同語意：舊版「price」欄位可能寫成「半磅450 一磅850」
function parseLegacyPrice(raw) {
  if (!raw) return { half: "", one: "" };
  const m = raw.match(/半磅[^\d]*(\d+)[^一/]*[一/]?[磅]?[^\d]*(\d+)?/);
  if (m) return { half: m[1] || "", one: m[2] || "" };
  const s = raw.match(/(\d+)/);
  return { half: "", one: s ? s[1] : raw };
}

function toPrice(v) {
  const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normName(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCatalog(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const products = [];
  for (const cols of rows.slice(1)) {
    const o = {};
    headers.forEach((h, i) => (o[h] = (cols[i] || "").trim()));
    const legacy = parseLegacyPrice(o.price || "");
    const name = o.name || "";
    if (!name) continue;
    products.push({
      region: o.region || "",
      name,
      key: normName(name),
      half: toPrice(o.half || legacy.half),
      one: toPrice(o.one || legacy.one),
      soldOut: (o.soldOut || "").toUpperCase() === "TRUE",
    });
  }
  return products;
}

let cache = { at: 0, products: null };
const TTL_MS = 60 * 1000;

async function fetchCatalog(url, { now = Date.now(), fetchImpl = fetch } = {}) {
  if (cache.products && now - cache.at < TTL_MS) return cache.products;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: ctl.signal });
    if (!res.ok) throw new Error(`商品表讀取失敗 HTTP ${res.status}`);
    const products = parseCatalog(await res.text());
    if (!products.length) throw new Error("商品表是空的");
    cache = { at: now, products };
    return products;
  } finally {
    clearTimeout(timer);
  }
}

function clearCatalogCache() {
  cache = { at: 0, products: null };
}

module.exports = { parseCsv, parseCatalog, normName, fetchCatalog, clearCatalogCache };
