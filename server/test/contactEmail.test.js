const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const nodemailer = require("nodemailer");

const form = { name: "Contact test", email: "visitor@example.com", subject: "Test", message: "Test message" };

function controller(t, sendMail) {
    const keys = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    Object.assign(process.env, { SMTP_HOST: "smtp.example.com", SMTP_USER: "support@example.com", SMTP_PASS: "test-secret", SMTP_FROM: "FastBoost <support@fastboost.gg>" });
    const transport = t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));
    const log = t.mock.method(console, "error", () => {});
    const path = require.resolve("../src/controllers/contactController");
    delete require.cache[path];
    t.after(() => {
        delete require.cache[path];
        for (const key of keys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    });
    const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    return { send: require(path).sendContactMessage, response, transport, log };
}

test("contact waits for SMTP acceptance before reporting success", async t => {
    let accept;
    let mail;
    const smtp = new Promise(resolve => { accept = resolve; });
    const { send, response } = controller(t, options => { mail = options; return smtp; });
    const res = response();
    const pending = send({ body: form }, res);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(res.body, undefined, "must not acknowledge while SMTP is pending");
    assert.equal(mail.to, "support@fastboost.gg");
    assert.equal(mail.replyTo, form.email);
    assert.equal(mail.subject, form.subject);
    accept({ accepted: ["support@fastboost.gg"] });
    await pending;
    assert.equal(res.code, 200);
    assert.equal(res.body.status, "sent");
    assert.equal(res.body.ok, true);
});

for (const code of ["ETIMEDOUT", "ESOCKET", "EAUTH"]) {
    test(`contact reports ${code} as failure and logs no private content`, async t => {
        const { send, response, log } = controller(t, async () => {
            throw Object.assign(new Error("private message and password"), { code, command: "CONN" });
        });
        const res = response();
        await send({ body: form }, res);
        assert.equal(res.code, 503);
        assert.equal(res.body.ok, false);
        assert.match(res.body.message, /support@fastboost.gg/);
        assert.doesNotMatch(JSON.stringify([res.body, log.mock.calls]), /private message and password/);
        assert.equal(log.mock.calls[0].arguments[1].code, code);
    });
}

test("contact requires support recipient acceptance even when sendMail resolves", async t => {
    const { send, response } = controller(t, async () => ({ accepted: [], rejected: ["support@fastboost.gg"] }));
    const res = response();
    await send({ body: form }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.ok, false);
});

test("failed sending can be retried successfully", async t => {
    let attempts = 0;
    const { send, response } = controller(t, async () => {
        if (++attempts === 1) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
        return { accepted: ["support@fastboost.gg"] };
    });
    const first = response(), second = response();
    await send({ body: form }, first);
    await send({ body: form }, second);
    assert.equal(first.code, 503);
    assert.equal(second.body.status, "sent");
    assert.equal(attempts, 2);
});

test("invalid form or missing SMTP configuration never acknowledges sending", async t => {
    const { send, response, transport } = controller(t, () => assert.fail("must not send"));
    const invalid = response();
    await send({ body: { ...form, message: "" } }, invalid);
    assert.equal(invalid.code, 400);
    delete process.env.SMTP_PASS;
    const missingConfig = response();
    await send({ body: form }, missingConfig);
    assert.equal(missingConfig.code, 503);
    assert.equal(transport.mock.callCount(), 0);
});

function client(fetch) {
    // Execute the actual browser API wrapper with only its Vite config import substituted.
    const source = fs.readFileSync(require.resolve("../../client/src/api/contact.js"), "utf8")
        .replace(/^import .*;\r?\n/, "")
        .replace("export async function", "async function");
    return vm.runInNewContext(`${source}\nsendContactEmail`, { fetch, API_BASE_URL: "https://api.example.com/api" });
}

test("client accepts confirmed SMTP success and posts the form unchanged", async () => {
    const send = client(async (url, options) => {
        assert.equal(url, "https://api.example.com/api/contact");
        assert.deepEqual(JSON.parse(options.body), form);
        return { ok: true, status: 200, json: async () => ({ ok: true, status: "sent" }) };
    });
    assert.equal((await send(form)).status, "sent");
});

test("client rejects old 202 responses instead of showing a false success", async () => {
    const send = client(async () => ({ ok: true, status: 202, json: async () => ({ ok: true, message: "Message accepted successfully." }) }));
    await assert.rejects(send(form), /couldn't confirm/);
});

test("client reports SMTP failures and non-JSON gateway failures", async () => {
    for (const json of [async () => ({ ok: false, message: "SMTP unavailable. Please email support@fastboost.gg directly." }), async () => { throw new SyntaxError("HTML gateway error"); }]) {
        const send = client(async () => ({ ok: false, status: 503, json }));
        await assert.rejects(send(form), /support@fastboost.gg/);
    }
});
