// HTTP 小工具：CORS、JSON 回應、標頭讀取
const { env } = require("./config");

const DEFAULT_ORIGINS = [
  /^https:\/\/menu\.canmas\.com\.tw$/,
  /^https:\/\/canmasmenu\.netlify\.app$/,
  /^https:\/\/[a-z0-9-]+--canmasmenu\.netlify\.app$/, // Netlify 分支/預覽部署
  /^http:\/\/localhost:\d+$/,
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const extra = env("ALLOWED_ORIGINS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(origin) || DEFAULT_ORIGINS.some((re) => re.test(origin));
}

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function header(event, name) {
  const headers = (event && event.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function clientIp(event) {
  return (
    header(event, "x-nf-client-connection-ip") ||
    String(header(event, "x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function readBody(event) {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

module.exports = { corsHeaders, header, json, clientIp, readBody, isAllowedOrigin };
