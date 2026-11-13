// 回歸測試：Lambda 相容模式下，暫存不可要求 strong consistency（否則每次讀寫都丟 BlobsConsistencyError）
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBlobStore } = require("../netlify/lib/store");

test("Lambda 相容模式（event.blobs）：可正常寫入、讀取，不丟 BlobsConsistencyError", async () => {
  const blobs = Buffer.from(JSON.stringify({ url: "https://edge.example.invalid/blobs", token: "tok" })).toString("base64");
  const event = { blobs, headers: { "x-nf-deploy-id": "d1", "x-nf-site-id": "s1" } };
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    calls.push({ url: String(url), method });
    if (method === "GET") return new Response(JSON.stringify({ a: 1 }), { status: 200 });
    return new Response(null, { status: 200 });
  };
  try {
    const s = createBlobStore(event);
    await s.set("order:X", { a: 1 });
    assert.deepEqual(await s.get("order:X"), { a: 1 });
    assert.ok(calls.length >= 2);
    assert.ok(calls.every((c) => c.url.startsWith("https://edge.example.invalid/")));
  } finally {
    globalThis.fetch = realFetch;
  }
});
