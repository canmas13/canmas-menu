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

### 2. 寄信（二選一，Netlify → Site configuration → Environment variables）

| 方案 | 變數 | 說明 |
|---|---|---|
| **Gmail SMTP（目前採用）** | `GMAIL_USER`、`GMAIL_APP_PASSWORD`、`MAIL_FROM` | 以 `canmas13@gmail.com` 寄出。 |
| Resend（日後想用自己網域寄件時） | `RESEND_API_KEY`、`MAIL_FROM` | 可用 `CANMAS COFFEE <order@canmas.com.tw>`；需在 Resend 驗證 `canmas.com.tw`（加 DNS 記錄）。同時設了 Resend 會優先使用 Resend。 |

**Gmail 應用程式密碼取得方式**

1. Google 帳戶 → 安全性 → 開啟「兩步驟驗證」（未開啟時看不到下一項）。
2. 安全性 → 搜尋「應用程式密碼」→ 名稱填 `canmas-menu` → 建立，會得到 16 碼密碼（空格可去掉）。
3. Netlify 新增：
   - `GMAIL_USER` ＝ `canmas13@gmail.com`
   - `GMAIL_APP_PASSWORD` ＝ 上面的 16 碼
   - `MAIL_FROM` ＝ `CANMAS COFFEE <canmas13@gmail.com>`
4. 重新部署（Deploys → Trigger deploy）。

注意：Gmail 寄件人固定是該帳號本身，所以「給店主的通知」是自己寄給自己；建議在 Gmail 建一個篩選器（主旨含「【新訂單」→ 加星號、不要略過收件匣），以免被當成寄件備份而漏看。

其他：`NOTIFY_EMAIL`（店主收信地址，預設 `canmas13@gmail.com`）。客人回信會送到 `shop-config.json` 的 `brand.email`。

### 3. 綠界

- `ECPAY_ENV`：未設定或 `stage` ＝ 測試環境（用綠界公開的測試帳號，不會真的刷卡）；`production` ＝ 正式環境。
- 正式環境需要三個變數：`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`。
- 這三個值在綠界**廠商管理後台**（系統開發管理 → 系統介接設定），不在 ECShop（cashier.ecpay.com.tw）。
- 正式環境的信用卡付款需先由綠界審核開通。

### 4. 其他（可不設）

`APPS_SCRIPT_URL`（預設沿用舊網址；建議照上節改成新部署的網址）、`APPS_SCRIPT_SECRET`、`SHEET_CSV_URL`、`ALLOWED_ORIGINS`（額外允許的前端網域，逗號分隔）、`CALLBACK_BASE_URL`（綠界通知的網域，預設為函式所在網域）。

## 上線檢查表

1. 填 `shipping.fee`，部署。
2. 設定寄信變數與 Apps Script，用 ATM 下一筆真實訂單，確認客人與店主都收到信、Sheet 有新增。
3. 保持 `ECPAY_ENV` 未設定（測試環境），選「信用卡」下單，用[綠界測試信用卡](https://developers.ecpay.com.tw/)完成付款，確認收到「付款成功」信。
4. 在綠界後台確認 ReturnURL 通知成功（回 `1|OK`）。
5. 設定正式的三個綠界變數並把 `ECPAY_ENV` 設為 `production`，重新部署，小額實刷一筆再退刷。

## Google Sheet（訂單紀錄）

`apps-script/Code.gs` 是接收訂單的 Apps Script，會把訂單寫進「網站訂單」分頁，付款成功後把該列狀態更新為「✅ 已付款（信用卡）」並記錄付款時間。**不會動到舊的訂單分頁與舊腳本。**

設定步驟：

1. 建一份新的 Google 試算表（例如「CANMAS 訂單」）。
2. 試算表選單：擴充功能 → Apps Script，把預設內容全部刪掉，貼上 `apps-script/Code.gs` 的內容並存檔。
3. 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」→ 執行身分「我」、存取權「所有人」→ 部署，依畫面完成授權。
4. 複製「網頁應用程式」網址（結尾 `/exec`），在 Netlify 新增 `APPS_SCRIPT_URL` ＝ 該網址，重新部署。
5. 用瀏覽器開該網址，看到 `{"status":"ok","service":"canmas-orders"}` 代表部署成功。
6. （選用）防止別人亂寫入：Apps Script「專案設定 → 指令碼屬性」新增 `SECRET`（自訂一串長密碼），並在 Netlify 新增同值的 `APPS_SCRIPT_SECRET`。

之後修改 `Code.gs` 要「部署 → 管理部署作業 → 編輯 → 版本：新版本」，網址才會沿用。

若繼續沿用舊的 Apps Script（不更新）：新訂單照常寫入；但舊腳本不認得「更新」指令，付款成功時會多寫一列內容完整、狀態為「已付款」的紀錄，而不是原地更新。信件不受影響。

## 開發

```bash
npm install
npm test                 # 51 項自動測試（簽章官方範例、金額、callback、信件、下單流程、Apps Script 邏輯）
npm run preview:email    # 產生信件預覽到 preview/
```

目前綠界只開放信用卡。ATM 刻意維持「匯到固定的合作金庫帳戶」（無繳費期限）；綠界 ATM 虛擬帳號有繳費期限，且需處理取號通知，故不採用。超商代碼同理，日後有需要再加。
