// 伺服端欄位驗證（規則與前端一致，但不能只靠前端）
const { UserError } = require("./errors");

function clean(s, max) {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function validatePhone(phone) {
  if (!/^\d+$/.test(phone)) throw new UserError("電話請輸入純數字");
  if (phone.startsWith("09")) {
    if (phone.length !== 10) throw new UserError("行動電話應為 10 位數字（例：0912345678）");
  } else if (phone.startsWith("0")) {
    if (phone.length < 9 || phone.length > 10) throw new UserError("市內電話請含區碼（9-10 位數字）");
  } else {
    throw new UserError("電話號碼必須以 0 開頭");
  }
}

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;

function validateCustomer(input) {
  const c = input || {};
  const name = clean(c.name, 40);
  const phone = clean(c.phone, 15);
  const email = clean(c.email, 100).toLowerCase();
  const city = clean(c.city, 10);
  const district = clean(c.district, 10);
  const detail = clean(c.addressDetail, 100);
  const note = clean(c.note, 200);

  if (!name) throw new UserError("請輸入收件人姓名");
  if (!phone) throw new UserError("請輸入聯絡電話");
  validatePhone(phone);
  if (!email || !EMAIL_RE.test(email)) throw new UserError("請輸入正確的電子郵件信箱");
  if (!city || !district) throw new UserError("請選擇寄送縣市與鄉鎮市區");
  if (detail.length < 5) throw new UserError("請輸入完整的路段、門號或樓層資訊（至少 5 個字）");

  return { name, phone, email, address: city + district + detail, note };
}

function validatePaymentMethod(m) {
  if (m === "atm" || m === "card") return m;
  throw new UserError("請選擇付款方式");
}

module.exports = { clean, validateCustomer, validatePaymentMethod };
