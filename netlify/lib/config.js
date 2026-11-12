// 共用設定：店家資料來自 shop-config.json，機密與環境差異來自環境變數
const shop = require("../../shop-config.json");

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

// 綠界公開的測試環境（stage）帳號，來源：綠界官方技術文件，僅能在測試環境使用
const ECPAY_STAGE = {
  mode: "stage",
  merchantId: "3002607",
  hashKey: "pwFHCqoQZGmho4w6",
  hashIV: "EkRm7iFT261dpevs",
  endpoint: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
};

// ECPAY_ENV=production 才會連正式機；預設一律走測試環境，避免誤刷
function ecpayConfig() {
  if (env("ECPAY_ENV", "stage") !== "production") return ECPAY_STAGE;
  const merchantId = env("ECPAY_MERCHANT_ID");
  const hashKey = env("ECPAY_HASH_KEY");
  const hashIV = env("ECPAY_HASH_IV");
  if (!merchantId || !hashKey || !hashIV) {
    throw new Error("ECPAY_ENV=production，但缺少 ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV 環境變數");
  }
  return {
    mode: "production",
    merchantId,
    hashKey,
    hashIV,
    endpoint: "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5",
  };
}

module.exports = {
  shop,
  env,
  ecpayConfig,
  appsScriptUrl: () =>
    env(
      "APPS_SCRIPT_URL",
      "https://script.google.com/macros/s/AKfycbw9ZufNDCZPTnZLNYNAMf_aNedJM_14ZCl86fn965aDZBDFW6Sxzktl1TLSqYXKEUZw/exec"
    ),
  notifyEmail: () => env("NOTIFY_EMAIL", shop.brand.email),
  sheetCsvUrl: () => env("SHEET_CSV_URL", shop.catalog.sheetCsvUrl),
};
