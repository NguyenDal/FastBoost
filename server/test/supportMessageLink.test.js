const test = require('node:test');
const assert = require('node:assert/strict');

test('email deep link loads continuous older history through the exact target', async () => {
    const { loadSupportMessageTarget, supportAdminDestination } = await import('../../client/src/utils/supportMessageLink.js');
    const paths = [];
    const pages = [
        { messages: [{ id: 'new1' }, { id: 'new2' }], hasMore: true },
        { messages: [{ id: 'middle' }], hasMore: true },
        { messages: [{ id: 'target' }], hasMore: true },
    ];
    const result = await loadSupportMessageTarget(async path => { paths.push(path); return pages.shift(); }, 'thread', 'target');
    assert.deepEqual(result.messages.map(m => m.id), ['target', 'middle', 'new1', 'new2']);
    assert.equal(result.hasMore, true);
    assert.deepEqual(paths, ['/threads/thread/messages?target=target', '/threads/thread/messages?before=new1', '/threads/thread/messages?before=middle']);
    assert.equal(supportAdminDestination('?thread=thread&message=target&redirect=https://other.test'), '/admin/support?thread=thread&message=target');
    assert.equal(supportAdminDestination(''), '/admin/support');
});

test('target loading handles current, missing, and cancelled links', async () => {
    const { loadSupportMessageTarget } = await import('../../client/src/utils/supportMessageLink.js');
    let calls = 0;
    const request = async () => { calls++; return { messages: [{ id: 'target' }], hasMore: true }; };
    await loadSupportMessageTarget(request, 'thread', 'target');
    assert.equal(calls, 1);
    await assert.rejects(loadSupportMessageTarget(async () => ({ messages: [], hasMore: false }), 'thread', 'missing'), /unavailable/);
    calls = 0;
    await loadSupportMessageTarget(request, 'thread', 'older', () => true);
    assert.equal(calls, 1);
});
