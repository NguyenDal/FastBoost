const nodemailer = require("nodemailer");

let transporter;

function getTransporter() {
    if (transporter) {
        return transporter;
    }

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        pool: true,
        maxConnections: 1,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    return transporter;
}

exports.sendContactMessage = (req, res) => {
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
            to: "support@fastboost.gg",
            replyTo: email,
            subject,
            text: `
Name: ${name}
Email: ${email}

Message:
${message}
            `.trim(),
        };

        void getTransporter().sendMail(mailOptions).catch((error) => {
            console.error("Contact email error:", error);
        });

        return res.status(202).json({
            ok: true,
            message: "Message accepted successfully.",
        });
    } catch (error) {
        console.error("Contact email error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to send contact message.",
        });
    }
};