const { CONTACT_RECIPIENT, createContactTransport } = require("../utils/contactEmail");

let transporter;

function getTransporter() {
    if (transporter) {
        return transporter;
    }

    transporter = createContactTransport();

    return transporter;
}

exports.sendContactMessage = async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;

        if (!name || !email || !subject || !message) {
            return res.status(400).json({
                ok: false,
                message: "Please fill in all fields.",
            });
        }

        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: CONTACT_RECIPIENT,
            replyTo: email,
            subject,
            text: `
Name: ${name}
Email: ${email}

Message:
${message}
            `.trim(),
        };

        const result = await getTransporter().sendMail(mailOptions);
        if (!result.accepted?.some((address) => address.toLowerCase() === CONTACT_RECIPIENT)) {
            throw Object.assign(new Error("Support recipient was not accepted"), { code: "SMTP_RECIPIENT_REJECTED" });
        }

        return res.status(200).json({
            ok: true,
            status: "sent",
            message: "Message sent successfully.",
        });
    } catch (error) {
        // SMTP errors can include addresses or message content. Log diagnostics only.
        console.error("Contact email error:", {
            code: error.code || "SMTP_ERROR",
            command: error.command,
            responseCode: error.responseCode,
        });

        return res.status(503).json({
            ok: false,
            message: "We couldn't send your message. Please try again or email support@fastboost.gg directly.",
        });
    }
};
