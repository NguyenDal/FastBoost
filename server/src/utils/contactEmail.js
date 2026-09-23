const nodemailer = require("nodemailer");

const CONTACT_RECIPIENT = "support@fastboost.gg";

function createContactTransport() {
    for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
        if (!process.env[key]) {
            throw Object.assign(new Error(`Missing ${key}`), { code: "SMTP_CONFIG" });
        }
    }

    return nodemailer.createTransport({
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
}

module.exports = { CONTACT_RECIPIENT, createContactTransport };
