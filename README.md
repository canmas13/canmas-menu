# canmas-menu

CANMAS COFFEE 精品豆單訂購網站：<https://menu.canmas.com.tw>

靜態前端（`index.html`）＋ Netlify Functions ＋ Google Sheet（Apps Script）。

## 下單流程

```
客人在 index.html 選豆、填資料、選付款方式
        │  只送「品名／規格／數量」與客人資料
        ▼
POST /.netlify/functions/create-order
  1. 驗證欄位、限流、蜜罐防洗單
  2. 依商品表（Google Sheet）重算金額，滿 NT$2,000 免運，未滿加運費
  3. 產生訂單編號、暫存訂單（Netlify Blobs）
  4. 寫入 Google Sheet ＋ 寄「新訂單」信給店主
  ├─ ATM 匯款：立刻寄「訂單確認＋匯款資訊」給客人
  └─ 信用卡：回傳綠界表單 → 前端自動導向綠界付款頁
                              │ 付款完成
                              ▼
        綠界 → POST /.netlify/functions/callback（ReturnURL）
          驗章 → 驗特店編號與金額 → 標記已付款 → 更新 Sheet
          → 寄「付款成功」信給客人、「已付款」信給店主 → 回 1|OK
```

通知信範本在 `netlify/lib/emailTemplates.js`；`npm run preview:email` 會在 `preview/` 產生預覽 HTML。

## 部署前要做的設定

### 1. 運費（必填）

`shop-config.json` 的 `shipping.fee`（未滿 NT$2,000 的運費，整數）目前是 `null`。
未填之前，未滿免運門檻的訂單會被系統拒絕，避免收錯運費。

### 2. 寄信（二選一，Netlify → Site settings → Environment variables）

| 方案 | 變數 | 說明 |
|---|---|---|
| **Resend（建議）** | `RESEND_API_KEY`、`MAIL_FROM` | 可用自己的網域當寄件人，例如 `CANMAS COFFEE <order@canmas.com.tw>`；需在 Resend 驗證 `canmas.com.tw` 網域（加 DNS 記錄）。 |
| Gmail SMTP（最快） | `GMAIL_USER`、`GMAIL_APP_PASSWORD` | 寄件人為該 Gmail；需開啟兩步驟驗證並建立「應用程式密碼」。 |

其他：`NOTIFY_EMAIL`（店主收信地址，預設 `canmas13@gmail.com`）。客人回信會送到 `shop-config.json` 的 `brand.email`。

### 3. 綠界

- `ECPAY_ENV`：未設定或 `stage` ＝ 測試環境（用綠界公開的測試帳號，不會真的刷卡）；`production` ＝ 正式環境。
- 正式環境需要三個變數：`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`。
- 這三個值在綠界**廠商管理後台**（系統開發管理 → 系統介接設定），不在 ECShop（cashier.ecpay.com.tw）。
- 正式環境的信用卡付款需先由綠界審核開通。

### 4. 其他（可不設）

`APPS_SCRIPT_URL`（預設沿用原本的網址）、`SHEET_CSV_URL`、`ALLOWED_ORIGINS`（額外允許的前端網域，逗號分隔）、`CALLBACK_BASE_URL`（綠界通知的網域，預設為函式所在網域）。

## 上線檢查表

1. 填 `shipping.fee`，部署。
2. 設定寄信變數，用 ATM 下一筆真實訂單，確認客人與店主都收到信、Sheet 有新增。
3. 保持 `ECPAY_ENV` 未設定（測試環境），選「信用卡」下單，用[綠界測試信用卡](https://developers.ecpay.com.tw/)完成付款，確認收到「付款成功」信。
4. 在綠界後台確認 ReturnURL 通知成功（回 `1|OK`）。
5. 設定正式的三個綠界變數並把 `ECPAY_ENV` 設為 `production`，重新部署，小額實刷一筆再退刷。

## Google Sheet 狀態更新

付款成功後，系統會呼叫 Apps Script：`{action:"updateOrder", orderNo, status, paymentType, paidAt}`。
若你的 Apps Script 沒有處理這個 action，Sheet 的狀態欄不會自動改為「已付款」，但客人與店主的信照常寄出，不影響訂單流程。

## 開發

```bash
npm install
npm test                 # 44 項自動測試（簽章官方範例、金額、callback、信件、下單流程）
npm run preview:email    # 產生信件預覽到 preview/
```

目前綠界只開放信用卡；ATM 虛擬帳號、超商代碼可日後加上（需處理取號通知與另一種通知信）。
