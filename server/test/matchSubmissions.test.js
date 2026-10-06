const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('selected match submissions protect ownership, customer visibility, quotes and final pay', async () => {
    const paths = ['../src/prisma', '../src/utils/riotMatches', '../src/routes/matchHistoryRoutes'].map(p => require.resolve(p));
    const saved = paths.map(p => [p, require.cache[p]]);
    let order = { id: 'order', customerId: 'customer', paymentStatus: 'PAID', status: 'IN_PROGRESS',
        amountCents: 10000, goldDiscountCents: 2000, currency: 'cad', matchHistoryEnabled: true, matchHistoryRevision: 0,
        assignments: [{ boosterId: 'a' }, { boosterId: 'b' }], contributions: [] };
    let matches = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, orderId: 'order', externalId: `NA1_${i}`,
        playedAt: new Date(), details: {}, status: 'PENDING', boosterId: null, revision: 1 }));
    let reviews = [];
    const matchesWhere = (match, where) => Object.entries(where).every(([key, value]) => {
        if (key === 'OR') return value.some(clause => matchesWhere(match, clause));
        if (value && typeof value === 'object') {
            if ('not' in value) return match[key] !== value.not;
            if ('in' in value) return value.in.includes(match[key]);
        }
        return match[key] === value;
    });
    const db = {
        $queryRaw: async () => [],
        order: { findUnique: async ({ where }) => where.id === order.id ? structuredClone(order) : null,
            update: async ({ data }) => { const revision = order.matchHistoryRevision + (data.matchHistoryRevision?.increment || 0); Object.assign(order, data, { matchHistoryRevision: revision }); } },
        user: { findMany: async () => [{ id: 'a', username: 'Alice' }, { id: 'b', username: 'Bob' }],
            findUnique: async ({ where }) => ['a', 'b'].includes(where.id) ? { role: 'PROVIDER' } : null },
        orderMatch: {
            findMany: async ({ where }) => structuredClone(matches.filter(m => matchesWhere(m, where))),
            findFirst: async ({ where }) => structuredClone(matches.find(m => matchesWhere(m, where)) || null),
            updateMany: async ({ where, data }) => {
                const changed = matches.filter(m => matchesWhere(m, where));
                for (const match of changed) Object.assign(match, data, { revision: match.revision + 1 });
                return { count: changed.length };
            },
        },
        orderMatchReview: { create: async ({ data }) => reviews.push(data), createMany: async ({ data }) => { reviews.push(...data); return { count: data.length }; } },
    };
    let lock = Promise.resolve();
    db.$transaction = fn => {
        const result = lock.then(async () => {
            const backup = structuredClone({ order, matches, reviews });
            try { return await fn(db); } catch (e) { ({ order, matches, reviews } = backup); throw e; }
        });
        lock = result.catch(() => {}); return result;
    };
    let server;
    try {
        require.cache[paths[0]] = { exports: db };
        require.cache[paths[1]] = { exports: { configured: () => true, importSettings: () => ({}), matchPlayerDetails: async () => ({ ranks: [] }) } };
        delete require.cache[paths[2]];
        const app = express(); app.use(express.json());
        app.use((req, res, next) => {
            const id = req.headers.authorization;
            if (!id) return res.sendStatus(401);
            req.actor = { id, role: id === 'admin' ? 'ADMIN' : id === 'customer' ? 'CUSTOMER' : 'PROVIDER' }; next();
        });
        app.use(require(paths[2])); app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const request = (path, who, body) => fetch(`http://127.0.0.1:${server.address().port}/match-history/order${path}`, {
            method: body ? 'POST' : 'GET', headers: { Authorization: who, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const select = (...ids) => ({ matches: ids.map(id => ({ id, revision: matches.find(m => m.id === id)?.revision || 1 })) });
        async function preview(who, selection) {
            const response = await request('/submission-preview', who, selection);
            assert.equal(response.status, 200); return response.json();
        }
        const submit = (who, selection, quote, extra = {}) => request('/submit', who, { ...selection, revision: quote.revision, estimatedCents: quote.estimatedCents, ...extra });
        const visible = async who => (await request('', who)).json();

        assert.deepEqual((await visible('customer')).matches, [], 'unclaimed imports must never reach customers');
        assert.equal((await request('/m0/player-details', 'customer')).status, 404, 'unclaimed player details are protected too');
        assert.equal((await request('/m0/player-details', 'foreign')).status, 404);
        assert.equal((await request('/m0/player-details', 'a')).status, 200);
        assert.equal((await visible('a')).matches.length, 12);
        assert.equal((await visible('a')).canSubmit, true);
        assert.equal((await visible('admin')).canSubmit, false, 'admin role alone is not a booster assignment');
        assert.equal((await request('/submission-preview', 'customer', select('m0'))).status, 403);
        assert.equal((await request('/submission-preview', 'foreign', select('m0'))).status, 404);
        for (const invalid of [{ matches: [] }, { matches: [{ id: 'm0', revision: 0 }] }, { matches: [null] }, { matches: [...select('m0').matches, ...select('m0').matches] }]) {
            assert.equal((await request('/submission-preview', 'a', invalid)).status, 400);
        }
        assert.equal((await request('/submission-preview', 'a', select('other-order-match'))).status, 409);
        const selectionA = select('m0', 'm6'); // Selection can span two displayed pages.
        const quoteA = await preview('a', selectionA);
        assert.equal(quoteA.selectedCount, 2); assert.equal(quoteA.totalMatches, 2); assert.equal(quoteA.estimatedCents, 5600);
        assert.equal(reviews.length, 0, 'opening or cancelling confirmation must not submit anything');
        assert.deepEqual((await visible('customer')).matches, []);
        assert.equal((await submit('a', selectionA, quoteA, { estimatedCents: 999999 })).status, 409);
        const submissions = await Promise.all([submit('a', selectionA, quoteA, { boosterId: 'b' }), submit('a', selectionA, quoteA)]);
        assert.deepEqual(submissions.map(r => r.status).sort(), [200, 409], 'double clicks must not double-submit');
        assert.equal(matches[0].boosterId, 'a', 'actor owns the claim, never the supplied boosterId');
        assert.equal(matches[6].boosterId, 'a'); assert.equal(matches[1].boosterId, null);
        assert.equal(reviews.length, 2); assert.ok(reviews.every(r => r.decision === 'SUBMITTED' && r.reviewerId === 'a'));
        assert.deepEqual((await visible('customer')).matches.map(m => m.id), ['m0', 'm6']);
        assert.equal((await request('/m0/player-details', 'customer')).status, 200);
        assert.equal((await visible('customer')).submission, undefined); assert.equal((await visible('customer')).earnings, undefined);
        assert.equal((await visible('a')).submission.estimatedCents, 5600);
        assert.deepEqual((await visible('admin')).earnings.shares, [], 'pending claims never fund payouts');
        assert.equal((await request('/submission-preview', 'b', select('m0'))).status, 409, 'another booster cannot steal a claim');

        const selectionB = select('m2');
        const staleQuote = await preview('b', selectionB);
        const extraA = select('m3'); const extraQuote = await preview('a', extraA);
        assert.equal(extraQuote.selectedCount, 1); assert.equal(extraQuote.totalMatches, 3, 'confirmation shows cumulative earnings, not an extra full pool');
        assert.equal((await submit('a', extraA, extraQuote)).status, 200);
        assert.equal((await submit('b', selectionB, staleQuote)).status, 409);
        const newQuote = await preview('b', selectionB);
        assert.equal(newQuote.estimatedCents, 1400);
        order.assignments = [{ boosterId: 'a' }];
        assert.equal((await submit('b', selectionB, newQuote)).status, 404, 'assignment must be checked again at submission');
        order.assignments.push({ boosterId: 'b' });
        order.amountCents = 12000;
        assert.equal((await submit('b', selectionB, newQuote)).status, 409, 'changed service revenue invalidates the quoted amount');
        order.amountCents = 10000;
        assert.equal((await submit('b', selectionB, newQuote)).status, 200);
        assert.equal((await visible('a')).submission.estimatedCents, 4200);
        assert.equal((await request('/m0/review', 'a', { decision: 'APPROVED', revision: matches[0].revision, boosterId: 'a' })).status, 403);

        order.status = 'COMPLETED';
        assert.equal((await request('/confirm', 'admin', { revision: order.matchHistoryRevision })).status, 409);
        for (const id of ['m0', 'm6', 'm2']) {
            const match = matches.find(m => m.id === id);
            assert.equal((await request(`/${id}/review`, 'admin', { decision: 'APPROVED', revision: match.revision, boosterId: match.boosterId })).status, 200);
        }
        assert.equal((await request('/confirm', 'admin', { revision: order.matchHistoryRevision })).status, 409, 'unreviewed submission blocks pay');
        assert.equal((await request('/m3/review', 'admin', { decision: 'REJECTED', revision: matches[3].revision, note: 'Not played for this order' })).status, 200);
        assert.deepEqual((await visible('customer')).matches.map(m => m.id), ['m0', 'm2', 'm6'], 'excluded claims leave the customer history');
        assert.equal((await request('/m3/player-details', 'customer')).status, 404);
        assert.equal((await request('/confirm', 'admin', { revision: order.matchHistoryRevision })).status, 200, 'unclaimed imports do not block confirmation');
        const final = await visible('admin');
        assert.deepEqual(final.earnings.shares.sort((a, b) => a.boosterId.localeCompare(b.boosterId)), [{ boosterId: 'a', matches: 2, cents: 3733 }, { boosterId: 'b', matches: 1, cents: 1867 }]);
        assert.equal((await visible('a')).submission.confirmedCents, 3733);
        assert.equal((await request('/submission-preview', 'a', select('m4'))).status, 409, 'finalized history cannot accept new claims');
        await request('/reopen', 'admin', { revision: order.matchHistoryRevision });
        assert.equal((await visible('a')).submission.confirmedCents, null);
        order.matchHistoryEnabled = false;
        assert.equal((await request('/submission-preview', 'a', select('m4'))).status, 409);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    }
});
