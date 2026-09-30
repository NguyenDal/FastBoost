const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
test('dashboard SQL selects first unread per sender and operations tables exist (rolled back)', { skip: process.env.RUN_OPERATIONS_DB_TEST !== '1' }, async () => {
    require('dotenv').config({ quiet: true });
    assert.equal(new URL(process.env.DATABASE_URL).hostname, 'db.prisma.io');
    const db = require('../src/prisma');
    const { dashboardMessages } = require('../src/utils/dashboardMessages');
    const rollback = new Error('intentional rollback');
    try {
        await db.$transaction(async tx => {
            const id = randomUUID();
            await tx.user.create({ data: { id, email: `${id}@example.invalid`, passwordHash: 'synthetic-unusable-password' } });
            const notifications = [
                { id: `${id}-first`, data: { senderId: 'sender-a' }, read: false, createdAt: new Date('2026-01-01') },
                { id: `${id}-later`, data: { senderId: 'sender-a' }, read: false, createdAt: new Date('2026-01-02') },
                { id: `${id}-old-read`, data: { senderId: 'sender-b' }, read: true, createdAt: new Date('2026-01-01') },
                { id: `${id}-new-read`, data: { senderId: 'sender-b' }, read: true, createdAt: new Date('2026-01-03') },
                { id: `${id}-hidden`, data: { senderId: 'sender-c' }, read: false, active: false, createdAt: new Date('2026-01-04') },
            ];
            await tx.notification.createMany({ data: notifications.map(n => ({ userId: id, type: 'CHAT_MESSAGE', title: 'Same display name', message: 'Synthetic preview', ...n })) });
            const selected = await dashboardMessages(tx, id);
            assert.deepEqual(selected.map(n => n.id), [`${id}-first`, `${id}-new-read`]);
            await tx.boosterProfile.create({ data: { userId: id, startedAt: new Date('2026-01-01') } });
            await tx.boosterContract.findMany({ take: 1 });
            await tx.boosterContribution.findMany({ take: 1 });
            throw rollback;
        });
    } catch (error) { if (error !== rollback) throw error; }
    finally { await db.$disconnect(); }
});
