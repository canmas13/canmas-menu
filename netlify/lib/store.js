// 訂單暫存：Netlify Blobs（無須額外服務），用來讓付款回呼找得回訂單內容
// 測試或本機以 createMemoryStore 取代
const crypto = require("crypto");

function createBlobStore(event) {
  const { connectLambda, getStore } = require("@netlify/blobs");
  connectLambda(event); // Lambda 相容模式需手動初始化
  const s = getStore({ name: "orders", consistency: "strong" });
  return {
    get: (key) => s.get(key, { type: "json" }),
    set: (key, value) => s.setJSON(key, value),
  };
}

function createMemoryStore() {
  const m = new Map();
  return {
    get: async (key) => (m.has(key) ? JSON.parse(m.get(key)) : null),
    set: async (key, value) => {
      m.set(key, JSON.stringify(value));
    },
    _map: m,
  };
}

// 簡易限流（非原子，足以擋住洗單；儲存異常時放行，不影響正常客人）
async function rateLimit(store, id, { limit, windowSec, nowMs = Date.now() }) {
  const key = "rl:" + crypto.createHash("sha1").update(id).digest("hex").slice(0, 20);
  try {
    const rec = await store.get(key);
    if (!rec || rec.resetAt <= nowMs) {
      await store.set(key, { n: 1, resetAt: nowMs + windowSec * 1000 });
      return true;
    }
    if (rec.n >= limit) return false;
    await store.set(key, { n: rec.n + 1, resetAt: rec.resetAt });
    return true;
  } catch (e) {
    console.warn("rateLimit 儲存異常，放行：", e.message);
    return true;
  }
}

module.exports = { createBlobStore, createMemoryStore, rateLimit };
