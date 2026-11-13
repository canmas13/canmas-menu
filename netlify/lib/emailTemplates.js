// 訂單通知信範本（HTML + 純文字）
// 為相容 Gmail / Outlook / Apple Mail：全部使用 table 版面與 inline style，寬度 600px 自適應手機
// 所有動態內容一律經過 esc()，避免客人輸入的文字被當成 HTML

const C = {
  navy: "#111E4A",
  navy2: "#1A2A6A",
  gold: "#D4A843",
  goldDeep: "#9A7420",
  paper: "#FBF9F4",
  ink: "#1B2237",
  mute: "#6B7494",
  line: "#E7E1D2",
  page: "#F1EEE6",
  silver: "#B8C8E8",
  okBg: "#EAF5EF",
  okLine: "#BFDFCD",
  okText: "#1F6B47",
  warnBg: "#FFF8E5",
  warnLine: "#EBD9A0",
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Microsoft JhengHei','Noto Sans TC',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman','Songti TC',serif";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const money = (n) => "NT$ " + Number(n).toLocaleString("en-US");

// ---------- 區塊元件 ----------

function badge(label, tone) {
  const t =
    tone === "ok"
      ? { bg: C.okBg, fg: C.okText, bd: C.okLine }
      : { bg: C.warnBg, fg: C.goldDeep, bd: C.warnLine };
  return `<span style="display:inline-block;padding:5px 14px;border-radius:999px;background:${t.bg};border:1px solid ${t.bd};color:${t.fg};font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:1px;">${esc(label)}</span>`;
}

function sectionTitle(text) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:34px 0 14px;"><tr>
<td width="4" style="background:${C.gold};font-size:0;line-height:0;">&nbsp;</td>
<td style="padding-left:12px;font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:2px;color:${C.navy};">${esc(text)}</td>
</tr></table>`;
}

function metaCell(label, valueHtml) {
  return `<td valign="top" width="50%" style="padding:16px 20px;font-family:${SANS};">
<div style="font-size:11px;letter-spacing:2px;color:${C.mute};">${esc(label)}</div>
<div style="font-size:15px;color:${C.ink};margin-top:6px;font-weight:600;">${valueHtml}</div></td>`;
}

function itemsTable(order) {
  const rows = order.lines
    .map(
      (l) => `<tr>
<td style="padding:14px 0;border-bottom:1px solid ${C.line};font-family:${SANS};">
<div style="font-size:15px;color:${C.ink};line-height:1.5;font-weight:600;">${esc(l.name)}</div>
<div style="font-size:12px;color:${C.mute};margin-top:3px;">${esc(l.size)}${l.roast ? " · " + esc(l.roast) : ""} · 單價 ${money(l.unit)}</div></td>
<td align="center" width="56" style="padding:14px 4px;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:14px;color:${C.ink};">× ${l.qty}</td>
<td align="right" width="104" style="padding:14px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;color:${C.ink};font-weight:600;">${money(l.subtotal)}</td>
</tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid ${C.navy};">${rows}</table>`;
}

function totalsTable(order, shop) {
  const shipText =
    order.shipping > 0
      ? money(order.shipping)
      : `<span style="color:${C.goldDeep};font-weight:600;">免運費</span>`;
  const shipNote =
    order.shipping > 0 ? "" : `<span style="color:${C.mute};font-size:12px;"> （滿 ${money(shop.shipping.freeThreshold)}）</span>`;
  const row = (label, value, extra = "") =>
    `<tr><td align="right" style="padding:6px 14px 6px 0;font-family:${SANS};font-size:14px;color:${C.mute};${extra}">${label}</td><td align="right" width="132" style="padding:6px 0;font-family:${SANS};font-size:14px;color:${C.ink};${extra}">${value}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
${row("商品小計", money(order.subtotal))}
${row("運費" + shipNote, shipText)}
<tr><td align="right" style="padding:14px 14px 0 0;border-top:1px solid ${C.line};font-family:${SANS};font-size:14px;color:${C.navy};font-weight:700;letter-spacing:1px;">應付總額</td>
<td align="right" width="132" style="padding:14px 0 0;border-top:1px solid ${C.line};font-family:${SERIF};font-size:24px;color:${C.navy};font-weight:700;">${money(order.total)}</td></tr>
</table>`;
}

function kvTable(rows) {
  const body = rows
    .filter(Boolean)
    .map(
      ([k, v]) => `<tr>
<td valign="top" width="86" style="padding:7px 0;font-family:${SANS};font-size:13px;color:${C.mute};">${esc(k)}</td>
<td valign="top" style="padding:7px 0;font-family:${SANS};font-size:14px;color:${C.ink};line-height:1.6;">${v}</td></tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>`;
}

function recipientBlock(order) {
  const c = order.customer;
  return kvTable([
    ["收件人", esc(c.name)],
    ["聯絡電話", esc(c.phone)],
    ["寄送地址", esc(c.address)],
    c.note ? ["備註", esc(c.note)] : null,
  ]);
}

function bankBlock(order, shop) {
  const b = shop.bank;
  const mailto =
    `mailto:${shop.brand.email}?subject=` +
    encodeURIComponent(`匯款通知 ${order.orderNo}`) +
    "&body=" +
    encodeURIComponent(`訂單編號：${order.orderNo}\n匯款金額：${money(order.total)}\n帳號後五碼：`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.warnBg}" style="background:${C.warnBg};border:1px solid ${C.warnLine};border-radius:12px;">
<tr><td style="padding:22px 24px;">
<div style="font-family:${SANS};font-size:12px;letter-spacing:3px;color:${C.goldDeep};font-weight:700;">匯款資訊</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
<tr><td width="86" style="padding:6px 0;font-family:${SANS};font-size:13px;color:${C.mute};">銀行</td><td style="padding:6px 0;font-family:${SANS};font-size:14px;color:${C.ink};">${esc(b.code)} ${esc(b.name)}（${esc(b.branch)}）</td></tr>
<tr><td style="padding:6px 0;font-family:${SANS};font-size:13px;color:${C.mute};">帳號</td><td style="padding:6px 0;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:18px;color:${C.navy};font-weight:700;letter-spacing:1px;">${esc(b.account)}</td></tr>
<tr><td style="padding:6px 0;font-family:${SANS};font-size:13px;color:${C.mute};">戶名</td><td style="padding:6px 0;font-family:${SANS};font-size:14px;color:${C.ink};">${esc(b.holder)}</td></tr>
<tr><td style="padding:6px 0;font-family:${SANS};font-size:13px;color:${C.mute};">應匯金額</td><td style="padding:6px 0;font-family:${SANS};font-size:16px;color:${C.navy};font-weight:700;">${money(order.total)}</td></tr>
</table>
<div style="font-family:${SANS};font-size:13px;color:${C.mute};line-height:1.8;margin-top:14px;">完成匯款後，請點下方按鈕或直接回覆此信，告訴我們「帳號後五碼」。我們確認收款後，即為您安排出貨。</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr><td bgcolor="${C.gold}" style="background:${C.gold};border-radius:8px;">
<a href="${esc(mailto)}" style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:14px;font-weight:700;letter-spacing:1px;color:${C.navy};text-decoration:none;">回報匯款後五碼</a></td></tr></table>
</td></tr></table>`;
}

function paidBlock(order) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.okBg}" style="background:${C.okBg};border:1px solid ${C.okLine};border-radius:12px;">
<tr><td style="padding:22px 24px;">
<div style="font-family:${SANS};font-size:16px;color:${C.okText};font-weight:700;">✓ 已收到您的款項</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
<tr><td width="86" style="padding:5px 0;font-family:${SANS};font-size:13px;color:${C.mute};">付款方式</td><td style="padding:5px 0;font-family:${SANS};font-size:14px;color:${C.ink};">${esc(order.paymentTypeLabel || "信用卡")}</td></tr>
${order.paidAtText ? `<tr><td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${C.mute};">付款時間</td><td style="padding:5px 0;font-family:${SANS};font-size:14px;color:${C.ink};">${esc(order.paidAtText)}</td></tr>` : ""}
<tr><td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${C.mute};">付款金額</td><td style="padding:5px 0;font-family:${SANS};font-size:15px;color:${C.navy};font-weight:700;">${money(order.total)}</td></tr>
</table>
<div style="font-family:${SANS};font-size:13px;color:${C.mute};line-height:1.8;margin-top:12px;">感謝您的支持，我們將為您安排出貨。</div>
</td></tr></table>`;
}

function shell({ title, preheader, body, shop, footerNote = "本信件由系統依您的訂購自動寄出；直接回覆即可聯絡我們。" }) {
  const b = shop.brand;
  return `<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(preheader)}${"&zwnj;&nbsp;".repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};"><tr><td align="center" style="padding:28px 12px 36px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td bgcolor="${C.navy}" align="center" style="background:${C.navy};padding:38px 32px 30px;border-radius:16px 16px 0 0;">
<div style="font-family:${SERIF};font-size:27px;line-height:1.2;letter-spacing:7px;color:${C.gold};">CANMAS&nbsp;COFFEE</div>
<div style="font-family:${SANS};font-size:12px;letter-spacing:3px;color:${C.silver};margin-top:10px;">${esc(b.tagline)}</div>
</td></tr>
<tr><td bgcolor="${C.gold}" style="background:${C.gold};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:38px 32px 40px;border-radius:0 0 16px 16px;">
${body}
</td></tr>
<tr><td align="center" style="padding:26px 24px 0;font-family:${SANS};font-size:12px;color:${C.mute};line-height:1.9;">
<div style="font-family:${SERIF};font-size:13px;letter-spacing:4px;color:${C.navy};">CANMAS&nbsp;COFFEE</div>
${esc(b.company)} · 統一編號 ${esc(b.taxId)}<br>
<a href="${esc(b.website)}" style="color:${C.mute};text-decoration:underline;">${esc(b.website.replace(/^https?:\/\//, ""))}</a> · ${esc(b.phone)} · <a href="mailto:${esc(b.email)}" style="color:${C.mute};text-decoration:underline;">${esc(b.email)}</a><br>
<span style="color:#9AA0B4;">${esc(footerNote)}</span>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ---------- 客人版 ----------

function renderCustomerEmail(order, shop) {
  const paid = !!order.paid;
  const b = shop.brand;
  const methodLabel = order.paymentMethod === "card" ? "信用卡" : "ATM／銀行匯款";
  const statusBadge = paid ? badge("已付款", "ok") : badge("待匯款", "warn");

  const headline = paid ? "付款成功，感謝您的訂購" : "感謝您的訂購";
  const lead = paid
    ? "我們已收到您的付款，以下是您的訂單明細，請核對。"
    : "您的訂單已經成立，以下是訂單明細。請依下方資訊完成匯款，我們收到款項後即為您安排出貨。";

  const body = `
<div style="font-family:${SANS};font-size:12px;letter-spacing:4px;color:${C.goldDeep};font-weight:700;">${paid ? "PAYMENT RECEIVED" : "ORDER CONFIRMATION"}</div>
<div style="font-family:${SANS};font-size:26px;line-height:1.4;color:${C.navy};font-weight:700;margin-top:10px;">${esc(headline)}</div>
<div style="font-family:${SANS};font-size:15px;line-height:1.9;color:${C.ink};margin-top:16px;">${esc(order.customer.name)} 您好，<br>${esc(lead)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background:${C.paper};border:1px solid ${C.line};border-radius:12px;margin-top:26px;">
<tr>${metaCell("訂單編號", `<span style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:1px;">${esc(order.orderNo)}</span>`)}${metaCell("下單時間", esc(order.createdAtText))}</tr>
<tr>${metaCell("付款方式", esc(methodLabel))}${metaCell("訂單狀態", statusBadge)}</tr>
</table>

${sectionTitle("訂購明細")}
${itemsTable(order)}
${totalsTable(order, shop)}

<div style="height:30px;line-height:30px;font-size:0;">&nbsp;</div>
${paid ? paidBlock(order) : bankBlock(order, shop)}

${sectionTitle("收件資訊")}
${recipientBlock(order)}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:34px;border-top:1px solid ${C.line};"><tr><td align="center" style="padding-top:26px;font-family:${SANS};font-size:14px;line-height:1.9;color:${C.ink};">
有任何問題嗎？直接回覆此信，或來電 <a href="tel:${esc(b.phone.replace(/[^\d+]/g, ""))}" style="color:${C.navy};font-weight:700;text-decoration:none;">${esc(b.phone)}</a>。<br>
<span style="color:${C.mute};font-size:13px;">請在信中附上訂單編號，我們能更快為您處理。</span>
</td></tr></table>`;

  const subject = paid
    ? `【${b.name}】訂單 ${order.orderNo} 付款成功・感謝您的訂購`
    : `【${b.name}】訂單 ${order.orderNo} 已成立・請於匯款後回報後五碼`;
  const preheader = paid
    ? `訂單 ${order.orderNo}｜已收到 ${money(order.total)}，謝謝您的支持。`
    : `訂單 ${order.orderNo}｜應匯款 ${money(order.total)}，完成後請回報帳號後五碼。`;

  return {
    subject,
    html: shell({ title: subject, preheader, body, shop }),
    text: customerText(order, shop, { paid, methodLabel, headline, lead }),
  };
}

function lineItemsText(order, shop) {
  const lines = order.lines.map((l) => `・${l.name}（${l.size}${l.roast ? "・" + l.roast : ""}）× ${l.qty}　${money(l.subtotal)}`);
  lines.push("");
  lines.push(`商品小計：${money(order.subtotal)}`);
  lines.push(
    order.shipping > 0 ? `運費：${money(order.shipping)}` : `運費：免運費（滿 ${money(shop.shipping.freeThreshold)}）`
  );
  lines.push(`應付總額：${money(order.total)}`);
  return lines.join("\n");
}

function customerText(order, shop, { paid, methodLabel, headline, lead }) {
  const b = shop.brand;
  const bank = shop.bank;
  const parts = [
    `${b.name}｜${headline}`,
    "",
    `${order.customer.name} 您好，`,
    lead,
    "",
    `訂單編號：${order.orderNo}`,
    `下單時間：${order.createdAtText}`,
    `付款方式：${methodLabel}`,
    `訂單狀態：${paid ? "已付款" : "待匯款"}`,
    "",
    "── 訂購明細 ──",
    lineItemsText(order, shop),
    "",
  ];
  if (paid) {
    parts.push("── 付款資訊 ──", `付款方式：${order.paymentTypeLabel || "信用卡"}`);
    if (order.paidAtText) parts.push(`付款時間：${order.paidAtText}`);
    parts.push(`付款金額：${money(order.total)}`, "感謝您的支持，我們將為您安排出貨。");
  } else {
    parts.push(
      "── 匯款資訊 ──",
      `銀行：${bank.code} ${bank.name}（${bank.branch}）`,
      `帳號：${bank.account}`,
      `戶名：${bank.holder}`,
      `應匯金額：${money(order.total)}`,
      "完成匯款後，請回覆此信告訴我們「帳號後五碼」，我們確認收款後即為您安排出貨。"
    );
  }
  parts.push(
    "",
    "── 收件資訊 ──",
    `收件人：${order.customer.name}`,
    `聯絡電話：${order.customer.phone}`,
    `寄送地址：${order.customer.address}`
  );
  if (order.customer.note) parts.push(`備註：${order.customer.note}`);
  parts.push(
    "",
    `有任何問題，直接回覆此信或來電 ${b.phone}，請附上訂單編號。`,
    "",
    `${b.company}｜統一編號 ${b.taxId}`,
    `${b.website}`
  );
  return parts.join("\n");
}

// ---------- 店主版 ----------

function ownerStatus(order) {
  if (order.paid) return { short: "已付款", tone: "ok", long: "已付款（信用卡）" };
  if (order.paymentMethod === "card") return { short: "待付款・信用卡", tone: "warn", long: "待付款（客人正在綠界付款頁，付款成功後會再收到通知）" };
  return { short: "待匯款", tone: "warn", long: "待匯款（等客人回報帳號後五碼）" };
}

function renderOwnerEmail(order, shop) {
  const st = ownerStatus(order);
  const c = order.customer;
  const b = shop.brand;
  const methodLabel = order.paymentMethod === "card" ? "信用卡（綠界）" : "ATM／銀行匯款";
  const subject = `【新訂單・${st.short}】${order.orderNo}・${money(order.total)}・${c.name}`;

  const body = `
<div style="font-family:${SANS};font-size:12px;letter-spacing:4px;color:${C.goldDeep};font-weight:700;">NEW ORDER</div>
<div style="font-family:${SANS};font-size:26px;line-height:1.4;color:${C.navy};font-weight:700;margin-top:10px;">${order.paid ? "收到一筆已付款的新訂單" : "收到一筆新訂單"}</div>
<div style="margin-top:14px;">${badge(st.long, st.tone)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background:${C.paper};border:1px solid ${C.line};border-radius:12px;margin-top:24px;">
<tr>${metaCell("訂單編號", `<span style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:1px;">${esc(order.orderNo)}</span>`)}${metaCell("下單時間", esc(order.createdAtText))}</tr>
<tr>${metaCell("付款方式", esc(methodLabel))}${metaCell("應收金額", `<span style="font-family:${SERIF};font-size:20px;color:${C.navy};">${money(order.total)}</span>`)}</tr>
</table>

${sectionTitle("客人資料")}
${kvTable([
  ["姓名", esc(c.name)],
  ["電話", `<a href="tel:${esc(c.phone)}" style="color:${C.navy};text-decoration:none;">${esc(c.phone)}</a>`],
  ["Email", `<a href="mailto:${esc(c.email)}" style="color:${C.navy};">${esc(c.email)}</a>`],
  ["寄送地址", esc(c.address)],
  c.note ? ["備註", esc(c.note)] : null,
])}

${sectionTitle("訂購明細")}
${itemsTable(order)}
${totalsTable(order, shop)}

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;"><tr>
<td bgcolor="${C.navy}" style="background:${C.navy};border-radius:8px;"><a href="mailto:${esc(c.email)}?subject=${esc(encodeURIComponent(`${b.name} 訂單 ${order.orderNo}`))}" style="display:inline-block;padding:12px 24px;font-family:${SANS};font-size:14px;font-weight:700;color:${C.gold};text-decoration:none;">回信給客人</a></td>
<td width="12">&nbsp;</td>
<td bgcolor="${C.gold}" style="background:${C.gold};border-radius:8px;"><a href="tel:${esc(c.phone)}" style="display:inline-block;padding:12px 24px;font-family:${SANS};font-size:14px;font-weight:700;color:${C.navy};text-decoration:none;">撥電話</a></td>
</tr></table>`;

  const text = [
    `【新訂單・${st.short}】${order.orderNo}`,
    `狀態：${st.long}`,
    `下單時間：${order.createdAtText}`,
    `付款方式：${methodLabel}`,
    "",
    "── 客人資料 ──",
    `姓名：${c.name}`,
    `電話：${c.phone}`,
    `Email：${c.email}`,
    `地址：${c.address}`,
    c.note ? `備註：${c.note}` : null,
    "",
    "── 訂購明細 ──",
    lineItemsText(order, shop),
  ]
    .filter((l) => l !== null)
    .join("\n");

  return {
    subject,
    html: shell({ title: subject, preheader: `${c.name}｜${money(order.total)}｜${st.short}`, body, shop, footerNote: "CANMAS 訂單系統自動通知。" }),
    text,
  };
}

// 異常警示（金額不符、找不到訂單、模擬付款…）給店主的純文字信
function renderAlertEmail(title, lines, shop) {
  const subject = `【CANMAS 系統警示】${title}`;
  const text = [title, "", ...lines, "", "此為系統自動警示信，請登入綠界後台與 Google Sheet 核對。"].join("\n");
  const html = shell({
    title: subject,
    preheader: title,
    shop,
    footerNote: "CANMAS 訂單系統自動通知。",
    body: `<div style="font-family:${SANS};font-size:12px;letter-spacing:4px;color:#B23A3A;font-weight:700;">ALERT</div>
<div style="font-family:${SANS};font-size:22px;line-height:1.5;color:${C.navy};font-weight:700;margin-top:10px;">${esc(title)}</div>
<div style="font-family:${SANS};font-size:14px;line-height:2;color:${C.ink};margin-top:16px;">${lines.map(esc).join("<br>")}</div>
<div style="font-family:${SANS};font-size:13px;line-height:1.8;color:${C.mute};margin-top:22px;">此為系統自動警示信，請登入綠界後台與 Google Sheet 核對。</div>`,
  });
  return { subject, html, text };
}

module.exports = { renderCustomerEmail, renderOwnerEmail, renderAlertEmail, esc, money };
