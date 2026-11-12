// 寄信：優先用 Resend（可用自己的網域當寄件人，最專業），
// 沒設定 Resend 時退回 Gmail SMTP（用應用程式密碼，設定最快）
const { env, shop } = require("./config");

function defaultFrom() {
  return env("MAIL_FROM", `${shop.brand.name} <${env("GMAIL_USER", shop.brand.email)}>`);
}

async function sendViaResend({ to, subject, html, text, replyTo, from }, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      reply_to: replyTo,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}：${body.slice(0, 200)}`);
  return { provider: "resend", response: body };
}

async function sendViaGmail({ to, subject, html, text, replyTo, from }) {
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const info = await transport.sendMail({ from, to, subject, html, text, replyTo });
  return { provider: "gmail", response: info.messageId };
}

async function sendMail(message, { fetchImpl } = {}) {
  const msg = { from: defaultFrom(), replyTo: shop.brand.email, ...message };
  if (process.env.RESEND_API_KEY) return sendViaResend(msg, fetchImpl);
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return sendViaGmail(msg);
  throw new Error("未設定寄信服務：請設定 RESEND_API_KEY，或 GMAIL_USER + GMAIL_APP_PASSWORD");
}

module.exports = { sendMail, defaultFrom };
