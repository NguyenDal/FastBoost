const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('../src/generated/prisma/client');
const { developmentDatabaseUrl, withBackendReadFixture } = require('../scripts/lib/backendReadFixture');
const { rewardPage } = require('../src/utils/loyaltyRewards');
const { unreadSupportThreads } = require('../src/utils/supportInbox');
const { auditActors } = require('../src/utils/auditActors');
const { boosterEarnings } = require('../src/utils/boosterEarnings');

const enabled = process.env.RUN_BACKEND_READ_DB_TEST === '1';
const at = milliseconds => new Date(Date.UTC(2026, 0, 1) + milliseconds);
const order = (id, overrides = {}) => ({
    id, orderNumber: `TEST-${id}`, customerId: 'customer-a', serviceId: 'service-a',
    status: 'COMPLETED', paymentStatus: 'PAID', boostType: 'Fallback boost',
    totalPrice: 19.99, updatedAt: at(1000), ...overrides,
});
const reward = (id, overrides = {}) => ({
    id, userId: 'customer-a', type: 'MANUAL_ADJUSTMENT', title: `Reward ${id}`,
    description: null, goldAmount: 25, createdAt: at(1000), ...overrides,
});

// The only dynamic identifiers here come from these fixed test table names and
// literal fixture object keys. Every fixture value is a bound query parameter.
async function insert(client, table, rows) {
    assert.ok(['User', 'Service', 'Order', 'RewardHistory', 'SupportMessage', 'ManagementAuditLog'].includes(table));
    if (!rows.length) return;
    const columns = Object.keys(rows[0]);
    const values = rows.flatMap(row => columns.map(column => {
        const value = row[column];
        return value instanceof Date ? value.toISOString() : value;
    }));
    const tuples = rows.map((_, row) => `(${columns.map((_, column) => `$${row * columns.length + column + 1}`).join(',')})`);
    await client.query(`INSERT INTO pg_temp."${table}" (${columns.map(column => `"${column}"`).join(',')}) VALUES ${tuples.join(',')}`, values);
}

test('backend read SQL preserves rewards, audit actors and support unread state (temporary tables; rolled back)',
    { skip: !enabled }, async t => withBackendReadFixture(async ({ client, db, applyReadIndexes }) => {
        await t.test('new migration creates all three indexes only on temporary tables', async () => {
            await applyReadIndexes();
            const { rows } = await client.query(`
                SELECT index_class.relname AS name, table_class.relpersistence AS persistence
                FROM pg_index i JOIN pg_class index_class ON index_class.oid = i.indexrelid
                JOIN pg_class table_class ON table_class.oid = i.indrelid
                WHERE index_class.relnamespace = pg_my_temp_schema()
                    AND index_class.relname = ANY($1::text[]) ORDER BY index_class.relname
            `, [['Order_customer_reward_page_idx', 'Order_completed_earnings_page_idx', 'RewardHistory_user_page_idx']]);
            assert.deepEqual(rows, [
                { name: 'Order_completed_earnings_page_idx', persistence: 't' },
                { name: 'Order_customer_reward_page_idx', persistence: 't' },
                { name: 'RewardHistory_user_page_idx', persistence: 't' },
            ]);
        });

        await t.test('SQL gold equals the previous JavaScript calculation for fractional, zero and boundary values', async () => {
            const prices = [0, 0.01, 0.9999999999999999, 1, 1.0000000000000002,
                1.9999999999999998, 19.99, 1234.567, 2147483647.9, -0.01];
            const orders = prices.map((totalPrice, i) => order(`gold-${i.toString().padStart(2, '0')}`, {
                customerId: 'gold-customer', totalPrice, updatedAt: at(i),
            }));
            await insert(client, 'Service', [{ id: 'service-a', title: 'Service title' }, { id: 'service-empty', title: '' }]);
            await insert(client, 'Order', orders);
            const result = await rewardPage(db, 'gold-customer', 0, 10);
            assert.equal(result.length, prices.length);
            for (const row of result) {
                const original = orders.find(item => `order-${item.id}` === row.id);
                assert.equal(row.goldEarned, Math.floor(Number(original.totalPrice || 0)));
                assert.equal(typeof row.goldEarned, 'number');
                assert.equal(row.createdAt.toISOString(), original.updatedAt.toISOString());
            }
        });

        await t.test('mixed pages preserve ordering, tie breaks, labels, account scope and end boundaries', async () => {
            await insert(client, 'Order', [
                order('tie-z'), order('tie-a', { serviceId: 'service-empty' }),
                order('old', { updatedAt: at(0), serviceId: 'service-empty', boostType: '', totalPrice: 0 }),
                order('other-account', { customerId: 'customer-b', updatedAt: at(5000) }),
                order('not-completed', { status: 'IN_PROGRESS', updatedAt: at(5000) }),
                order('not-paid', { paymentStatus: 'PENDING', updatedAt: at(5000) }),
            ]);
            await insert(client, 'RewardHistory', [
                reward('latest', { createdAt: at(2000), description: 'Explicit reward description', goldAmount: -5 }),
                reward('tie-z', { description: '' }), reward('tie-a'),
                reward('other-account', { userId: 'customer-b', createdAt: at(5000) }),
            ]);
            const expectedIds = ['reward-latest', 'order-tie-z', 'order-tie-a', 'reward-tie-z', 'reward-tie-a', 'order-old'];
            const all = await rewardPage(db, 'customer-a', 0, 10);
            assert.deepEqual(all.map(row => row.id), expectedIds);
            assert.deepEqual(all.map(row => row.title), ['Reward latest', 'Service title', 'Fallback boost', 'Reward tie-z', 'Reward tie-a', 'Completed Order']);
            assert.equal(all[0].goldEarned, -5);
            assert.equal(all[0].description, 'Explicit reward description');
            assert.equal(all[1].description, '#TEST-tie-z • Completed match reward');
            assert.equal(all[1].type, 'COMPLETED_ORDER');
            assert.equal(all[3].description, 'Reward added to your account.');
            assert.equal(all[4].description, 'Reward added to your account.');
            const paged = [];
            for (let offset = 0; offset < expectedIds.length; offset += 2) {
                const page = await rewardPage(db, 'customer-a', offset, 2);
                assert.equal(page.length, 2);
                paged.push(...page);
            }
            assert.deepEqual(paged, all);
            assert.deepEqual(await rewardPage(db, 'customer-a', 5, 2), [all[5]]);
            assert.deepEqual(await rewardPage(db, 'customer-a', 6, 2), []);
            assert.deepEqual(await rewardPage(db, 'customer-a', 100000, 2), []);
            assert.deepEqual(await rewardPage(db, 'absent-customer', 0, 10), []);
            assert.deepEqual(await rewardPage(db, "customer-a' OR TRUE --", 0, 10), []);
            assert.deepEqual((await rewardPage(db, 'customer-b', 0, 10)).map(row => row.id),
                ['order-other-account', 'reward-other-account']);
        });

        await t.test('source limits retain deep pages when either source supplies the entire newest prefix', async () => {
            for (const newestSource of ['orders', 'rewards']) {
                const customerId = `prefix-${newestSource}`;
                const orders = Array.from({ length: 8 }, (_, i) => order(`${customerId}-order-${i}`, {
                    customerId, updatedAt: at(i + (newestSource === 'orders' ? 2000 : 0)),
                }));
                const rewards = Array.from({ length: 8 }, (_, i) => reward(`${customerId}-reward-${i}`, {
                    userId: customerId, createdAt: at(i + (newestSource === 'rewards' ? 2000 : 0)),
                }));
                await insert(client, 'Order', orders);
                await insert(client, 'RewardHistory', rewards);
                const orderIds = orders.map(row => `order-${row.id}`).reverse();
                const rewardIds = rewards.map(row => `reward-${row.id}`).reverse();
                const expected = newestSource === 'orders' ? [...orderIds, ...rewardIds] : [...rewardIds, ...orderIds];
                for (const offset of [0, 4, 6, 8, 11, 15, 16]) {
                    const result = await rewardPage(db, customerId, offset, 3);
                    assert.deepEqual(result.map(row => row.id), expected.slice(offset, offset + 3));
                }
            }
        });

        await t.test('an indexed first page reads bounded prefixes from large reward histories', async pageTest => {
            await client.query(`
                INSERT INTO pg_temp."Order" (id, "orderNumber", "customerId", "serviceId", status,
                    "paymentStatus", "boostType", "totalPrice", "updatedAt")
                SELECT 'volume-order-' || lpad(n::text, 5, '0'), 'TEST-VOLUME-' || n, 'volume-customer',
                    'service-a', 'COMPLETED', 'PAID', 'Volume boost', 19.99,
                    timestamp '2026-01-01' + (2 * n + 1) * interval '1 millisecond'
                FROM generate_series(1, 20000) n;
                INSERT INTO pg_temp."RewardHistory" (id, "userId", type, title, "goldAmount", "createdAt")
                SELECT 'volume-reward-' || lpad(n::text, 5, '0'), 'volume-customer', 'MANUAL_ADJUSTMENT',
                    'Volume reward', 1, timestamp '2026-01-01' + 2 * n * interval '1 millisecond'
                FROM generate_series(1, 20000) n;
                ANALYZE pg_temp."Order";
                ANALYZE pg_temp."RewardHistory"
            `);
            const explainDb = { async $queryRaw(query, ...values) {
                const sql = Prisma.sql(query, ...values);
                const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql.text}`, sql.values);
                return rows[0]['QUERY PLAN'][0];
            } };
            const explanation = await rewardPage(explainDb, 'volume-customer', 0, 5);
            const scans = [];
            const collect = plan => {
                if (['Order', 'RewardHistory'].includes(plan['Relation Name'])) scans.push(plan);
                for (const child of plan.Plans || []) collect(child);
            };
            collect(explanation.Plan);
            assert.equal(scans.length, 2);
            for (const scan of scans) {
                assert.ok(scan['Index Name'], `${scan['Relation Name']} should use an ordered index`);
                assert.ok(scan['Actual Rows'] <= 5, `${scan['Relation Name']} should read at most the page prefix`);
            }
            assert.deepEqual((await rewardPage(db, 'volume-customer', 0, 5)).map(row => row.id), [
                'order-volume-order-20000', 'reward-volume-reward-20000', 'order-volume-order-19999',
                'reward-volume-reward-19999', 'order-volume-order-19998',
            ]);
            pageTest.diagnostic(JSON.stringify({ sourceRows: 40000, pageRows: 5,
                planningMs: explanation['Planning Time'], executionMs: explanation['Execution Time'],
                scans: scans.map(scan => ({ relation: scan['Relation Name'], index: scan['Index Name'], rows: scan['Actual Rows'] })),
            }));
        });

        await t.test('audit actors use the latest critical change name, excluding routine and unchanged records', async () => {
            assert.deepEqual(await auditActors(db), []);
            await insert(client, 'User', [{ id: 'actor-c', username: 'Named admin' }]);
            const entry = (id, actorId, actorName, milliseconds, action = 'account.role', outcome = 'SUCCEEDED') => ({
                id, actorId, actorName, action, outcome, createdAt: at(milliseconds),
            });
            await insert(client, 'ManagementAuditLog', [
                entry('actor-a-old', 'actor-a', 'Old name', 0),
                entry('actor-a-a', 'actor-a', 'Tie loser', 1000),
                entry('actor-a-z', 'actor-a', 'Current name', 1000),
                entry('actor-a-marker', 'actor-a', 'Marker name', 5000, 'logging.enabled'),
                entry('actor-a-nochange', 'actor-a', 'Unchanged name', 6000, 'account.role', 'NO_CHANGE'),
                entry('actor-b', 'actor-b', 'Second actor', 2000),
                entry('actor-b-routine', 'actor-b', 'Routine name', 4000, 'contract.signing-view'),
                entry('actor-c', 'actor-c', 'Admin', 3000),
                entry('marker-only', 'marker-only', 'Hidden marker actor', 6000, 'logging.enabled'),
                entry('no-actor', null, 'System', 7000),
            ]);
            assert.deepEqual(await auditActors(db), [
                { actorId: 'actor-c', actorName: 'Named admin' },
                { actorId: 'actor-b', actorName: 'Second actor' },
                { actorId: 'actor-a', actorName: 'Current name' },
            ]);
        });

        await t.test('support unread honors exact watermarks and customer identity even after an admin reply', async () => {
            assert.deepEqual(await unreadSupportThreads({ $queryRaw() { assert.fail('Empty pages must skip SQL'); } }, []), new Set());
            const threads = ['before', 'equal', 'after', 'reply', 'admin-only', 'other-customer', 'empty']
                .map(id => ({ id, customerId: `customer-${id}`, adminReadAt: at(1000) }));
            const message = (id, threadId, senderId, milliseconds) => ({ id, threadId, senderId, createdAt: at(milliseconds) });
            await insert(client, 'SupportMessage', [
                message('before', 'before', 'customer-before', 999),
                message('equal', 'equal', 'customer-equal', 1000),
                message('after', 'after', 'customer-after', 1001),
                message('reply-customer', 'reply', 'customer-reply', 1001),
                message('reply-admin', 'reply', 'admin', 2000),
                message('only-admin', 'admin-only', 'admin', 2000),
                message('wrong-customer', 'other-customer', 'customer-after', 2000),
                message('not-on-page', 'outside-page', 'outside-customer', 2000),
            ]);
            assert.deepEqual(await unreadSupportThreads(db, threads), new Set(['after', 'reply']));
            assert.deepEqual(await unreadSupportThreads(db, threads.map(thread => ({ ...thread, adminReadAt: at(2000) }))), new Set());
            assert.deepEqual(await unreadSupportThreads(db, [{ id: 'absent', customerId: 'absent', adminReadAt: at(0) }]), new Set());
        });
    }));

test('booster earnings selectors are valid against the development Prisma schema (read only)',
    { skip: !enabled }, async () => {
        developmentDatabaseUrl();
        const db = require('../src/prisma');
        try {
            assert.deepEqual(await boosterEarnings(db, `backend-read-absent-${randomUUID()}`), {});
        } finally {
            await db.$disconnect();
        }
    });
