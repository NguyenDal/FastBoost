const nodemailer = require("nodemailer");
const { randomUUID } = require("node:crypto");
const { checkoutSummary } = require("./checkoutSummary");

const enabled = () => process.env.ORDER_CONFIRMATION_EMAILS_ENABLED === "true";
const validEmail = value => typeof value === "string" && value.trim().length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value.trim());
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function buildConfirmation(order, email) {
    if (order.paymentStatus !== "PAID") throw new Error("Confirmation requires a paid order");
    if (!validEmail(email)) throw new Error("Confirmation email is invalid");
    const origin = new URL(process.env.CLIENT_URL);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (origin.protocol !== "https:" && !(local && origin.protocol === "http:" && process.env.NODE_ENV !== "production")) throw new Error("CLIENT_URL must be a public HTTPS origin in production");
    if (local && process.env.NODE_ENV === "production") throw new Error("Production email links cannot use localhost");
    const summary = checkoutSummary(order, order.goldRedeemed || 0, order.goldDiscountCents || 0, order.cashAmountCents ?? order.amountCents);
    const money = cents => new Intl.NumberFormat("en-CA", { style: "currency", currency: summary.currency.toUpperCase(), currencyDisplay: "code" }).format(cents / 100);
    const rows = [
        ["Game", summary.game === "tft" ? "Teamfight Tactics" : "League of Legends"],
        ["Service", summary.serviceType], ...summary.details,
        ["Base price", money(summary.basePriceCents)],
        ...(summary.addonPriceCents ? [["Add-ons", money(summary.addonPriceCents)]] : []),
        ...[["Sale discount", summary.saleDiscountCents], ["Referral discount", summary.referralDiscountCents], ["Gold discount", summary.goldDiscountCents]].filter(([, amount]) => amount > 0).map(([label, amount]) => [label, `−${money(amount)}`]),
        ["Gold used", String(summary.goldRedeemed)],
        ["Amount paid by card / wallet", money(summary.totalCents)],
    ];
    const url = new URL(`/match/${encodeURIComponent(order.id)}`, origin.origin).href;
    const subject = `FastBoost order #${order.orderNumber} confirmed`;
    const intro = "Your payment is confirmed. Open your order to view progress and chat with our team.";
    return {
        to: email.trim(), subject,
        text: [subject, "", intro, "", ...rows.map(([label, value]) => `${label}: ${value}`), "", `Go to Order: ${url}`, "", "This is your FastBoost order confirmation. Stripe sends a separate receipt for card or wallet charges when enabled."].join("\n"),
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><h1 style="color:#7c3aed">FastBoost</h1><h2>Order #${escapeHtml(order.orderNumber)}</h2><p>${intro}</p><table style="width:100%;border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(label)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right">${escapeHtml(value)}</td></tr>`).join("")}</table><p style="margin:28px 0"><a style="background:#7c3aed;color:white;padding:14px 24px;border-radius:8px;text-decoration:none" href="${escapeHtml(url)}">Go to Order</a></p><p style="font-size:12px;color:#64748b">This is your FastBoost order confirmation. Stripe sends a separate receipt for card or wallet charges when enabled.</p></div>`,
    };
}

// Called inside the payment transaction: one immutable snapshot per order.
async function queueOrderConfirmation(transaction, orderId, email) {
    if (!enabled()) return;
    const order = await transaction.order.findUnique({ where: { id: orderId }, include: { service: true } });
    const payload = buildConfirmation(order, email);
    await transaction.orderConfirmationEmail.upsert({ where: { orderId }, create: { orderId, payload }, update: {} });
}

function createConfirmationTransport() {
    for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) if (!process.env[key]) throw new Error(`Missing ${key}`);
    return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
}

async function deliverPendingConfirmations(prisma, transport, now = new Date()) {
    const rows = await prisma.orderConfirmationEmail.findMany({ where: { sentAt: null, attempts: { lt: 8 }, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: "asc" }, take: 10 });
    for (const row of rows) {
        const claim = randomUUID();
        const result = await prisma.orderConfirmationEmail.updateMany({ where: { orderId: row.orderId, sentAt: null, nextAttemptAt: { lte: now }, attempts: row.attempts }, data: { claim, attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 5 * 60000) } });
        if (!result.count) continue;
        try {
            const info = await transport.sendMail({ ...row.payload, to: { address: row.payload.to }, from: process.env.SMTP_FROM || process.env.SMTP_USER, messageId: `<fastboost-order-${row.orderId}@${new URL(process.env.CLIENT_URL).hostname}>`, disableFileAccess: true, disableUrlAccess: true });
            if (!info.accepted?.length) throw new Error("Recipient not accepted");
            await prisma.orderConfirmationEmail.updateMany({ where: { orderId: row.orderId, claim }, data: { sentAt: new Date(), claim: null, lastError: null } });
        } catch (error) {
            // Keep provider errors/addresses out of logs and the customer UI.
            const code = /^[A-Z0-9_]{1,40}$/.test(error.code || "") ? error.code : "DELIVERY_FAILED";
            await prisma.orderConfirmationEmail.updateMany({ where: { orderId: row.orderId, claim }, data: { claim: null, lastError: code, nextAttemptAt: new Date(now.getTime() + Math.min(24 * 60, 2 ** (row.attempts + 1)) * 60000) } });
            console.error(`[Order email] ${row.orderId}: ${code}${row.attempts >= 7 ? " (retry limit reached)" : ""}`);
        }
    }
}

function startConfirmationWorker(prisma) {
    if (!enabled()) return;
    console.log("[Order email] Confirmation delivery enabled.");
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try { await deliverPendingConfirmations(prisma, createConfirmationTransport()); }
        catch { console.error("[Order email] Worker unavailable; check SMTP configuration and email migration."); }
        finally { running = false; }
    };
    void tick();
    setInterval(tick, 30000).unref();
}

module.exports = { validEmail, buildConfirmation, queueOrderConfirmation, deliverPendingConfirmations, createConfirmationTransport, startConfirmationWorker };
