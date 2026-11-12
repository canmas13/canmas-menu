const test = require("node:test");
const assert = require("node:assert/strict");
const ecpay = require("../netlify/lib/ecpay");
const { STAGE } = require("./_helpers");

// 綠界官方文件（support.ecpay.com.tw/?p=16800）公開的 CheckMacValue 計算範例
const OFFICIAL = {
  params: {
    ChoosePayment: "ALL",
    EncryptType: "1",
    ItemName: "myItem",
    MerchantID: "3002607",
    MerchantTradeDate: "2025/02/08 09:27:23",
    MerchantTradeNo: "ECPay1738978043",
    PaymentType: "aio",
    ReturnURL: "https://08f6-211-23-76-78.ngrok-free.app/returnurl.php",
    TotalAmount: "30",
    TradeDesc: "Trade",
  },
  expected: "F1FB466ED0D6713DAC7158AB6705914E37C93BD44FB8FA44C17F80CD17BB5728",
};

test("CheckMacValue 與綠界官方範例完全一致", () => {
  assert.equal(ecpay.computeCheckMacValue(OFFICIAL.params, STAGE.hashKey, STAGE.hashIV), OFFICIAL.expected);
});

test("驗證回呼：簽章正確通過、竄改欄位或缺少簽章則失敗", () => {
  const cb = { MerchantID: "3002607", MerchantTradeNo: "CM261112K7Q2M", RtnCode: "1", TradeAmt: "1840", PaymentDate: "2026/11/12 19:52:08", PaymentType: "Credit_CreditCard", StoreID: "" };
  cb.CheckMacValue = ecpay.computeCheckMacValue(cb, STAGE.hashKey, STAGE.hashIV);
  assert.equal(ecpay.verifyCheckMacValue(cb, STAGE.hashKey, STAGE.hashIV), true);
  assert.equal(ecpay.verifyCheckMacValue({ ...cb, TradeAmt: "1" }, STAGE.hashKey, STAGE.hashIV), false);
  assert.equal(ecpay.verifyCheckMacValue({ ...cb, CheckMacValue: "" }, STAGE.hashKey, STAGE.hashIV), false);
  assert.equal(ecpay.verifyCheckMacValue(cb, STAGE.hashKey, "wrongIV"), false);
});

test(".NET URL encode：空白變 +、~ 與 ' 要編碼、! * ( ) - _ . 保持原樣", () => {
  assert.equal(ecpay.dotNetUrlEncode("a b"), "a+b");
  assert.equal(ecpay.dotNetUrlEncode("~'"), "%7e%27");
  assert.equal(ecpay.dotNetUrlEncode("!*()-_."), "!*()-_.");
  assert.equal(ecpay.dotNetUrlEncode("中文"), "%e4%b8%ad%e6%96%87");
});

test("建立訂單參數：欄位齊全、不外洩 HashKey、金額為整數字串、訂單編號符合綠界限制", () => {
  const order = {
    orderNo: "CM261112K7Q2M",
    total: 1510,
    shipping: 150,
    lines: [{ name: "衣索比亞 耶加雪菲 水洗", size: "半磅", unit: 480, qty: 2, subtotal: 960 }, { name: "含特殊字元#<b>&的豆", size: "一磅", unit: 400, qty: 1, subtotal: 400 }],
  };
  const { action, params } = ecpay.buildCheckoutParams(order, {
    cfg: STAGE,
    returnUrl: "https://canmasmenu.netlify.app/.netlify/functions/callback",
    clientBackUrl: "https://menu.canmas.com.tw/?order=CM261112K7Q2M",
    now: new Date("2026-11-12T11:45:12Z"),
  });
  assert.equal(action, "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5");
  assert.equal(params.MerchantTradeDate, "2026/11/12 19:45:12");
  assert.equal(params.TotalAmount, "1510");
  assert.equal(params.ChoosePayment, "Credit");
  assert.match(params.MerchantTradeNo, /^[A-Za-z0-9]{1,20}$/);
  assert.ok(!JSON.stringify(params).includes(STAGE.hashKey));
  assert.ok(!JSON.stringify(params).includes(STAGE.hashIV));
  assert.equal(ecpay.verifyCheckMacValue(params, STAGE.hashKey, STAGE.hashIV), true);
  // ItemName：以 # 分行、特殊字元已清掉、含運費
  assert.ok(!/[<>&]/.test(params.ItemName));
  assert.ok(params.ItemName.endsWith("運費 x1"));
  assert.ok(params.ItemName.split("#").length === 3);
});

test("ItemName 過長時安全截斷在 400 字元以內", () => {
  const lines = Array.from({ length: 30 }, (_, i) => ({ name: "非常長的咖啡豆名稱".repeat(3) + i, size: "半磅", unit: 1, qty: 1, subtotal: 1 }));
  const name = ecpay.buildItemName({ lines, shipping: 0 });
  assert.ok(Array.from(name).length <= 380);
});

test("台灣時間格式與跨日", () => {
  assert.equal(ecpay.formatTaipei(new Date("2026-12-31T16:30:00Z")), "2027/01/01 00:30:00");
});

test("付款方式文字對照", () => {
  assert.equal(ecpay.describePaymentType("Credit_CreditCard"), "信用卡");
  assert.equal(ecpay.describePaymentType("ATM_TAISHIN"), "ATM 虛擬帳號");
  assert.equal(ecpay.describePaymentType(""), "線上付款");
});
