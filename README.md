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

### 1. 運費

`shop-config.json` 的 `shipping`：滿 NT$2,000 免運（`freeThreshold`），未滿收 NT$80（`fee`）。要調整時改這兩個數字、重新部署即可；`fee` 若設為 `null`，未滿免運的訂單會被系統拒絕。

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

`APPS_SCRIPT_URL`（預設已是現有的 Apps Script 網址；照下節「更新既有部署」做的話網址不變，不用設）、`APPS_SCRIPT_SECRET`、`SHEET_CSV_URL`、`ALLOWED_ORIGINS`（額外允許的前端網域，逗號分隔）、`CALLBACK_BASE_URL`（綠界通知的網域，預設為函式所在網域）。

## 上線檢查表

1. 部署（運費已設為 NT$80）。
2. 設定寄信變數、**更新 Apps Script（見下節，否則每筆訂單會收到重複的信）**，用 ATM 下一筆真實訂單，確認客人與店主各只收到一封信、「訂單記錄」「顧客資料」有新增。
3. 保持 `ECPAY_ENV` 未設定（測試環境），選「信用卡」下單，用[綠界測試信用卡](https://developers.ecpay.com.tw/)完成付款，確認收到「付款成功」信。
4. 在綠界後台確認 ReturnURL 通知成功（回 `1|OK`）。
5. 設定正式的三個綠界變數並把 `ECPAY_ENV` 設為 `production`，重新部署，小額實刷一筆再退刷。

## Google Sheet（訂單紀錄）

`apps-script/Code.gs` 是**合併版**，用來取代現有 `canmas_coffee_beans` Apps Script 專案裡的程式碼，沿用同一份試算表（「訂單記錄」「顧客資料」）：

- 「訂單記錄」原本的 10 欄不動，右邊自動補 3 欄：付款方式、付款時間、綠界付款管道。
- 付款成功／失敗時，原地更新該筆訂單的狀態、付款時間、付款管道（舊腳本不認得這個指令）。
- **Netlify 送來的訂單不再由 Apps Script 寄信**，店主通知與客人確認信由 Netlify 統一寄出。過渡期間，舊版前端（目前正式站）直接送來的訂單仍照舊寄信，PR 合併上線後就不會再有這種請求。舊腳本會自己寄一封給店主、一封給客人，沿用的話每筆訂單（付款更新時還會再一次）會收到重複的信，而且信用卡訂單在客人付款前就會先寄出「新訂單」通知。
- 電話以純文字寫入保留開頭的 0；顧客比對時 `912345678`、`0912345678`、`+886 912-345-678` 視為同一人，不再重複建檔（舊腳本會因為開頭 0 被吃掉而把同一位客人建成多筆）。
- 同一訂單編號重送只寫一次；付款失敗時顧客累計扣回，之後付款成功再加回。

### 更新既有部署（網址不變，Netlify 不用改）

1. 開啟 `canmas_coffee_beans` 的 Apps Script 編輯器，把 `程式碼.gs` 的內容全部換成 `apps-script/Code.gs`，存檔。（舊的先複製備份也可以；每個部署都釘在特定版本，只存檔不會影響線上。）
2. 「部署 → 管理部署作業」，選網址開頭為 `AKfycbw9Zuf…` 的那個部署（網站程式預設指向它）→ 鉛筆圖示編輯 → 版本選「新版本」→ 部署。
3. 用瀏覽器開該部署網址，看到 `{"status":"ok","service":"canmas-orders"}` 代表新版已生效。
4. 在編輯器選 `testPost` 按「執行」，到試算表確認「訂單記錄」「顧客資料」各多一筆測試資料（不會寄信），確認後自行刪除那兩列。
5. （選用）防止別人亂寫入：「專案設定 → 指令碼屬性」新增 `SECRET`（自訂一串長密碼），並在 Netlify 新增同值的 `APPS_SCRIPT_SECRET`。

**2026-11-13 已完成上述更新（部署第 23 版以上）。** 要退回舊版：同一個畫面把版本改回「18」即可。

## 開發

```bash
npm install
npm test                 # 60 項自動測試（簽章官方範例、金額、callback、信件、下單流程、Apps Script 邏輯）
npm run preview:email    # 產生信件預覽到 preview/
```

目前綠界只開放信用卡。ATM 刻意維持「匯到固定的合作金庫帳戶」（無繳費期限）；綠界 ATM 虛擬帳號有繳費期限，且需處理取號通知，故不採用。超商代碼同理，日後有需要再加。
