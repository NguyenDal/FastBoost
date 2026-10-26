const test = require('node:test');
const assert = require('node:assert/strict');
const { clientOrigin } = require('../src/utils/clientOrigin');
const { paymentFixture } = require('../test-helpers/paymentFixture');

const request = (origin, hostname = 'api.fastboost.gg') => ({
    hostname,
    get: header => header === 'origin' ? origin : undefined,
});

test('payment return origins come only from a configured HTTPS site in production', () => {
    const forged = request('https://checkout-attacker.example');
    assert.equal(clientOrigin(forged, { configured: 'https://www.fastboost.gg/', nodeEnv: 'production' }),
        'https://www.fastboost.gg');
    for (const configured of ['', 'http://localhost:5173', 'http://www.fastboost.gg',
        'https://user:pass@www.fastboost.gg', 'https://www.fastboost.gg/order',
        'https://www.fastboost.gg/?return=https://checkout-attacker.example']) {
        assert.throws(() => clientOrigin(forged, { configured, nodeEnv: 'production' }),
            error => error.status === 503 && error.code === 'CHECKOUT_URL_UNAVAILABLE', configured);
    }
    assert.throws(() => clientOrigin(request('https://checkout-attacker.example', 'localhost'),
        { configured: '', nodeEnv: 'production' }), /Checkout is temporarily unavailable/);
});

test('local checkout fallback stays fixed to the development site', () => {
    assert.equal(clientOrigin(request('http://localhost:5173'),
        { configured: '', nodeEnv: 'development' }), 'http://localhost:5173');
    assert.equal(clientOrigin(request('https://checkout-attacker.example', 'localhost'),
        { configured: '', nodeEnv: 'development' }), 'http://localhost:5173');
    assert.throws(() => clientOrigin(request('https://checkout-attacker.example'),
        { configured: '', nodeEnv: 'development' }), /Checkout is temporarily unavailable/);
    assert.equal(clientOrigin(request('https://checkout-attacker.example'),
        { configured: 'http://localhost:5173', nodeEnv: 'development' }), 'http://localhost:5173');
});

test('checkout sessions use the configured site and a bad URL cannot expire an existing Gold checkout', async t => {
    const previousNodeEnv = process.env.NODE_ENV;
    t.after(() => {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    });
    const f = paymentFixture(t, { orders: [{ id: 'trusted' }, { id: 'unconfigured' },
        { id: 'paid', paymentStatus: 'PAID' }, { id: 'cancelled', status: 'CANCELLED' }] });
    const create = f.stripe.checkout.sessions.create;
    let returnUrl;
    f.stripe.checkout.sessions.create = async (...args) => {
        returnUrl = args[0].return_url;
        return create(...args);
    };
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://www.fastboost.gg';
    const trusted = await f.checkout('trusted');
    assert.equal(trusted.code, 200);
    assert.equal(returnUrl, 'https://www.fastboost.gg/checkout/trusted?session_id={CHECKOUT_SESSION_ID}');

    delete process.env.CLIENT_URL;
    const before = structuredClone(f.state.orders);
    const failed = await f.checkout('unconfigured');
    assert.equal(failed.code, 503);
    assert.equal(failed.body.code, 'CHECKOUT_URL_UNAVAILABLE');
    assert.equal(f.state.created.length, 1);
    assert.deepEqual(f.state.expired, []);
    assert.deepEqual(f.state.orders, before);
    assert.equal(f.sessions.get(trusted.body.sessionId).status, 'open');
    assert.equal(f.state.orders.find(order => order.id === 'trusted').stripeCheckoutSessionId, trusted.body.sessionId);
    assert.equal((await f.checkout('paid')).body.paid, true);
    assert.equal((await f.checkout('cancelled')).code, 400);
});
