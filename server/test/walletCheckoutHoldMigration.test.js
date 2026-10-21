const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function fixture(t) {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY); CREATE TABLE "Order" (id TEXT PRIMARY KEY);');
    for (const migration of ['20261020010000_customer_wallet', '20261021020000_wallet_checkout_holds']) {
        await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations', migration, 'migration.sql'), 'utf8'));
    }
    await db.exec(`INSERT INTO "User" VALUES ('customer');
        INSERT INTO "WalletAccount" ("userId", "purchasedBalanceCents", "promotionalBalanceCents", "updatedAt")
        VALUES ('customer', 500, 100, CURRENT_TIMESTAMP);
        INSERT INTO "Order" (id) VALUES ('order'), ('other');`);
    const insert = (overrides = {}) => {
        const hold = { id: 'hold', userId: 'customer', orderId: 'order', amountCents: 500, purchasedCents: 400,
            promotionalCents: 100, cashAmountCents: 1000, orderAmountCents: 1000,
            goldRedeemed: 0, goldDiscountCents: 0, stripeParametersJson: { currency: 'usd' },
            stripeCheckoutSessionId: null, ...overrides };
        return db.query(`INSERT INTO "WalletCheckoutHold" (${Object.keys(hold).map(key => `"${key}"`).join(', ')}, "updatedAt")
            VALUES (${Object.keys(hold).map((_, index) => `$${index + 1}`).join(', ')}, CURRENT_TIMESTAMP)`,
        Object.entries(hold).map(([key, value]) => key === 'stripeParametersJson' ? JSON.stringify(value) : value));
    };
    return { db, insert };
}

test('checkout reservations preserve balances and ledger until settlement, and retain referenced accounts and orders', async t => {
    const { db, insert } = await fixture(t);
    await insert();
    assert.deepEqual((await db.query('SELECT "purchasedBalanceCents", "promotionalBalanceCents" FROM "WalletAccount"')).rows,
        [{ purchasedBalanceCents: 500, promotionalBalanceCents: 100 }]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletEntry"')).rows[0].count, 0);
    await assert.rejects(db.exec(`DELETE FROM "Order" WHERE id = 'order'`), /WalletCheckoutHold_orderId_fkey/);
    await assert.rejects(db.exec(`DELETE FROM "WalletAccount" WHERE "userId" = 'customer'`), /WalletCheckoutHold_userId_fkey/);
    await db.exec(`DELETE FROM "WalletCheckoutHold" WHERE id = 'hold'; DELETE FROM "Order" WHERE id = 'order';`);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletEntry"')).rows[0].count, 0);
});

test('checkout reservations enforce one active quote per order and one binding per Stripe session', async t => {
    const { db, insert } = await fixture(t);
    await insert({ stripeCheckoutSessionId: 'cs_quote' });
    await assert.rejects(insert({ id: 'duplicate-order' }), /WalletCheckoutHold_orderId_key/);
    await assert.rejects(insert({ id: 'duplicate-session', orderId: 'other', stripeCheckoutSessionId: 'cs_quote' }),
        /WalletCheckoutHold_stripeCheckoutSessionId_key/);
    await insert({ id: 'recoverable', orderId: 'other' });
    await db.exec(`UPDATE "WalletCheckoutHold" SET "stripeCheckoutSessionId" = 'cs_recovered' WHERE id = 'recoverable'`);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletCheckoutHold"')).rows[0].count, 2);
});

test('checkout reservations reject unbalanced buckets, mismatched Gold and card amounts below the USD minimum', async t => {
    const { insert } = await fixture(t);
    for (const overrides of [
        { amountCents: 0, purchasedCents: 0, promotionalCents: 0 },
        { purchasedCents: -1, promotionalCents: 501 },
        { purchasedCents: 399 },
        { amountCents: 2147483647, purchasedCents: 2147483647, promotionalCents: 1 },
    ]) await assert.rejects(insert(overrides), /WalletCheckoutHold_amount_check/);
    for (const overrides of [
        { amountCents: 951, purchasedCents: 851 },
        { amountCents: 1000, purchasedCents: 900 },
        { cashAmountCents: 1001 },
        { goldRedeemed: -1, goldDiscountCents: -10 },
        { goldRedeemed: 99, goldDiscountCents: 990, orderAmountCents: 1990 },
        { goldRedeemed: 100, goldDiscountCents: 999, orderAmountCents: 1999 },
        { goldRedeemed: 2147483647, goldDiscountCents: 1 },
    ]) await assert.rejects(insert(overrides), /WalletCheckoutHold_quote_check/);
    await assert.rejects(insert({ stripeParametersJson: [] }), /WalletCheckoutHold_parameters_check/);
    await insert({ amountCents: 950, purchasedCents: 850, goldRedeemed: 100,
        goldDiscountCents: 1000, orderAmountCents: 2000 });
});

test('wallet-only hold migration preserves split quotes and allows only marked session-free full-wallet reservations', async t => {
    const { db, insert } = await fixture(t);
    await insert({ stripeCheckoutSessionId: 'cs_existing' });
    const before = (await db.query('SELECT * FROM "WalletCheckoutHold"')).rows;
    await db.exec(fs.readFileSync(path.join(__dirname,
        '../prisma/migrations/20261021030000_wallet_only_checkout_holds/migration.sql'), 'utf8'));
    assert.deepEqual((await db.query('SELECT * FROM "WalletCheckoutHold"')).rows, before);

    const walletOnly = { id: 'full', orderId: 'other', amountCents: 100, purchasedCents: 100, promotionalCents: 0,
        cashAmountCents: 100, orderAmountCents: 100, stripeParametersJson: { walletOnly: true } };
    await assert.rejects(insert({ ...walletOnly, stripeParametersJson: {} }), /WalletCheckoutHold_mode_check/);
    await assert.rejects(insert({ ...walletOnly, stripeParametersJson: { walletOnly: false } }), /WalletCheckoutHold_mode_check/);
    await assert.rejects(insert({ ...walletOnly, stripeParametersJson: { walletOnly: 'true' } }), /WalletCheckoutHold_mode_check/);
    await assert.rejects(insert({ ...walletOnly, stripeCheckoutSessionId: 'cs_forbidden' }), /WalletCheckoutHold_mode_check/);
    await assert.rejects(insert({ ...walletOnly, cashAmountCents: 150, orderAmountCents: 150 }), /WalletCheckoutHold_mode_check/);
    for (const remainder of [1, 49, -1]) await assert.rejects(insert({ ...walletOnly,
        amountCents: 100 - remainder, purchasedCents: 100 - remainder, stripeParametersJson: {} }), /WalletCheckoutHold_quote_check/);

    await insert(walletOnly);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletEntry"')).rows[0].count, 0);
    assert.deepEqual((await db.query('SELECT "purchasedBalanceCents", "promotionalBalanceCents" FROM "WalletAccount"')).rows,
        [{ purchasedBalanceCents: 500, promotionalBalanceCents: 100 }]);
    await assert.rejects(db.exec(`UPDATE "WalletCheckoutHold" SET "stripeCheckoutSessionId" = 'cs_late' WHERE id = 'full'`),
        /WalletCheckoutHold_mode_check/);
    await assert.rejects(db.exec(`UPDATE "WalletCheckoutHold" SET "purchasedCents" = 99 WHERE id = 'full'`),
        /WalletCheckoutHold_amount_check/);
    await db.exec(`UPDATE "WalletCheckoutHold" SET "goldRedeemed" = 100, "goldDiscountCents" = 1000, "orderAmountCents" = 1100 WHERE id = 'full';
        DELETE FROM "WalletCheckoutHold" WHERE id = 'full';`);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletCheckoutHold"')).rows[0].count, 1);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletEntry"')).rows[0].count, 0);
});
