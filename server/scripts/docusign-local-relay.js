// Local sandbox helper: expose only authenticated Connect callbacks to a tunnel.
const http = require('node:http');
const path = require('node:path');
const { validWebhook } = require('../src/utils/docusign');

const WEBHOOK_PATH = '/api/operations/docusign/webhook';
const MAX_BYTES = 2 * 1024 * 1024;

function createRelay({ apiPort = 5000, verify = validWebhook } = {}) {
    if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error('Invalid local API port.');
    const server = http.createServer((req, res) => {
        const reply = status => {
            if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json', 'Connection': 'close' });
            if (!res.writableEnded) res.end(JSON.stringify({ ok: status >= 200 && status < 300 }));
        };
        if (req.method !== 'POST' || req.url !== WEBHOOK_PATH) return reply(404);
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) return reply(415);
        let size = 0;
        const chunks = [];
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BYTES) { chunks.length = 0; reply(413); return; }
            if (!res.writableEnded) chunks.push(chunk);
        });
        req.on('end', () => {
            if (res.writableEnded) return;
            const body = Buffer.concat(chunks);
            if (!verify(body, req.headers)) return reply(401);
            // Forward only raw JSON and DocuSign signatures; never cookies or authorization.
            const headers = { 'Content-Type': 'application/json', 'Content-Length': body.length };
            for (const [name, value] of Object.entries(req.headers)) {
                if (/^x-docusign-signature-\d+$/i.test(name) && typeof value === 'string') headers[name] = value;
            }
            const upstream = http.request({ hostname: '127.0.0.1', port: apiPort, path: WEBHOOK_PATH, method: 'POST', headers }, response => {
                response.resume();
                response.on('end', () => reply(response.statusCode || 502));
                response.on('error', () => reply(502));
            });
            upstream.setTimeout(30000, () => upstream.destroy());
            upstream.on('error', () => reply(502));
            res.on('close', () => upstream.destroy());
            upstream.end(body);
        });
        req.on('error', () => reply(400));
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.maxConnections = 32;
    return server;
}

if (require.main === module) {
    require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
    if (process.env.DOCUSIGN_ENVIRONMENT !== 'demo' || !process.env.DOCUSIGN_CONNECT_HMAC_KEYS?.trim()) {
        throw new Error('Local relay requires DocuSign demo mode and Connect HMAC keys.');
    }
    const port = Number(process.env.DOCUSIGN_RELAY_PORT || 5011);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid relay port.');
    const server = createRelay({ apiPort: Number(process.env.PORT || 5000) });
    server.listen(port, '127.0.0.1', () => console.log(`DocuSign sandbox relay: http://127.0.0.1:${port}${WEBHOOK_PATH}`));
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
}

module.exports = { createRelay, WEBHOOK_PATH, MAX_BYTES };
