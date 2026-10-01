import test from 'node:test';
import assert from 'node:assert/strict';
import { openContractSigning } from '../src/utils/contractSigning.js';

function browserFixture() {
    const opened = [], navigated = [];
    const popup = {
        opener: {}, closed: false, document: { title: '', body: { textContent: '' } },
        location: { replace: url => navigated.push(url) },
        close() { this.closed = true; },
    };
    const browserWindow = { open: (...args) => { opened.push(args); return popup; } };
    return { opened, navigated, popup, browserWindow };
}

test('opens and isolates a signing tab before requesting its short-lived URL', async () => {
    const fixture = browserFixture();
    let resolveView;
    const opening = openContractSigning(() => {
        assert.equal(fixture.opened.length, 1, 'opening must happen synchronously during the click');
        assert.equal(fixture.popup.opener, null, 'DocuSign must not receive access to the opener');
        return new Promise(resolve => { resolveView = resolve; });
    }, fixture.browserWindow);
    assert.deepEqual(fixture.opened[0], ['about:blank', '_blank'], 'no popup features that would force a separate window');
    assert.equal(fixture.navigated.length, 0);
    resolveView({ url: 'https://demo.docusign.net/signing/test' });
    await opening;
    assert.deepEqual(fixture.navigated, ['https://demo.docusign.net/signing/test']);
    assert.equal(fixture.popup.closed, false);
});

test('a blocked popup does not create an unused signing session', async () => {
    let requests = 0;
    await assert.rejects(openContractSigning(() => { requests++; }, { open: () => null }), /Allow pop-ups/);
    assert.equal(requests, 0);
});

test('failed signing requests close their blank window and retain the error', async () => {
    const fixture = browserFixture();
    await assert.rejects(openContractSigning(async () => { throw new Error('Signing unavailable'); }, fixture.browserWindow), /Signing unavailable/);
    assert.equal(fixture.popup.closed, true);
    assert.equal(fixture.navigated.length, 0);
});

test('closing the tab before the URL arrives does not navigate it', async () => {
    const fixture = browserFixture();
    await assert.rejects(openContractSigning(async () => {
        fixture.popup.closed = true;
        return { url: 'https://demo.docusign.net/signing/test' };
    }, fixture.browserWindow), /tab was closed/);
    assert.equal(fixture.navigated.length, 0);
});

test('non-HTTPS and unrelated signing destinations are rejected', async () => {
    for (const url of ['http://demo.docusign.net/signing/test', 'https://demo.docusign.net.example.test/', 'javascript:alert(1)']) {
        const fixture = browserFixture();
        await assert.rejects(openContractSigning(async () => ({ url }), fixture.browserWindow), /Could not open/);
        assert.equal(fixture.popup.closed, true);
        assert.equal(fixture.navigated.length, 0);
    }
});
