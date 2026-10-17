const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBoosterOrderEmail, boosterOrderEvents, withBoosterOrderEmails, queueBoosterAssignmentRequestEmail, deliverPendingBoosterOrderEmails, startBoosterOrderEmailWorker } = require('../src/utils/boosterOrderEmail');

const booster = id => ({ boosterId: id, booster: { id, role: 'PROVIDER', hasBoosterAccess: false, suspendedAt: null } });
const order = { id: 'synthetic/order', orderNumber: 'LOL-RNK-PREVIEW', status: 'IN_PROGRESS', paymentStatus: 'PAID', boostType: 'Rank Boost',
    currentRank: 'Silver I', desiredRank: 'Gold IV', queueType: 'Solo/Duo', region: 'North America', assignments: [booster('a'), booster('b')] };
const allEvents = ['ASSIGNED', 'UNASSIGNED', 'COMPLETED', 'CANCELLED', 'PAYMENT_CONFIRMED', 'ASSIGNMENT_REQUEST', 'ASSIGNMENT_REQUEST_CANCELLED'];
const subtotalLabel = 'Subtotal (before tax)';
const totalLabel = 'Total (after tax)';
const earningsLabel = 'Potential earnings (70% of subtotal)';

function configure(t) {
    const keys = ['CLIENT_URL', 'BOOSTER_ORDER_EMAILS_ENABLED', 'NODE_ENV'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.CLIENT_URL = 'https://fastboost.example';
    process.env.BOOSTER_ORDER_EMAILS_ENABLED = 'true';
    t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
}

test('email order snapshots select only fields and relations present in the generated Prisma schema', async t => {
    configure(t);
    // Metadata only: no PrismaClient is constructed and no database is contacted.
    const { Prisma } = require('../src/generated/prisma/client');
    const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
    function checkSelect(modelName, select) {
        const model = models.get(modelName);
        assert.ok(model, `Known Prisma model ${modelName}`);
        for (const [name, selection] of Object.entries(select)) {
            const field = model.fields.find(candidate => candidate.name === name);
            assert.ok(field, `Unknown Prisma field ${modelName}.${name}`);
            if (selection && typeof selection === 'object') {
                assert.equal(field.kind, 'object', `${modelName}.${name} must be a relation`);
                assert.ok(selection.select, `${modelName}.${name} has an explicit select`);
                checkSelect(field.type, selection.select);
            }
        }
    }
    const snapshots = [];
    await withBoosterOrderEmails({ order: { findUnique: async ({ select }) => {
        checkSelect('Order', select); snapshots.push(select); return null;
    } } }, 'synthetic-missing-order', async () => {});
    assert.equal(snapshots.length, 2, 'both locked snapshots are schema checked');
    const financeFields = ['amountCents', 'goldDiscountCents', 'cashAmountCents', 'totalPrice', 'currency'];
    for (const select of snapshots) for (const field of financeFields) assert.equal(select[field], true, `Order.${field} is loaded for financial rows`);
    for (const field of ['currentDivision', 'desiredDivision']) {
        assert.throws(() => checkSelect('Order', { ...snapshots[0], [field]: true }), /Unknown Prisma field Order\./);
    }
    assert.throws(() => checkSelect('Order', { assignments: { select: { booster: { select: { nonexistentField: true } } } } }), /Unknown Prisma field User\.nonexistentField/);

    const f = requestFixture();
    const findRequest = f.tx.assignmentRequest.findUnique;
    const findLatest = f.tx.assignmentRequest.findFirst;
    f.tx.assignmentRequest.findUnique = async args => {
        checkSelect('AssignmentRequest', args.select);
        for (const field of financeFields) assert.equal(args.select.order.select[field], true, `invitation loads Order.${field}`);
        return findRequest(args);
    };
    f.tx.assignmentRequest.findFirst = async args => { checkSelect('AssignmentRequest', args.select); return findLatest(args); };
    await queueBoosterAssignmentRequestEmail(f.tx, 'request-1');
    assert.equal(f.state.rows.length, 1, 'request/order/booster selections also match generated schema');
    const delivery = deliveryFixture('ASSIGNMENT_REQUEST');
    const freshRow = delivery.db.boosterOrderEmail.findUnique;
    delivery.db.boosterOrderEmail.findUnique = async args => { checkSelect('BoosterOrderEmail', args.include); return freshRow(args); };
    for (const method of ['findUnique', 'findFirst']) {
        const read = delivery.db.assignmentRequest[method];
        delivery.db.assignmentRequest[method] = async args => { checkSelect('AssignmentRequest', args.select); return read(args); };
    }
    await deliverPendingBoosterOrderEmails(delivery.db, { sendMail: async () => ({ accepted: ['current@example.test'] }) }, () => delivery.now);
    assert.ok(delivery.row.sentAt, 'delivery relation and request selections are schema checked');
});

test('all booster templates provide safe relevant links without customer, credential or payment secrets', t => {
    configure(t);
    for (const event of allEvents) {
        const mail = buildBoosterOrderEmail({ ...order, region: '<script>bad</script>', customer: { email: 'private@example.test' }, accountPassword: 'SECRET-PASSWORD', stripePaymentIntentId: 'pi_SECRET', accountUsername: 'SECRET-ACCOUNT' }, event);
        assert.match(mail.subject, /FastBoost.*LOL-RNK-PREVIEW/);
        assert.match(mail.text, /League of Legends/);
        assert.match(mail.text, /Rank Boost/);
        assert.equal(mail.to, undefined, 'recipient is resolved only at delivery');
        assert.doesNotMatch(JSON.stringify(mail), /private@example|SECRET|stripePaymentIntentId|accountPassword/);
        assert.doesNotMatch(mail.html, /<script>/);
        assert.doesNotMatch(mail.html, /Your current assignments and contribution status are in/);
        assert.doesNotMatch(mail.text, /^Booster Portal:/m);
        assert.equal((mail.html.match(/<a\b/gi) || []).length, 1, `${event} has one HTML action link`);
        assert.equal((mail.text.match(/https:\/\//g) || []).length, 1, `${event} has one text action URL`);
        assert.match(mail.html, /&lt;script&gt;/);
        assert.match(mail.text, /Current Rank: Silver I/);
        assert.match(mail.text, /Target Rank: Gold IV/);
        if (['UNASSIGNED', 'ASSIGNMENT_REQUEST', 'ASSIGNMENT_REQUEST_CANCELLED'].includes(event)) {
            assert.match(mail.text, /: https:\/\/fastboost.example\/provider\/portal/);
            assert.doesNotMatch(mail.text + mail.html, /\/match\//);
        } else {
            assert.match(mail.html, /href="https:\/\/fastboost.example\/match\/synthetic%2Forder"/);
        }
    }
    assert.match(buildBoosterOrderEmail(order, 'ASSIGNMENT_REQUEST').text, /review and respond/);
    assert.match(buildBoosterOrderEmail(order, 'ASSIGNMENT_REQUEST_CANCELLED').text, /No response or work is required/);
    assert.throws(() => buildBoosterOrderEmail(order, '__proto__'));
    process.env.NODE_ENV = 'production';
    for (const origin of ['http://fastboost.example', 'https://localhost', 'http://localhost:5173', 'javascript:alert(1)']) {
        process.env.CLIENT_URL = origin;
        assert.throws(() => buildBoosterOrderEmail(order, 'ASSIGNED'));
    }
});

function financialRow(mail, label) {
    const line = mail.text.split('\n').find(value => value.startsWith(`${label}: `));
    assert.ok(line, `${label} is present in plain text`);
    const value = line.slice(label.length + 2);
    assert.ok(mail.html.includes(`>${label}</td>`), `${label} is present in HTML`);
    assert.ok(mail.html.includes(`>${value}</td>`), `${label} value is present in HTML`);
    return value;
}

function moneyRow(mail, label, expected, potential = false) {
    const value = financialRow(mail, label);
    if (potential) assert.match(value, /^Up to /);
    assert.match(value, /\$|USD/);
    assert.equal(value.replace(/^Up to /, '').replace(/USD|\$|\s/g, ''), expected.toFixed(2), `${label} matches its monetary basis`);
}

test('all events show pre-tax subtotal, saved total and potential earnings on the same discounted basis', t => {
    configure(t);
    for (const event of allEvents) {
        const mail = buildBoosterOrderEmail({ ...order, amountCents: 10000, goldDiscountCents: 0, cashAmountCents: 11300,
            totalPrice: 100, currency: 'usd', couponDiscountCents: 2000, referralDiscount: 10 }, event);
        moneyRow(mail, subtotalLabel, 100);
        moneyRow(mail, totalLabel, 113);
        moneyRow(mail, earningsLabel, 70, true);
        assert.equal((mail.text.match(/^(Subtotal|Total|Potential earnings) \([^)]+\):/gm) || []).length, 3);
        assert.match(mail.text, /Potential earnings are shared by approved matches\./);
        assert.match(mail.html, /Potential earnings are shared by approved matches\./);
        assert.doesNotMatch(mail.text + mail.html, /79\.10/, 'tax is excluded from the earnings pool');
        assert.doesNotMatch(mail.text, /^Tax:|tax rate|guaranteed|payable now/im, 'no inferred tax or promised payout');
    }
});

test('all event financial rows account for Gold redemption, actual cash totals, zero and cent rounding', t => {
    configure(t);
    for (const event of allEvents) {
        for (const [amountCents, goldDiscountCents, cashAmountCents, subtotal, total, potential] of [
            [10000, 2000, 9040, 80, 90.40, 56],
            [10000, 2000, 8000, 80, 80, 56],
            [10000, 10000, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [10001, 0, 11301, 100.01, 113.01, 70.01],
        ]) {
            const mail = buildBoosterOrderEmail({ ...order, amountCents, goldDiscountCents, cashAmountCents, totalPrice: amountCents / 100, currency: 'usd' }, event);
            moneyRow(mail, subtotalLabel, subtotal);
            moneyRow(mail, totalLabel, total);
            moneyRow(mail, earningsLabel, potential, true);
        }
    }
});

test('missing canonical service amounts stay unavailable while independently saved totals remain visible', t => {
    configure(t);
    for (const event of allEvents) {
        for (const [fields, total] of [
            [{ amountCents: null, cashAmountCents: 11300, totalPrice: 100 }, 113],
            [{ amountCents: null, cashAmountCents: null, totalPrice: 100, goldDiscountCents: 2000 }, 80],
            [{ amountCents: null, cashAmountCents: 0 }, 0],
            [{}, null],
            [{ amountCents: null, cashAmountCents: null, totalPrice: null }, null],
        ]) {
            const mail = buildBoosterOrderEmail({ ...order, ...fields, currency: 'usd' }, event);
            assert.equal(financialRow(mail, subtotalLabel), 'Not available');
            assert.equal(financialRow(mail, earningsLabel), 'Not available');
            if (total === null) {
                assert.equal(financialRow(mail, totalLabel), 'Not available');
                assert.doesNotMatch(mail.text + mail.html, /\$0\.00|USD\s*0\.00/, 'unknown money must not become zero');
            } else moneyRow(mail, totalLabel, total);
        }
    }
});

test('all notification events retain identical detailed order and pricing rows for every service', t => {
    configure(t);
    for (const gamePrefix of ['', 'TFT ']) for (const [service, fields, specificRows] of [
        ['Rank Boost', {}, [['Current Rank', 'Silver I'], ['Target Rank', 'Gold IV']]],
        ['Placement Boost', { peakRank: 'Emerald II', placementGames: 5 }, [['Peak Rank', 'Emerald II'], ['Placement Matches', '5']]],
        ['Win Boost', { desiredWins: 7 }, [['Current Rank', 'Silver I'], ['Ranked Wins', '7']]],
        ['Pro Duo', { numberOfGames: 3 }, [['Current Rank', 'Silver I'], ['Games', '3']]],
    ]) {
        const fixture = { ...order, ...fields, boostType: `${gamePrefix}${service}`, amountCents: 10000,
            goldDiscountCents: 0, cashAmountCents: 11300, totalPrice: 100, currency: 'usd' };
        const mails = allEvents.map(event => buildBoosterOrderEmail(fixture, event));
        // Compare the actual rendered table, not only common matching snippets.
        const detailTables = mails.map(mail => mail.html.match(/<table role="presentation"[^>]+style="border:1px solid #e1dcfa;border-radius:10px">[\s\S]+?<\/table><\/td><\/tr><\/table>/)?.[0]);
        assert.ok(detailTables[0]);
        for (const [index, mail] of mails.entries()) {
            assert.equal(detailTables[index], detailTables[0], `${fixture.boostType}: ${allEvents[index]} matches the assignment table`);
            for (const [label, value] of [...specificRows, ['Queue Type', 'Solo/Duo'], ['Server / Region', 'North America']]) {
                assert.equal(financialRow(mail, label), value, `${allEvents[index]} keeps ${label}`);
            }
            assert.equal(financialRow(mail, 'Game'), gamePrefix ? 'Teamfight Tactics' : 'League of Legends');
            assert.equal(financialRow(mail, 'Service'), service);
            assert.match(mail.text, /Potential earnings are shared by approved matches\./);
        }
    }
});

function requestFixture() {
    const request = { id: 'request-1', orderId: order.id, boosterId: 'a', status: 'PENDING', createdAt: new Date('2026-10-16T12:00:00Z'),
        order: { ...structuredClone(order), assignments: [] }, booster: booster('a').booster };
    const state = { requests: [request], rows: [] };
    const tx = {
        assignmentRequest: {
            findUnique: async ({ where }) => structuredClone(state.requests.find(candidate => candidate.id === where.id) || null),
            findFirst: async ({ where, orderBy }) => {
                assert.deepEqual(orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
                return structuredClone(state.requests.filter(candidate => candidate.orderId === where.orderId && candidate.boosterId === where.boosterId)
                    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] || null);
            },
        },
        boosterOrderEmail: {
            updateMany: async ({ where, data }) => {
                const rows = state.rows.filter(row => row.orderId === where.orderId && row.boosterId === where.boosterId && row.id !== where.id.not && !row.sentAt && !row.skippedAt &&
                    where.OR.some(filter => row.payload.assignmentRequest?.event === filter.payload.equals));
                rows.forEach(row => Object.assign(row, data));
                return { count: rows.length };
            },
            createMany: async ({ data, skipDuplicates }) => {
                assert.equal(skipDuplicates, true);
                const fresh = data.filter(row => !state.rows.some(existing => existing.id === row.id));
                state.rows.push(...structuredClone(fresh).map(row => ({ ...row, sentAt: null, skippedAt: null })));
                return { count: fresh.length };
            },
        },
    };
    return { request, state, tx };
}

test('request outbox is idempotent per request/event, cancels invitations and isolates real assignment alerts', async t => {
    configure(t);
    const f = requestFixture();
    const actualAssignment = { id: 'actual-assignment', orderId: order.id, boosterId: 'a', event: 'ASSIGNED', payload: buildBoosterOrderEmail(order, 'ASSIGNED'), sentAt: null, skippedAt: null };
    f.state.rows.push(actualAssignment);
    await queueBoosterAssignmentRequestEmail(f.tx, f.request.id);
    await queueBoosterAssignmentRequestEmail(f.tx, f.request.id);
    assert.equal(f.state.rows.length, 2);
    const invitation = f.state.rows[1];
    assert.equal(invitation.event, 'ASSIGNED', 'uses the existing database CHECK category');
    assert.deepEqual(invitation.payload.assignmentRequest, { id: 'request-1', event: 'ASSIGNMENT_REQUEST' });
    assert.equal(actualAssignment.skippedAt, null);

    f.request.status = 'CANCELLED';
    await queueBoosterAssignmentRequestEmail(f.tx, f.request.id, 'ASSIGNMENT_REQUEST_CANCELLED');
    await queueBoosterAssignmentRequestEmail(f.tx, f.request.id, 'ASSIGNMENT_REQUEST_CANCELLED');
    assert.equal(f.state.rows.length, 3);
    assert.ok(invitation.skippedAt, 'cancelled pending invitation is suppressed atomically');
    const cancellation = f.state.rows[2];
    assert.equal(cancellation.event, 'UNASSIGNED');
    assert.deepEqual(cancellation.payload.assignmentRequest, { id: 'request-1', event: 'ASSIGNMENT_REQUEST_CANCELLED' });
    assert.equal(actualAssignment.skippedAt, null);

    f.state.requests.push({ ...structuredClone(f.request), id: 'request-2', status: 'PENDING', createdAt: new Date('2026-10-16T13:00:00Z') });
    await queueBoosterAssignmentRequestEmail(f.tx, 'request-2');
    assert.ok(cancellation.skippedAt, 'new episode suppresses an obsolete cancellation');
    assert.equal(f.state.rows[3].skippedAt, null);
    assert.notEqual(f.state.rows[3].id, invitation.id, 'new requests have independent delivery IDs');
    await queueBoosterAssignmentRequestEmail(f.tx, f.request.id, 'ASSIGNMENT_REQUEST_CANCELLED');
    assert.equal(f.state.rows[3].skippedAt, null, 'retrying an older episode cannot suppress the new invitation');
});

test('request helper ignores disabled, stale, invalid-status, assigned and ineligible requests', async t => {
    configure(t);
    process.env.BOOSTER_ORDER_EMAILS_ENABLED = 'false';
    assert.equal(await queueBoosterAssignmentRequestEmail({}, 'unused'), null);
    process.env.BOOSTER_ORDER_EMAILS_ENABLED = 'true';
    await assert.rejects(queueBoosterAssignmentRequestEmail({}, 'unused', 'CANCELLED'), /Unknown assignment request/);
    for (const change of [
        f => { f.state.requests.length = 0; },
        f => { f.request.status = 'ACCEPTED'; },
        f => { f.request.booster.role = 'CUSTOMER'; },
        f => { f.request.booster.suspendedAt = new Date(); },
        f => { f.request.order.assignments = [booster('a')]; },
        f => { f.request.order.status = 'CANCELLED'; },
        f => { f.request.order = null; },
        f => { f.state.requests.push({ ...f.request, id: 'request-2', createdAt: new Date('2026-10-16T13:00:00Z') }); },
    ]) {
        const f = requestFixture(); change(f);
        assert.equal(await queueBoosterAssignmentRequestEmail(f.tx, 'request-1'), null);
        assert.equal(f.state.rows.length, 0);
    }
    const f = requestFixture();
    assert.equal(await queueBoosterAssignmentRequestEmail(f.tx, 'request-1', 'ASSIGNMENT_REQUEST_CANCELLED'), null);
    assert.equal(f.state.rows.length, 0, 'cancellation requires an actual CANCELLED request');
});

test('only actual assignment/status/payment transitions select directly affected eligible boosters', () => {
    assert.deepEqual(boosterOrderEvents(order, structuredClone(order)), []);
    assert.deepEqual(boosterOrderEvents({ ...order, assignments: [booster('a')] }, { ...order, assignments: [booster('b'), booster('b')] }), [
        { boosterId: 'b', event: 'ASSIGNED' }, { boosterId: 'a', event: 'UNASSIGNED' },
    ]);
    for (const [status, event] of [['COMPLETED', 'COMPLETED'], ['CANCELLED', 'CANCELLED']]) {
        assert.deepEqual(boosterOrderEvents(order, { ...order, status }), [{ boosterId: 'a', event }, { boosterId: 'b', event }]);
        assert.deepEqual(boosterOrderEvents({ ...order, status }, { ...order, status }), []);
    }
    assert.deepEqual(boosterOrderEvents({ ...order, paymentStatus: 'PENDING', assignments: [booster('a')] }, order), [
        { boosterId: 'b', event: 'ASSIGNED' }, { boosterId: 'a', event: 'PAYMENT_CONFIRMED' },
    ]);
    assert.deepEqual(boosterOrderEvents({ ...order, paymentStatus: 'PENDING', assignments: [] }, { ...order, assignments: [] }), [], 'no broadcast to unassigned boosters on payment');
    const inactive = [{ boosterId: 'suspended', booster: { role: 'PROVIDER', suspendedAt: new Date() } }, { boosterId: 'customer', booster: { role: 'CUSTOMER' } }, { boosterId: 'admin', booster: { role: 'ADMIN' } }];
    assert.deepEqual(boosterOrderEvents({ ...order, assignments: [] }, { ...order, assignments: inactive }), []);
    assert.deepEqual(boosterOrderEvents({ ...order, assignments: [] }, { ...order, assignments: [{ boosterId: 'admin', booster: { role: 'ADMIN', hasBoosterAccess: true } }] }), [{ boosterId: 'admin', event: 'ASSIGNED' }]);
});

function mutationFixture() {
    const state = { order: { ...structuredClone(order), assignments: [] }, rows: [], reads: 0, failQueue: false };
    const tx = {
        order: { findUnique: async ({ select }) => {
            state.reads++;
            assert.equal(select.customer, undefined); assert.equal(select.accountPassword, undefined);
            return structuredClone(state.order);
        } },
        boosterOrderEmail: { updateMany: async ({ where, data }) => {
            const rows = state.rows.filter(row => row.orderId === where.orderId && row.boosterId === where.boosterId && row.event === where.event && row.sentAt === null && row.skippedAt === null);
            for (const row of rows) Object.assign(row, data);
            return { count: rows.length };
        }, createMany: async ({ data }) => {
            if (state.failQueue) throw new Error('Simulated queue failure');
            state.rows.push(...structuredClone(data).map(row => ({ sentAt: null, skippedAt: null, ...row })));
        } },
    };
    let lock = Promise.resolve();
    const transaction = mutation => {
        const pending = lock.then(async () => {
            const before = structuredClone(state);
            try { return await withBoosterOrderEmails(tx, order.id, mutation); }
            catch (error) { Object.assign(state, before); throw error; }
        });
        lock = pending.catch(() => {}); return pending;
    };
    return { state, tx, transaction };
}

test('locked snapshots enqueue once on retries/nested calls, with a fresh event for a later reassignment', async t => {
    configure(t);
    const f = mutationFixture();
    await Promise.all([1, 2].map(() => f.transaction(async () => { f.state.order.assignments = [booster('a')]; return 'updated'; })));
    assert.equal(f.state.rows.length, 1);
    assert.equal(f.state.rows[0].event, 'ASSIGNED');
    assert.match(f.state.rows[0].id, /^[a-f\d-]{36}$/);
    const nestedResult = await f.transaction(() => withBoosterOrderEmails(f.tx, order.id, async () => { f.state.order.assignments = []; return 42; }));
    assert.equal(nestedResult, 42);
    assert.deepEqual(f.state.rows.map(row => row.event), ['ASSIGNED', 'UNASSIGNED']);
    await f.transaction(async () => { f.state.order.assignments = [booster('a')]; });
    assert.deepEqual(f.state.rows.map(row => row.event), ['ASSIGNED', 'UNASSIGNED', 'ASSIGNED']);
    assert.equal(new Set(f.state.rows.map(row => row.id)).size, 3);
    assert.ok(f.state.rows[0].skippedAt, 'a repeated assignment supersedes its older pending episode');
    assert.equal(f.state.rows[2].skippedAt, null);
    process.env.BOOSTER_ORDER_EMAILS_ENABLED = 'false';
    const reads = f.state.reads;
    assert.equal(await withBoosterOrderEmails({}, order.id, async () => 'no-email'), 'no-email');
    assert.equal(f.state.reads, reads);
    assert.equal(startBoosterOrderEmailWorker({}), undefined);
});

test('outbox failures roll back the order mutation and retry queues the event once', async t => {
    configure(t);
    const f = mutationFixture();
    f.state.failQueue = true;
    await assert.rejects(f.transaction(async () => { f.state.order.assignments = [booster('a')]; }), /queue failure/);
    assert.deepEqual(f.state.order.assignments, []);
    assert.equal(f.state.rows.length, 0);
    f.state.failQueue = false;
    await f.transaction(async () => { f.state.order.assignments = [booster('a')]; });
    assert.equal(f.state.rows.length, 1);
});

function deliveryFixture(event = 'ASSIGNED') {
    const now = new Date('2026-10-16T12:00:00Z');
    const requestEvent = ['ASSIGNMENT_REQUEST', 'ASSIGNMENT_REQUEST_CANCELLED'].includes(event);
    const row = { id: 'event-uuid', orderId: order.id, boosterId: 'a', event: requestEvent ? (event === 'ASSIGNMENT_REQUEST' ? 'ASSIGNED' : 'UNASSIGNED') : event, payload: buildBoosterOrderEmail(order, event), attempts: 0, nextAttemptAt: now, sentAt: null, skippedAt: null, claim: null };
    const current = { order: structuredClone(order), booster: { role: 'PROVIDER', email: 'current@example.test', suspendedAt: null } };
    const state = { beforeFresh: null, request: { id: 'request-1', orderId: order.id, boosterId: 'a', status: event === 'ASSIGNMENT_REQUEST' ? 'PENDING' : 'CANCELLED', createdAt: now }, latestRequestId: 'request-1' };
    if (requestEvent) { row.payload.assignmentRequest = { id: 'request-1', event }; current.order.assignments = []; }
    const matches = where => !row.sentAt && !row.skippedAt && (!where.claim || where.claim === row.claim) &&
        (where.attempts === undefined || where.attempts === row.attempts) && (!where.nextAttemptAt || row.nextAttemptAt <= where.nextAttemptAt.lte);
    const db = { assignmentRequest: {
        findUnique: async ({ where }) => { assert.equal(where.id, 'request-1'); return structuredClone(state.request); },
        findFirst: async ({ where }) => { assert.deepEqual(where, { orderId: order.id, boosterId: 'a' }); return { id: state.latestRequestId }; },
    }, boosterOrderEmail: {
        findMany: async ({ where, take }) => { assert.equal(take, 10); return !row.sentAt && !row.skippedAt && row.attempts < where.attempts.lt && row.nextAttemptAt <= where.nextAttemptAt.lte ? [structuredClone(row)] : []; },
        findUnique: async () => { state.beforeFresh?.(); return { ...structuredClone(row), ...structuredClone(current) }; },
        updateMany: async ({ where, data }) => {
            if (!matches(where)) return { count: 0 };
            const attempts = row.attempts + (data.attempts?.increment || 0);
            Object.assign(row, data, { attempts }); return { count: 1 };
        },
    } };
    return { now, row, current, state, db };
}

test('delivery uses current booster email, stable message IDs, bounded retry and concurrent claims', async t => {
    configure(t); t.mock.method(console, 'error', () => {});
    const f = deliveryFixture();
    let sent = 0;
    const messageIds = [];
    const failedTransport = { sendMail: async mail => {
        messageIds.push(mail.messageId);
        throw Object.assign(new Error('private SMTP message'), { code: 'ETIMEDOUT' });
    } };
    await deliverPendingBoosterOrderEmails(f.db, failedTransport, () => f.now);
    assert.equal(f.row.attempts, 1); assert.equal(f.row.sentAt, null); assert.equal(f.row.lastError, 'ETIMEDOUT');
    assert.ok(f.row.nextAttemptAt > f.now);
    f.current.booster.email = 'changed@example.test';
    const transport = { sendMail: async mail => {
        sent++; messageIds.push(mail.messageId);
        assert.deepEqual(mail.to, { address: 'changed@example.test' });
        assert.equal(mail.disableFileAccess, true); assert.equal(mail.disableUrlAccess, true);
        return { accepted: ['changed@example.test'] };
    } };
    await deliverPendingBoosterOrderEmails(f.db, transport, () => f.now);
    assert.equal(sent, 0);
    const due = f.row.nextAttemptAt;
    await Promise.all([deliverPendingBoosterOrderEmails(f.db, transport, () => due), deliverPendingBoosterOrderEmails(f.db, transport, () => due)]);
    assert.equal(sent, 1); assert.ok(f.row.sentAt); assert.equal(f.row.claim, null);
    assert.equal(new Set(messageIds).size, 1);
    await deliverPendingBoosterOrderEmails(f.db, transport, () => new Date(due.getTime() + 600000));
    assert.equal(sent, 1);
    f.row.sentAt = null; f.row.attempts = 8;
    await deliverPendingBoosterOrderEmails(f.db, transport, () => new Date(due.getTime() + 600000));
    assert.equal(sent, 1);
});

test('superseded events and revoked booster access are skipped after a fresh eligibility check', async t => {
    configure(t);
    for (const [event, mutate] of [
        ['ASSIGNED', f => { f.current.order.assignments = []; }],
        ['ASSIGNED', f => { f.current.order.status = 'COMPLETED'; }],
        ['COMPLETED', f => { f.current.order.status = 'CANCELLED'; }],
        ['CANCELLED', f => { f.current.order.status = 'IN_PROGRESS'; }],
        ['PAYMENT_CONFIRMED', f => { f.current.order.paymentStatus = 'PENDING'; }],
        ['UNASSIGNED', () => {}],
        ['ASSIGNED', f => { f.current.booster.suspendedAt = new Date(); }],
        ['ASSIGNED', f => { f.current.booster.role = 'CUSTOMER'; }],
    ]) {
        const f = deliveryFixture(event);
        f.state.beforeFresh = () => mutate(f);
        await deliverPendingBoosterOrderEmails(f.db, { sendMail: async () => assert.fail('ineligible alert must not be sent') }, () => f.now);
        assert.ok(f.row.skippedAt, event); assert.equal(f.row.claim, null); assert.equal(f.row.sentAt, null);
        assert.equal(f.row.lastError, 'EVENT_SUPERSEDED');
    }
});

test('unassignment alerts send without order access; all event types deliver when still relevant', async t => {
    configure(t);
    for (const event of ['ASSIGNED', 'UNASSIGNED', 'COMPLETED', 'CANCELLED', 'PAYMENT_CONFIRMED']) {
        const f = deliveryFixture(event);
        if (event === 'UNASSIGNED') f.current.order.assignments = [];
        if (event === 'COMPLETED') f.current.order.status = 'COMPLETED';
        if (event === 'CANCELLED') f.current.order.status = 'CANCELLED';
        let sent = 0;
        await deliverPendingBoosterOrderEmails(f.db, { sendMail: async () => { sent++; return { accepted: ['current@example.test'] }; } }, () => f.now);
        assert.equal(sent, 1, event); assert.ok(f.row.sentAt); assert.equal(f.row.skippedAt, null);
    }
});

test('request emails deliver without assignment access and never pass request metadata to SMTP', async t => {
    configure(t);
    for (const event of ['ASSIGNMENT_REQUEST', 'ASSIGNMENT_REQUEST_CANCELLED']) {
        const f = deliveryFixture(event);
        let sent = 0;
        await deliverPendingBoosterOrderEmails(f.db, { sendMail: async mail => {
            sent++;
            assert.equal(mail.assignmentRequest, undefined);
            assert.equal(mail.event, undefined);
            assert.equal(mail.to.address, 'current@example.test');
            assert.doesNotMatch(mail.text + mail.html, /\/match\//);
            assert.match(mail.text, /https:\/\/fastboost.example\/provider\/portal/);
            assert.deepEqual(Object.keys(mail).sort(), ['subject', 'text', 'html', 'to', 'from', 'messageId', 'disableFileAccess', 'disableUrlAccess'].sort());
            return { accepted: ['current@example.test'] };
        } }, () => f.now);
        assert.equal(sent, 1, event); assert.ok(f.row.sentAt); assert.equal(f.row.skippedAt, null);
        assert.deepEqual(f.row.payload.assignmentRequest, { id: 'request-1', event }, 'immutable request metadata remains in the outbox');
    }
});

test('request delivery rechecks exact status, episode, recipient eligibility and current access', async t => {
    configure(t);
    for (const event of ['ASSIGNMENT_REQUEST', 'ASSIGNMENT_REQUEST_CANCELLED']) {
        const changes = [
            f => { f.state.request = null; },
            f => { f.state.request.orderId = 'other-order'; },
            f => { f.state.request.boosterId = 'other-booster'; },
            f => { f.state.request.status = 'ACCEPTED'; },
            f => { f.state.request.status = 'DECLINED'; },
            f => { f.state.request.status = 'EXPIRED'; },
            f => { f.state.latestRequestId = 'newer-pending-or-accepted-request'; },
            f => { f.current.booster.suspendedAt = new Date(); },
            f => { f.current.booster.role = 'CUSTOMER'; },
            f => { f.current.order.assignments = [booster('a')]; },
            f => { f.row.payload.assignmentRequest = null; },
            f => { f.row.payload.assignmentRequest.id = ''; },
            f => { f.row.payload.assignmentRequest.event = '__proto__'; },
            f => { f.row.event = 'PAYMENT_CONFIRMED'; },
        ];
        if (event === 'ASSIGNMENT_REQUEST') changes.push(
            f => { f.state.request.status = 'CANCELLED'; },
            f => { f.current.order.status = 'CANCELLED'; },
            f => { f.current.order.status = 'COMPLETED'; },
        );
        else changes.push(f => { f.state.request.status = 'PENDING'; });
        for (const change of changes) {
            const f = deliveryFixture(event);
            f.state.beforeFresh = () => change(f);
            await deliverPendingBoosterOrderEmails(f.db, { sendMail: async () => assert.fail('stale request must not send') }, () => f.now);
            assert.ok(f.row.skippedAt, `${event}: ${change}`);
            assert.equal(f.row.sentAt, null);
            assert.equal(f.row.lastError, 'EVENT_SUPERSEDED');
        }
    }
});

test('invalid addresses and accepting a different recipient never mark a booster alert sent', async t => {
    configure(t); t.mock.method(console, 'error', () => {});
    const invalid = deliveryFixture(); invalid.current.booster.email = 'bad@example.test\r\nBcc: other@example.test';
    await deliverPendingBoosterOrderEmails(invalid.db, { sendMail: async () => assert.fail('invalid recipient must not reach SMTP') }, () => invalid.now);
    assert.equal(invalid.row.sentAt, null); assert.equal(invalid.row.lastError, 'DELIVERY_FAILED');
    const rejected = deliveryFixture();
    await deliverPendingBoosterOrderEmails(rejected.db, { sendMail: async () => ({ accepted: ['other@example.test'] }) }, () => rejected.now);
    assert.equal(rejected.row.sentAt, null); assert.equal(rejected.row.lastError, 'DELIVERY_FAILED');
});
