require("dotenv").config({ quiet: true });
const { createContactTransport } = require("../src/utils/contactEmail");

async function verifyContactEmail() {
    let transport;
    let deadline;
    const startedAt = Date.now();
    try {
        transport = createContactTransport();
        // This standalone diagnostic sends no mail and can safely stop a stuck connection.
        deadline = setTimeout(() => {
            console.error(JSON.stringify({ ok: false, elapsedMs: Date.now() - startedAt, code: "VERIFY_TIMEOUT" }));
            process.exit(1);
        }, 30000);
        await transport.verify();
        console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - startedAt, message: "SMTP connection and authentication succeeded. No email was sent." }));
    } catch (error) {
        console.error(JSON.stringify({ ok: false, elapsedMs: Date.now() - startedAt, code: error.code || "SMTP_ERROR", command: error.command, responseCode: error.responseCode }));
        process.exitCode = 1;
    } finally {
        clearTimeout(deadline);
        transport?.close();
    }
}

void verifyContactEmail();
