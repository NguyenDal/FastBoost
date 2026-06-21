const nodemailer = require("nodemailer");

function createTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
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

        const transporter = createTransporter();

        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: "support@fastboost.gg",
            replyTo: email,
            subject: `[FastBoost Contact] ${subject}`,
            text: `
Name: ${name}
Email: ${email}

Message:
${message}
            `.trim(),
        });

        return res.json({
            ok: true,
            message: "Message sent successfully.",
        });
    } catch (error) {
        console.error("Contact email error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to send contact message.",
        });
    }
};