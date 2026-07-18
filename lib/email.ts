// Sable payment email — the "you've been paid" message with a claim link + QR.
//
// Emails ALWAYS land in the in-app outbox (the demo surface). Real delivery is
// SMTP via nodemailer (SABLE_SMTP_USER/PASS — e.g. Gmail with an app password,
// delivers to any address). Sending must
// NEVER throw: the whole body is wrapped in try/catch so a mail failure can't
// disturb the payment path that fired it. HTML uses inline styles only — email
// clients strip stylesheets. The QR: the OUTBOX copy points at the served PNG
// (/api/claim/<token>/qr — fine in-app), but the SENT copy embeds it as an
// inline cid: attachment, because remote clients can't fetch our dev host and
// Gmail strips data: URIs.

import QRCode from "qrcode";
import nodemailer, { type Transporter } from "nodemailer";
import { appendOutbox, baseUrl } from "@/lib/claims";

let _smtp: Transporter | null = null;
function smtpTransport(): Transporter | null {
  const user = process.env.SABLE_SMTP_USER;
  const pass = process.env.SABLE_SMTP_PASS;
  if (!user || !pass) return null;
  if (!_smtp) {
    const port = Number(process.env.SABLE_SMTP_PORT ?? 465);
    _smtp = nodemailer.createTransport({
      host: process.env.SABLE_SMTP_HOST ?? "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return _smtp;
}

function fmtAmount(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(opts: {
  recipientName: string;
  amount: number;
  memo: string;
  claimUrl: string;
  qrSrc: string;
}): string {
  const { recipientName, amount, memo, claimUrl, qrSrc } = opts;
  const amt = fmtAmount(amount);
  const safeName = escapeHtml(recipientName);
  const safeMemo = escapeHtml(memo);
  const safeUrl = escapeHtml(claimUrl);
  return `<!-- Sable payment email -->
<div style="margin:0;padding:0;background:#0d0b0a;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="background:#141110;border:1px solid #2a2420;border-radius:16px;padding:36px 32px;color:#efe7da;">
      <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#e0b15e;font-weight:600;">Sable</div>
      <h1 style="margin:20px 0 4px;font-size:22px;font-weight:600;color:#efe7da;">You've been paid</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#b8ab99;">Hi ${safeName}, funds are waiting in escrow for you.</p>
      <div style="font-size:44px;font-weight:700;color:#efe7da;letter-spacing:-0.02em;">$${amt}</div>
      <p style="margin:8px 0 28px;font-size:14px;color:#b8ab99;">${safeMemo}</p>
      <a href="${safeUrl}" style="display:inline-block;background:#e0b15e;color:#1a1512;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:10px;">Open your wallet</a>
      <div style="margin:32px 0 12px;text-align:center;">
        <img src="${qrSrc}" width="180" height="180" alt="Scan to open your wallet" style="border-radius:12px;background:#ffffff;padding:8px;" />
        <div style="margin-top:10px;font-size:12px;color:#8a7f70;">Scan to open your wallet</div>
      </div>
      <p style="margin:20px 0 0;font-size:13px;color:#8a7f70;word-break:break-all;">
        Or paste this link into your browser:<br />
        <a href="${safeUrl}" style="color:#e0b15e;text-decoration:none;">${safeUrl}</a>
      </p>
    </div>
    <p style="margin:20px 4px 0;font-size:12px;color:#6b6255;line-height:1.5;">
      Sable · the private spending layer. Funds are held in escrow until you claim them.
    </p>
  </div>
</div>`;
}

export async function sendPaymentEmail(opts: {
  to: string;
  recipientName: string;
  amount: number;
  memo: string;
  token: string;
  claimUrl: string;
  paymentId?: string;
}): Promise<void> {
  try {
    const { to, recipientName, amount, memo, token, claimUrl, paymentId } = opts;
    const subject = `You've been paid $${fmtAmount(amount)} — claim it in your Sable wallet`;
    // Outbox copy: served PNG renders fine inside the app.
    const html = renderHtml({ recipientName, amount, memo, claimUrl, qrSrc: `${baseUrl()}/api/claim/${token}/qr` });

    const smtp = smtpTransport();
    const deliverable = !to.endsWith(".example");

    if (!deliverable || !smtp) {
      appendOutbox({ to, subject, html, claimUrl, via: "outbox", paymentId });
      return;
    }

    let via: "outbox" | "smtp" = "outbox";
    let sendError: string | undefined;
    try {
      // Sent copy: inline cid attachment — remote clients can't reach our host.
      const qrPng = await QRCode.toBuffer(claimUrl, { width: 360, margin: 1 });
      await smtp.sendMail({
        from: process.env.SABLE_EMAIL_FROM ?? `Sable <${process.env.SABLE_SMTP_USER}>`,
        to,
        subject,
        html: renderHtml({ recipientName, amount, memo, claimUrl, qrSrc: "cid:sable-qr" }),
        attachments: [{ filename: "sable-claim-qr.png", content: qrPng, cid: "sable-qr" }],
      });
      via = "smtp";
    } catch (err: unknown) {
      sendError = err instanceof Error ? err.message : String(err);
    }

    appendOutbox({
      to,
      subject,
      html,
      claimUrl,
      via,
      paymentId,
      ...(sendError ? { sendError } : {}),
    });
  } catch {
    // Never throw — a mail failure must not disturb the payment path.
  }
}
