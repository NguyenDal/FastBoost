const prisma = require('../prisma');
const stripe = require('../utils/stripeClient');
const { createWalletService } = require('../utils/customerWallet');
const { clientOrigin } = require('../utils/clientOrigin');
const wallet = createWalletService({ prisma, stripe,
    settleOrderPayment: (order, session) => require('./paymentController').completeCheckoutSessionPayment(order, session) });
const userId = req => req.user?.id || req.user?.userId;

function clientUrl(req) {
    try {
        return clientOrigin(req);
    } catch {
        throw Object.assign(new Error('Checkout is temporarily unavailable. Please try again later.'), { status: 503, code: 'WALLET_CHECKOUT_UNAVAILABLE' });
    }
}

const handle = action => async (req, res) => {
    const id = userId(req);
    if (!id) return res.status(401).json({ ok: false, message: 'Invalid user token.' });
    try {
        return res.json({ ok: true, ...await action(req, id) });
    } catch (error) {
        const expected = error.status && error.code?.startsWith('WALLET_');
        if (!expected) console.error('Wallet operation failed:', error.code || error.name);
        return res.status(expected ? error.status : 503).json({ ok: false,
            code: expected ? error.code : 'WALLET_UNAVAILABLE',
            message: expected ? error.message : 'Wallet is temporarily unavailable. Please retry the same top-up shortly.' });
    }
};

module.exports = {
    getWallet: handle((req, id) => wallet.snapshot(id)),
    createTopUp: handle((req, id) => wallet.createTopUp(id, req.body?.packageId, clientUrl(req), { uiMode: req.body?.uiMode })),
    verifyTopUp: handle((req, id) => wallet.verify(id, req.query || {})),
    cancelTopUp: handle((req, id) => wallet.cancel(id, req.body?.sessionId)),
};
