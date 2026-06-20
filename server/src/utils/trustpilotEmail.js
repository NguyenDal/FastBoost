const nodemailer = require("nodemailer");

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

    const shortOrderId = order.id.slice(0, 8).toUpperCase();
    const serviceTitle = order.service?.title || order.boostType || "FastBoost order";

    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    const trustpilotPayload = {
        recipientName: customerName,
        recipientEmail: customerEmail,
        referenceId: order.id,
    };

    await createTransporter().sendMail({
        from,
        to: process.env.TRUSTPILOT_AFS_EMAIL,
        subject: `FastBoost completed order #${shortOrderId}`,
        text: [
            `FastBoost completed order #${shortOrderId}`,
            `Customer: ${customerName}`,
            `Email: ${customerEmail}`,
            `Reference ID: ${order.id}`,
            `Service: ${serviceTitle}`,
            `Order Total: $${Number(order.totalPrice || 0).toFixed(2)} CAD`,
        ].join("\n"),
        html: `
        <p>FastBoost completed order #${shortOrderId}</p>
        <p><strong>Customer:</strong> ${customerName}</p>
        <p><strong>Email:</strong> ${customerEmail}</p>
        <p><strong>Reference ID:</strong> ${order.id}</p>
        <p><strong>Service:</strong> ${serviceTitle}</p>
        <p><strong>Order Total:</strong> $${Number(order.totalPrice || 0).toFixed(2)} CAD</p>

        <script type="application/json+trustpilot">
            ${JSON.stringify(trustpilotPayload)}
        </script>
    `,
    });

    return true;
}

module.exports = {
    sendTrustpilotReviewInvite,
};