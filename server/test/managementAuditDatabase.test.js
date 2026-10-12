const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

test('real audit schema saves request/state and survives target deletion (rolled back)', { skip: process.env.RUN_AUDIT_DB_TEST !== '1' }, async () => {
    require('dotenv').config({ quiet: true });
    assert.equal(new URL(process.env.DATABASE_URL).hostname, 'db.prisma.io');
    const db = require('../src/prisma');
    const { createManagementAudit } = require('../src/middleware/managementAudit');
    const { snapshot, definitions } = require('../src/utils/managementAudit');
    const suffix = randomUUID();
    const rollback = new Error('intentional audit test rollback');
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'isolated-audit-test';
    try {
        await assert.rejects(db.$transaction(async tx => {
            const actor = await tx.user.create({ data: { email: `audit-admin-${suffix}@example.invalid`, username: `audit-${suffix}`, role: 'ADMIN', passwordHash: 'unusable-synthetic-hash' } });
            const target = await tx.user.create({ data: { email: `audit-target-${suffix}@example.invalid`, passwordHash: 'unusable-synthetic-hash' } });
            // Validate every explicit snapshot selector against the actual schema.
            for (const type of new Set(definitions.map(row => row[4]))) await snapshot(tx, { targetType: type, category: 'earnings' }, 'does-not-exist');
            const app = express(); app.use(express.json()); app.use('/api', createManagementAudit(tx));
            app.patch('/api/admin/users/:id/role', async (req, res) => {
                await tx.user.update({ where: { id: req.params.id }, data: { role: 'PROVIDER' } });
                res.json({ ok: true });
            });
            const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
            try {
                const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/${target.id}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: actor.id, role: 'ADMIN' }, process.env.JWT_SECRET)}` }, body: JSON.stringify({ role: 'PROVIDER', password: 'never-store-this' }) });
                assert.equal(response.status, 200); await response.json();
                const row = await tx.managementAuditLog.findFirst({ where: { actorId: actor.id } });
                assert.equal(row.before.role, 'CUSTOMER'); assert.equal(row.after.role, 'PROVIDER');
                assert.equal(row.outcome, 'SUCCEEDED'); assert.equal(row.statusCode, 200);
                assert.doesNotMatch(JSON.stringify(row), /unusable|never-store/);
                await tx.user.delete({ where: { id: target.id } });
                assert.ok(await tx.managementAuditLog.findUnique({ where: { id: row.id } }), 'target deletion cannot erase its audit record');
            } finally { await new Promise(resolve => server.close(resolve)); }
            throw rollback;
        }, { timeout: 30000 }), error => error === rollback);
        assert.equal(await db.user.count({ where: { email: `audit-admin-${suffix}@example.invalid` } }), 0);
    } finally { process.env.JWT_SECRET = previousSecret; await db.$disconnect(); }
});
