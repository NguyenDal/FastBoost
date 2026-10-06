const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { orderEarnings } = require('../src/utils/earnings');

test('real match storage, review audit and cross-order duplicate-pay guard (rolled back)', { skip: process.env.RUN_MATCH_HISTORY_DB_TEST !== '1' }, async () => {
    require('dotenv').config({ quiet: true });
    assert.equal(new URL(process.env.DATABASE_URL).hostname, 'db.prisma.io');
    const db = require('../src/prisma');
    const id = randomUUID();
    const rollback = new Error('intentional rollback');
    try {
        await db.$transaction(async tx => {
            const user = await tx.user.create({ data: { id, email: `${id}@example.invalid`, passwordHash: 'synthetic-unusable-password', role: 'PROVIDER' } });
            const service = await tx.service.create({ data: { title: 'Synthetic match-history test' } });
            const data = { customerId: user.id, serviceId: service.id, orderNumber: `TEST-${id}`, boostType: 'Rank Boost',
                status: 'COMPLETED', paymentStatus: 'PAID', amountCents: 10000, goldDiscountCents: 2000 };
            const order = await tx.order.create({ data });
            const other = await tx.order.create({ data: { ...data, orderNumber: `OTHER-${id}` } });
            assert.equal(order.matchHistoryEnabled, true);
            await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
            const matchData = { orderId: order.id, game: 'LOL', externalId: `NA1_${Date.now()}`, participantId: id,
                playedAt: new Date(), details: { players: [] } };
            const match = await tx.orderMatch.create({ data: matchData });
            assert.equal((await tx.orderMatch.createMany({ data: [matchData], skipDuplicates: true })).count, 0);
            const second = await tx.orderMatch.create({ data: { ...matchData, orderId: other.id } });
            const unclaimed = await tx.orderMatch.create({ data: { ...matchData, externalId: `${matchData.externalId}9` } });
            const claimed = await tx.orderMatch.updateMany({ where: { orderId: order.id, status: 'PENDING', boosterId: null,
                OR: [{ id: match.id, revision: 1 }] }, data: { boosterId: id, revision: { increment: 1 } } });
            assert.equal(claimed.count, 1);
            await tx.orderMatchReview.createMany({ data: [{ matchId: match.id, reviewerId: id, revision: 2, decision: 'SUBMITTED', boosterId: id }] });
            const visible = await tx.orderMatch.findMany({ where: { orderId: order.id, boosterId: { not: null }, status: { in: ['PENDING', 'APPROVED'] } } });
            assert.deepEqual(visible.map(m => m.id), [match.id]);
            assert.equal((await tx.orderMatch.findUnique({ where: { id: unclaimed.id } })).boosterId, null);
            await tx.orderMatch.update({ where: { id: match.id }, data: { status: 'APPROVED', boosterId: id, revision: { increment: 1 } } });
            await tx.orderMatchReview.create({ data: { matchId: match.id, reviewerId: id, revision: 3, decision: 'APPROVED', boosterId: id } });
            assert.equal((await tx.orderMatchReview.findMany({ where: { matchId: match.id } })).length, 2);
            await tx.$executeRawUnsafe('SAVEPOINT duplicate_pay_test');
            await assert.rejects(tx.orderMatch.update({ where: { id: second.id }, data: { status: 'APPROVED', boosterId: id } }), e => e.code === 'P2002');
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_pay_test');
            const stored = await tx.order.findUnique({ where: { id: order.id }, include: { matches: true } });
            assert.deepEqual(orderEarnings(stored).shares, []);
            await tx.order.update({ where: { id: order.id }, data: { matchHistoryConfirmedAt: new Date(), matchHistoryConfirmedBy: id, matchHistoryRevision: { increment: 1 } } });
            const confirmed = await tx.order.findUnique({ where: { id: order.id }, include: { matches: true } });
            assert.equal(orderEarnings(confirmed).shares[0].cents, 5600);
            throw rollback;
        }, { timeout: 20000 });
    } catch (error) { if (error !== rollback) throw error; }
    finally { await db.$disconnect(); }
});
