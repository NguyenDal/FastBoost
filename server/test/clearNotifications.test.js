const test = require('node:test');
const assert = require('node:assert/strict');

test('clearing previews is scoped to the signed-in user and selected panel', async () => {
  const paths = [require.resolve('../src/prisma'), require.resolve('../src/utils/referralProgram'), require.resolve('../src/controllers/notificationController')];
  const saved = paths.map(path => [path, require.cache[path]]);
  const rows = [
    { id: 'notice', userId: 'me', type: 'ORDER_COMPLETED', active: true },
    { id: 'chat', userId: 'me', type: 'CHAT_MESSAGE', active: true },
    { id: 'other', userId: 'other-user', type: 'CHAT_MESSAGE', active: true },
    { id: 'hidden', userId: 'me', type: 'CHAT_MESSAGE', active: false },
  ];
  let calls = 0;
  try {
    require.cache[paths[0]] = { exports: { notification: { updateMany: async ({ where, data }) => {
      calls++;
      const matches = rows.filter(row => row.userId === where.userId && row.active === where.active &&
        (where.id === undefined || row.id === where.id) &&
        (typeof where.type === 'string' ? row.type === where.type : row.type !== where.type.not));
      matches.forEach(row => Object.assign(row, data));
      return { count: matches.length };
    } } } };
    require.cache[paths[1]] = { exports: { getReferralFirstPurchaseOffer: async () => ({ eligible: false }) } };
    delete require.cache[paths[2]];
    const { clearNotifications } = require(paths[2]);
    const request = async (body, user = { id: 'me' }) => {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
      await clearNotifications({ user, body }, res);
      return res;
    };
    assert.equal((await request({ kind: 'messages', id: 'other' })).data.cleared, 0);
    assert.equal((await request({ kind: 'messages', id: 'notice' })).data.cleared, 0);
    assert.equal((await request({ kind: 'notifications', id: 'notice' })).data.cleared, 1);
    assert.equal(rows[0].active, false);
    assert.equal(rows[0].read, true);
    assert.equal(rows[1].active, true);
    assert.equal((await request({ kind: 'messages' })).data.cleared, 1);
    assert.equal(rows[2].active, true);
    assert.equal((await request({ kind: 'messages' })).data.cleared, 0);
    const before = calls;
    for (const body of [{}, { kind: 'all' }, { kind: 'messages', id: '' }, { kind: 'messages', id: {} }]) {
      assert.equal((await request(body)).code, 400);
    }
    assert.equal((await request({ kind: 'messages' }, null)).code, 401);
    assert.equal(calls, before);
  } finally {
    for (const [path, cached] of saved) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
  }
});
