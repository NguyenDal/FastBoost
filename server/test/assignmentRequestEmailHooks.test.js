const test = require('node:test');
const assert = require('node:assert/strict');

function fixture(t) {
    const state = { requests: [], notifications: [], emails: [], assignments: [], locks: [], failQueue: false, onLock: null };
    const queueCalls = [];
    let active = false;
    let lockedOrderId = null;
    let transactionTail = Promise.resolve();
    const copy = value => structuredClone(value);
    const readRequest = ({ where }) => copy(state.requests.find(row => row.id === where.id) || null);
    const assertLocked = orderId => {
        assert.equal(active, true, 'mutation must use the active transaction');
        assert.equal(lockedOrderId, orderId, 'order must be locked before reading or changing invitation state');
    };
    const tx = {
        $queryRaw: async (strings, orderId) => {
            assert.equal(active, true);
            assert.match(strings.join('?'), /SELECT id FROM "Order" WHERE id = \? FOR UPDATE/);
            state.locks.push(orderId);
            lockedOrderId = orderId;
            if (state.onLock) { const callback = state.onLock; state.onLock = null; callback(); }
            return [{ id: orderId }];
        },
        orderAssignment: {
            findUnique: async ({ where: { orderId_boosterId: key } }) => {
                assertLocked(key.orderId);
                return copy(state.assignments.find(row => row.orderId === key.orderId && row.boosterId === key.boosterId) || null);
            },
        },
        assignmentRequest: {
            findUnique: async args => {
                assertLocked('order');
                return readRequest(args);
            },
            findFirst: async ({ where }) => {
                assertLocked(where.orderId);
                return copy(state.requests.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) || null);
            },
            create: async ({ data }) => {
                const row = { id: `request-${state.requests.length + 1}`, orderId: data.order.connect.id,
                    boosterId: data.booster.connect.id, requestedBy: data.requester.connect.id, status: data.status, respondedAt: null };
                assertLocked(row.orderId);
                state.requests.push(row);
                return copy(row);
            },
            update: async ({ where, data }) => {
                const row = state.requests.find(value => value.id === where.id);
                assert.ok(row, 'request must exist');
                assertLocked(row.orderId);
                Object.assign(row, copy(data));
                return copy(row);
            },
        },
        notification: {
            create: async ({ data }) => {
                assertLocked(data.data.orderId);
                const row = { id: `notification-${state.notifications.length + 1}`, active: true, read: false, ...copy(data) };
                state.notifications.push(row);
                return copy(row);
            },
            updateMany: async ({ where, data }) => {
                assertLocked('order');
                assert.deepEqual(where.data.path, ['requestId']);
                const rows = state.notifications.filter(row => row.userId === where.userId && row.type === where.type
                    && row.active === where.active && row.data.requestId === where.data.equals);
                rows.forEach(row => Object.assign(row, copy(data)));
                return { count: rows.length };
            },
        },
    };
    const db = {
        order: { findUnique: async ({ where }) => where.id === 'order' ? {
            id: 'order', orderNumber: 'TEST-INVITATION', boostType: 'Rank Boost', currentRank: 'Gold I', desiredRank: 'Platinum IV',
        } : null },
        user: { findUnique: async ({ where }) => ({ id: where.id, role: 'PROVIDER', suspendedAt: null }) },
        assignmentRequest: { findUnique: async args => readRequest(args) },
        $transaction: callback => {
            const run = transactionTail.then(async () => {
                const before = copy({ requests: state.requests, notifications: state.notifications, emails: state.emails });
                active = true;
                lockedOrderId = null;
                try { return await callback(tx); }
                catch (error) { Object.assign(state, before); throw error; }
                finally { active = false; lockedOrderId = null; }
            });
            transactionTail = run.catch(() => {});
            return run;
        },
    };
    const queueBoosterAssignmentRequestEmail = async (actualTx, requestId, event = 'ASSIGNMENT_REQUEST') => {
        assert.equal(actualTx, tx, 'email must be queued using the exact controller transaction');
        const request = state.requests.find(row => row.id === requestId);
        assert.ok(request);
        assertLocked(request.orderId);
        const notification = state.notifications.find(row => row.data.requestId === requestId);
        assert.ok(notification, 'notification must exist before email is queued');
        assert.equal(request.status, event === 'ASSIGNMENT_REQUEST' ? 'PENDING' : 'CANCELLED');
        assert.equal(notification.active, event === 'ASSIGNMENT_REQUEST');
        queueCalls.push({ tx: actualTx, requestId, event });
        state.emails.push({ requestId, event });
        if (state.failQueue) throw new Error('Synthetic invitation email queue failure');
    };
    const controllerFile = require.resolve('../src/controllers/assignmentRequestController');
    const replacements = new Map([
        [require.resolve('../src/prisma'), db],
        [require.resolve('../src/utils/boosterEarningsLedger'), { withEarningsLedgerMutation: async (_tx, _orderId, callback) => callback() }],
        [require.resolve('../src/utils/boosterOrderEmail'), {
            withBoosterOrderEmails: async (_tx, _orderId, callback) => callback(), queueBoosterAssignmentRequestEmail,
        }],
    ]);
    const previous = new Map([[controllerFile, require.cache[controllerFile]]]);
    for (const [file, exports] of replacements) {
        previous.set(file, require.cache[file]);
        require.cache[file] = { id: file, filename: file, loaded: true, exports };
    }
    delete require.cache[controllerFile];
    const controller = require(controllerFile);
    t.mock.method(console, 'error', () => {});
    t.after(() => {
        for (const [file, value] of previous) {
            if (value) require.cache[file] = value;
            else delete require.cache[file];
        }
    });
    return {
        state, tx, queueCalls,
        seedPending() {
            state.requests.push({ id: 'request-1', orderId: 'order', boosterId: 'booster', requestedBy: 'admin', status: 'PENDING', respondedAt: null });
            state.notifications.push({ id: 'notification-1', userId: 'booster', type: 'ASSIGNMENT_REQUEST', active: true, read: false,
                data: { requestId: 'request-1', orderId: 'order' } });
        },
        async invoke(method, requestId = 'request-1') {
            const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
            await controller[method]({ user: { id: 'admin', role: 'ADMIN' }, params: { orderId: 'order', boosterId: 'booster', requestId } }, res);
            return res;
        },
    };
}

test('create commits invitation, notification and email together; a repeated create is a no-op', async t => {
    const f = fixture(t);
    const created = await f.invoke('createAssignmentRequest');
    assert.equal(created.code, 201);
    assert.equal(created.body.request.id, 'request-1');
    assert.equal(f.state.requests.length, 1);
    assert.equal(f.state.notifications.length, 1);
    assert.equal(f.state.notifications[0].userId, 'booster');
    assert.equal(f.state.notifications[0].data.requestedBy, 'admin');
    assert.deepEqual(f.queueCalls, [{ tx: f.tx, requestId: 'request-1', event: 'ASSIGNMENT_REQUEST' }]);
    assert.deepEqual(f.state.emails, [{ requestId: 'request-1', event: 'ASSIGNMENT_REQUEST' }]);

    const repeated = await f.invoke('createAssignmentRequest');
    assert.equal(repeated.code, 200);
    assert.equal(repeated.body.request.id, created.body.request.id);
    assert.equal(f.state.requests.length, 1);
    assert.equal(f.state.notifications.length, 1);
    assert.equal(f.queueCalls.length, 1);
});

test('concurrent create retries check for pending invitations after the order lock', async t => {
    const f = fixture(t);
    const results = await Promise.all([f.invoke('createAssignmentRequest'), f.invoke('createAssignmentRequest')]);
    assert.deepEqual(results.map(row => row.code).sort(), [200, 201]);
    assert.equal(f.state.requests.length, 1);
    assert.equal(f.state.notifications.length, 1);
    assert.equal(f.queueCalls.length, 1);
    assert.deepEqual(f.state.locks, ['order', 'order']);
});

test('an already assigned booster receives no invitation notification or email', async t => {
    const f = fixture(t);
    f.state.assignments.push({ orderId: 'order', boosterId: 'booster' });
    assert.equal((await f.invoke('createAssignmentRequest')).code, 409);
    assert.deepEqual(f.state.requests, []);
    assert.deepEqual(f.state.notifications, []);
    assert.deepEqual(f.queueCalls, []);
});

test('cancel commits the pending transition and its email once, preserving other notifications', async t => {
    const f = fixture(t);
    f.seedPending();
    const unrelated = { id: 'other', userId: 'booster', type: 'ASSIGNMENT_REQUEST', active: true, read: false,
        data: { requestId: 'other-request', orderId: 'order' } };
    f.state.notifications.push(structuredClone(unrelated));
    const cancelled = await f.invoke('cancelAssignmentRequest');
    assert.equal(cancelled.code, 200);
    assert.equal(cancelled.body.request.status, 'CANCELLED');
    assert.ok(f.state.requests[0].respondedAt instanceof Date);
    assert.equal(f.state.notifications[0].active, false);
    assert.equal(f.state.notifications[0].read, true);
    assert.deepEqual(f.state.notifications[1], unrelated);
    assert.deepEqual(f.queueCalls, [{ tx: f.tx, requestId: 'request-1', event: 'ASSIGNMENT_REQUEST_CANCELLED' }]);

    assert.equal((await f.invoke('cancelAssignmentRequest')).code, 400);
    assert.equal((await f.invoke('cancelAssignmentRequest', 'missing')).code, 404);
    assert.equal(f.queueCalls.length, 1);
    assert.equal(f.state.emails.length, 1);
});

test('cancel rechecks pending status after locking and does not email a stale transition', async t => {
    const f = fixture(t);
    f.seedPending();
    f.state.onLock = () => { f.state.requests[0].status = 'ACCEPTED'; };
    assert.equal((await f.invoke('cancelAssignmentRequest')).code, 400);
    assert.equal(f.state.requests[0].status, 'ACCEPTED');
    assert.equal(f.state.notifications[0].active, true);
    assert.deepEqual(f.queueCalls, []);
});

test('create rolls back invitation and notification when email queuing fails, then retries cleanly', async t => {
    const f = fixture(t);
    f.state.failQueue = true;
    assert.equal((await f.invoke('createAssignmentRequest')).code, 500);
    assert.deepEqual(f.state.requests, []);
    assert.deepEqual(f.state.notifications, []);
    assert.deepEqual(f.state.emails, []);
    assert.equal(f.queueCalls.length, 1);
    f.state.failQueue = false;
    assert.equal((await f.invoke('createAssignmentRequest')).code, 201);
    assert.equal(f.state.requests.length, 1);
    assert.equal(f.state.notifications.length, 1);
    assert.equal(f.state.emails.length, 1);
});

test('cancel rolls back status and notification when email queuing fails, then retries cleanly', async t => {
    const f = fixture(t);
    f.seedPending();
    const before = structuredClone({ requests: f.state.requests, notifications: f.state.notifications });
    f.state.failQueue = true;
    assert.equal((await f.invoke('cancelAssignmentRequest')).code, 500);
    assert.deepEqual(f.state.requests, before.requests);
    assert.deepEqual(f.state.notifications, before.notifications);
    assert.deepEqual(f.state.emails, []);
    assert.equal(f.queueCalls.length, 1);
    f.state.failQueue = false;
    assert.equal((await f.invoke('cancelAssignmentRequest')).code, 200);
    assert.equal(f.state.requests[0].status, 'CANCELLED');
    assert.equal(f.state.notifications[0].active, false);
    assert.equal(f.state.emails.length, 1);
});
