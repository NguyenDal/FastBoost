const test = require('node:test');
const assert = require('node:assert/strict');

test('support schema saves replies and queues offline alerts atomically (rolled back)', { skip: process.env.SUPPORT_DB_TEST !== 'true' }, async () => {
    require('dotenv').config({ quiet: true });
    const db = require('../src/prisma');
    const { randomUUID } = require('node:crypto');
    const { saveSupportMessage, onlineAdmins } = require('../src/utils/supportChat');
    const suffix = randomUUID();
    const rollback = new Error('ROLLBACK_SUPPORT_TEST');
    try {
        await assert.rejects(db.$transaction(async tx => {
            const customer = await tx.user.create({ data: { email: `support-test-${suffix}@example.invalid`, role: 'CUSTOMER', passwordHash: 'test-only' } });
            const admin = await tx.user.create({ data: { email: `support-admin-${suffix}@example.invalid`, role: 'ADMIN', passwordHash: 'test-only', username: `support-${suffix}` } });
            const thread = await tx.supportThread.create({ data: { customerId: customer.id } });
            const nested = { ...tx, $transaction: fn => fn(tx) };
            const message = await saveSupportMessage(nested, customer, thread.id, { clientId: randomUUID(), text: 'Rollback-only support message' });
            assert.equal(message.content, 'Rollback-only support message');
            assert.equal(message.sender.id, customer.id);
            // Existing development presence may be online; isolate this test's
            // assertion to the same rule used by the save transaction.
            const anyoneOnline = (await onlineAdmins(tx)).length > 0;
            const alert = await tx.supportEmailAlert.findUnique({ where: { messageId_adminId: { messageId: message.id, adminId: admin.id } } });
            assert.equal(Boolean(alert), !anyoneOnline);
            await tx.supportPresence.create({ data: { sessionId: randomUUID(), adminId: admin.id, expiresAt: new Date(Date.now() + 45000) } });
            assert.ok((await onlineAdmins(tx)).some(user => user.id === admin.id));
            const reply = await saveSupportMessage(nested, admin, thread.id, { clientId: randomUUID(), text: 'Rollback-only admin reply' });
            assert.equal(await tx.supportEmailAlert.count({ where: { messageId: reply.id } }), 0);
            assert.equal(await tx.supportMessage.count({ where: { threadId: thread.id } }), 2);
            throw rollback;
        }, { timeout: 20000 }), error => error === rollback);
        assert.equal(await db.user.count({ where: { email: `support-test-${suffix}@example.invalid` } }), 0);
    } finally { await db.$disconnect(); }
});
