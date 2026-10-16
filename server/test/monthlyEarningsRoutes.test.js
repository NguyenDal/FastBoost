const test = require('node:test');
const assert = require('node:assert/strict');
const { createMonthlyEarningsRouter } = require('../src/routes/monthlyEarningsRoutes');
const { earningsMonth } = require('../src/utils/monthlyEarningsPeriod');
const { fixture, enable } = require('../test-helpers/monthlyEarningsFixture');

function setup(t) {
    enable(t);
    const f = fixture();
    f.state.activation = { id: 'global', activatedAt: new Date('2020-01-01T12:00:00Z') };
    f.state.entries.push(...['admin', 'other'].map(boosterId => ({ id: boosterId, boosterId, orderId: 'order', orderNumber: 'TEST-1', serviceTitle: 'Win Boost',
        kind: 'EARNED', period: '2020-01', currency: 'USD', amountCents: boosterId === 'admin' ? 700 : 99999, recognizedAt: new Date('2020-01-15T12:00:00Z') })));
    f.state.entries.push({ ...f.state.entries[0], id: 'admin-cad', currency: 'CAD', amountCents: 12000 });
    const actors = {
        admin: { id: 'admin', role: 'ADMIN', username: 'Admin', profile: { displayName: 'My Booster' } },
        provider: { id: 'provider', role: 'PROVIDER', username: 'Provider' },
        customer: { id: 'customer', role: 'CUSTOMER' },
        suspended: { id: 'suspended', role: 'PROVIDER', suspendedAt: new Date() },
    };
    f.db.user = { findUnique: async ({ where }) => actors[where.id] || null };
    let transactionOpen = false;
    const transaction = f.db.$transaction;
    f.db.$transaction = callback => transaction(async tx => {
        transactionOpen = true;
        try { return await callback(tx); } finally { transactionOpen = false; }
    });
    const rendered = [];
    const router = createMonthlyEarningsRouter({ db: f.db,
        authenticate: (req, res, next) => {
            if (!req.headers.authorization) return res.status(401).json({ ok: false });
            req.user = { userId: req.headers.authorization }; next();
        },
        renderStatement: async report => { assert.equal(transactionOpen, false, 'PDF generation must release the ledger lock'); rendered.push(report); return Buffer.from('%PDF-synthetic'); },
    });
    const request = (url = '/', actor = 'admin') => new Promise((resolve, reject) => {
        const response = { statusCode: 200, headers: {},
            set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
            type(value) { return this.set('Content-Type', value); },
            status(value) { this.statusCode = value; return this; },
            json(body) { this.body = body; resolve(this); },
            send(body) { this.body = body; resolve(this); },
        };
        router.handle({ method: 'GET', url, headers: actor ? { authorization: actor } : {} }, response, error => error ? reject(error) : reject(new Error('No route matched')));
    });
    return { ...f, request, rendered };
}

test('monthly routes enforce fresh access and never accept another booster ID even for admins', async t => {
    const f = setup(t);
    for (const [actor, expected] of [[null, 401], ['customer', 403], ['suspended', 403], ['missing', 403]]) {
        assert.equal((await f.request('/', actor)).statusCode, expected);
    }
    assert.equal(f.state.reads.length, 0);
    const result = await f.request('/?boosterId=other&userId=other&currency=CAD');
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.deepEqual(result.body.reports.find(report => report.month === '2020-01').totals, [{ currency: 'USD', amountCents: 700 }]);
    assert.ok(f.state.reads.every(read => read.where.boosterId === 'admin' && read.where.currency === 'USD'));
    assert.equal((await f.request('/', 'provider')).statusCode, 200);
});

test('closed reports and PDFs preserve personal snapshots, attachment headers, and render outside the transaction', async t => {
    const f = setup(t);
    const report = await f.request('/2020-01?boosterId=other&currency=CAD');
    assert.equal(report.statusCode, 200);
    assert.equal(report.body.booster.displayName, 'My Booster');
    assert.equal(report.body.entries.length, 1);
    assert.deepEqual(report.body.totals, [{ currency: 'USD', amountCents: 700 }]);
    const pdf = await f.request('/2020-01/pdf');
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.headers['content-disposition'], 'attachment; filename="FastBoost-earnings-2020-01.pdf"');
    assert.equal(pdf.headers['cache-control'], 'private, no-store');
    assert.equal(pdf.body.toString(), '%PDF-synthetic');
    assert.deepEqual(f.rendered[0], report.body);
    assert.ok(f.rendered[0].entries.every(entry => entry.currency === 'USD'), 'PDF must contain only original USD ledger entries');
    assert.equal((await f.request('/9998-01/pdf')).statusCode, 400);
    assert.equal((await f.request('/invalid/pdf')).statusCode, 400);
    assert.equal((await f.request('/2019-12/pdf')).statusCode, 404);
    assert.equal(f.rendered.length, 1);
});

test('current month charts and details stay available while current and future PDF exports are rejected', async t => {
    const f = setup(t);
    const currentMonth = earningsMonth();
    f.state.entries.push(...['USD', 'CAD'].map(currency => ({ ...f.state.entries[0], id: `current-${currency}`, currency, amountCents: 1900,
        period: currentMonth, recognizedAt: new Date() })));
    const beforeRead = new Date();
    const current = await f.request(`/${currentMonth}`);
    assert.equal(current.statusCode, 200);
    assert.equal(current.body.period.closed, false);
    assert.ok(new Date(current.body.asOf) >= beforeRead && new Date(current.body.asOf) <= new Date());
    assert.deepEqual(current.body.totals, [{ currency: 'USD', amountCents: 1900 }]);
    assert.deepEqual(current.body.entries.map(entry => entry.currency), ['USD']);
    const summary = await f.request('/');
    assert.equal(summary.statusCode, 200);
    assert.deepEqual(summary.body.current.totals, [{ currency: 'USD', amountCents: 1900 }]);
    const reads = f.state.reads.length;
    const denied = await f.request(`/${currentMonth}/pdf?allowOpen=true&currency=CAD&boosterId=other`);
    assert.equal(denied.statusCode, 400);
    assert.match(denied.body.message, /after the calendar month ends/);
    assert.equal(denied.headers['content-disposition'], undefined);
    assert.equal((await f.request('/9998-01/pdf?allowOpen=true')).statusCode, 400);
    assert.equal((await f.request('/9998-01')).statusCode, 400);
    assert.equal(f.state.reads.length, reads, 'rejected periods never query ledger entries');
    assert.equal(f.rendered.length, 0, 'current and future months never reach the PDF renderer');
});

test('inactive monthly reporting returns an explicit unavailable response without opening balances on reads', async t => {
    const f = setup(t); f.state.activation = null;
    const result = await f.request('/');
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.available, false);
    assert.equal(f.state.activation, null);
    assert.equal(f.state.balances.length, 0);
});
