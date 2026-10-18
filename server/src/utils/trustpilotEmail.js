const nodemailer = require("nodemailer");

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function getRequiredEnv(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

function createTransporter() {
    return nodemailer.createTransport({
        host: getRequiredEnv("SMTP_HOST"),
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || "false") === "true",
        auth: {
            user: getRequiredEnv("SMTP_USER"),
            pass: getRequiredEnv("SMTP_PASS"),
        },
    });
}

async function sendTrustpilotReviewInvite(order) {
    if (!process.env.TRUSTPILOT_AFS_EMAIL) {
        console.warn("TRUSTPILOT_AFS_EMAIL is missing. Skipping Trustpilot invite.");
        return false;
    }

    const customerEmail = order.customer?.email;

    if (!customerEmail) {
        console.warn(`Order ${order.id} has no customer email. Skipping Trustpilot invite.`);
        return false;
    }

    const customerName =
        order.customer?.profile?.displayName ||
        order.customer?.username ||
        customerEmail.split("@")[0];

    const shortOrderId = order.orderNumber;
    const serviceTitle = order.service?.title || order.boostType || "FastBoost order";

    const total = new Intl.NumberFormat("en-US", { style: "currency", currency: order.currency || "USD" }).format(Number(order.totalPrice || 0));
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    const trustpilotPayload = {
        recipientName: customerName,
        recipientEmail: customerEmail,
        referenceId: order.orderNumber,
    };

    await createTransporter().sendMail({
        from,
        to: process.env.TRUSTPILOT_AFS_EMAIL,
        subject: `FastBoost completed order #${shortOrderId}`,
        text: [
            `FastBoost completed order #${shortOrderId}`,
            `Customer: ${customerName}`,
            `Email: ${customerEmail}`,
            `Reference ID: ${order.orderNumber}`,
            `Service: ${serviceTitle}`,
            `Order Total: ${total}`,
        ].join("\n"),
        html: `
        <p>FastBoost completed order #${escapeHtml(shortOrderId)}</p>
        <p><strong>Customer:</strong> ${escapeHtml(customerName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(customerEmail)}</p>
        <p><strong>Reference ID:</strong> ${escapeHtml(order.orderNumber)}</p>
        <p><strong>Service:</strong> ${escapeHtml(serviceTitle)}</p>
        <p><strong>Order Total:</strong> ${escapeHtml(total)}</p>

        <script type="application/json+trustpilot">
            ${JSON.stringify(trustpilotPayload).replace(/</g, '\\u003c')}
        </script>
    `,
    });

    return true;
}

module.exports = {
    sendTrustpilotReviewInvite,
};
