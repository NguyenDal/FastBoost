import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transformWithOxc } from 'vite';
import { agreementSigningPath, hasDrawnSignature, signatureSubmission, signingValuesMatch } from '../src/utils/nativeSigning.js';

test('the built-in agreement route binds the specific contract and retains a safe local destination', () => {
    assert.equal(agreementSigningPath('contract-123'), '/provider-agreement?contract=contract-123');
    assert.equal(agreementSigningPath('a&contract=b'), '/provider-agreement?contract=a%26contract%3Db');
});

test('only the exact prepared commercial values remain eligible for signing', () => {
    assert.equal(signingValuesMatch({ WorkLocation: 'Canada', EndDate: 'Ongoing' }, { EndDate: 'Ongoing', WorkLocation: 'Canada' }), true);
    assert.equal(signingValuesMatch({ WorkLocation: 'Canada', EndDate: 'Ongoing' }, { WorkLocation: 'Canada', EndDate: '2026-12-31' }), false);
    assert.equal(signingValuesMatch({ WorkLocation: 'Canada' }, { WorkLocation: 'Canada', EndDate: 'Ongoing' }), false);
});

test('ambiguous signature retries preserve request identity and original challenge', () => {
    let ids = 0;
    const input = { context: { documentHash: 'accepted-hash', challenge: 'challenge-one' }, legalName: '  Test Signer  ', initials: 'TS', consent: true, signature: { type: 'typed' } };
    const first = signatureSubmission(input, null, () => `request-${++ids}`);
    const retried = signatureSubmission({ ...input, context: { ...input.context, challenge: 'refreshed-challenge' } }, first, () => `request-${++ids}`);
    assert.equal(retried, first);
    assert.equal(retried.body.requestId, 'request-1');
    assert.equal(retried.body.challenge, 'challenge-one');
    assert.equal(retried.body.legalName, 'Test Signer');
    const changed = signatureSubmission({ ...input, context: { ...input.context, documentHash: 'another-document' } }, first, () => `request-${++ids}`);
    assert.equal(changed.body.requestId, 'request-2');
});

test('unprepared, unconsented and empty drawn signatures cannot be submitted', () => {
    const input = { context: { documentHash: 'hash', challenge: 'challenge' }, legalName: 'Signer', initials: 'S', signature: { type: 'typed' }, consent: true };
    for (const changed of [{ context: {} }, { consent: false }, { legalName: ' ' }, { initials: '' }, { signature: { type: 'drawn', strokes: [[[1, 1]]] } }]) {
        assert.throws(() => signatureSubmission({ ...input, ...changed }, null, () => 'unused'));
    }
    assert.equal(hasDrawnSignature({ type: 'drawn', strokes: [[[1, 1], [10, 10]]] }), true);
});

const eventHub = () => {
    const listeners = new Map();
    return { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); }, dispatch(type, event = {}) { listeners.get(type)?.({ ...event, type }); } };
};
async function componentFixture(bindings, initialStates = [], options = {}) {
    const name = options.name || 'NativeContractSigning';
    const source = await readFile(new URL(options.path || '../src/components/NativeContractSigning.jsx', import.meta.url), 'utf8');
    const transformed = await transformWithOxc(source.replace(/^import[^;]+;\r?\n/gm, '').replace('export default function', 'function').replace(/^export /gm, ''), `${name}.jsx`, { jsx: { runtime: 'automatic', development: false } });
    const states = [...initialStates], refs = [], effects = [], cleanups = [];
    let cursor = 0, refCursor = 0;
    const jsx = (type, props) => ({ type, props });
    const component = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\n${name};`, {
        _jsx: jsx, _jsxs: jsx, _Fragment: 'fragment', AbortController,
        require(module) { assert.equal(module, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'fragment' }; },
        useState(initial) {
            const i = cursor++;
            if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
            return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
        },
        useRef(value) { return refs[refCursor++] ||= { current: value }; },
        useEffect(effect) { effects.push(effect); }, useCallback: callback => callback,
        Navbar: 'Navbar', ContractSignaturePad: 'SignaturePad', Link: 'Link',
        signatureSubmission, signingValuesMatch, hasDrawnSignature, agreementSigningPath,
        CONTRACT_SIGNING_CHANNEL: 'test-signing', date: value => value,
        getStoredUser: () => ({ id: 'company' }), hasValidSession: () => true,
        authStorage: { getItem: () => 'session' }, useNavigate: () => () => {},
        window: eventHub(), document: eventHub(), crypto: { randomUUID: () => 'signature-request' },
        ...bindings,
    });
    return {
        render() { cursor = 0; refCursor = 0; return component({ id: 'contract' }); },
        state: index => states[index],
        runEffects() { for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } },
        cleanup() { for (const cleanup of cleanups.splice(0)) cleanup(); },
    };
}
function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (!Array.isArray(tree) && predicate(tree)) return tree;
    for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) { const result = find(child, predicate); if (result) return result; }
    return null;
}
const readyContext = { contract: { id: 'contract', companySignerName: 'Company Signer', signerName: 'Booster' }, documentHash: 'frozen-hash', challenge: 'challenge', values: { EndDate: 'Ongoing' }, fields: [], prepared: true, canSign: true, role: 'company', signatures: [], consentText: 'Exact server consent statement.', html: '<h1>Exact agreement</h1>' };

test('the company can prepare an unsigned draft and sends only editable commercial fields', async () => {
    const calls = [];
    const draft = { ...readyContext, canSign: false, prepared: false, documentHash: null, values: { EndDate: 'Ongoing', ProviderLegalName: 'Locked identity' }, fields: [{ key: 'EndDate', label: 'End date' }] };
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); return readyContext; } }, [draft, draft.values, true]);
    const form = find(fixture.render(), item => item.props?.className === 'native-commercial-form');
    assert.ok(form, 'initial draft preparation must not depend on readiness to sign');
    assert.equal(find(fixture.render(), item => item.type === 'p' && item.props.children === 'Signing is not available for this account at this stage.'), null);
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(calls[0][1], 'prepare');
    assert.equal(JSON.stringify(calls[0][2]), JSON.stringify({ values: { EndDate: 'Ongoing' } }));
});

test('archived native agreements expose read-only history and available downloads only', async () => {
    const archivedContext = { ...readyContext, archived: true, canSign: true, contract: { ...readyContext.contract, archivedAt: '2026-10-22T14:00:00Z', documentAvailable: true } };
    const fixture = await componentFixture({}, [archivedContext, archivedContext.values, true]);
    const tree = fixture.render();
    assert.equal(find(tree, item => item.props?.className === 'native-commercial-form'), null);
    assert.equal(find(tree, item => item.props?.className === 'native-signature-form'), null);
    assert.ok(find(tree, item => item.type === 'h2' && item.props.children === 'Archived agreement'));
    assert.ok(find(tree, item => item.type === 'button' && item.props.children === 'Download PDF'));
});

test('archived legacy agreements cannot offer replacement even if an older response contains canReplace', async () => {
    const archivedContext = { ...readyContext, archived: true, legacy: true, canReplace: true, html: null, contract: { ...readyContext.contract, archivedAt: '2026-10-22T14:00:00Z', documentAvailable: false } };
    const fixture = await componentFixture({}, [archivedContext, archivedContext.values]);
    const tree = fixture.render();
    assert.equal(find(tree, item => item.type === 'button' && item.props.children === 'Create website agreement'), null);
    assert.ok(find(tree, item => item.type === 'h2' && item.props.children === 'Archived agreement'));
});

test('the existing contract card retains its layout and hides signing on archived records', async () => {
    const contract = { ...readyContext.contract, archivedAt: '2026-10-22T14:00:00Z', signingProvider: 'FASTBOOST', title: 'Booster Service Agreement', companySignerEmail: 'company@example.test', boosterId: 'booster', documentAvailable: false, status: 'sent' };
    const fixture = await componentFixture({ useParams: () => ({ id: 'contract' }), getStoredUser: () => ({ id: 'company', role: 'ADMIN', email: 'company@example.test' }) }, [{ path: '/contracts/contract', data: { contract }, error: '' }, 0, '', false], { name: 'BoosterContractPage', path: '../src/pages/OperationsPages.jsx' });
    const tree = fixture.render();
    assert.ok(find(tree, item => item.props?.className === 'ops-card ops-contract'));
    assert.equal(find(tree, item => item.type === 'button' && ['Review & sign', 'Review & sign for FastBoost'].includes(item.props.children)), null);
    assert.ok(find(tree, item => item.props?.role === 'status' && item.props?.['aria-label'] === 'Contract status: Archived'));
});

test('rendering a ready agreement never signs it; explicit submit uses the accepted snapshot', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); return {}; } }, [readyContext, readyContext.values, false, 'Company Signer', 'CS', { type: 'typed' }, true]);
    const tree = fixture.render();
    assert.equal(calls.length, 0, 'displaying the page cannot accept a contract');
    const form = find(tree, item => item.props?.className === 'native-signature-form');
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'sign');
    assert.equal(calls[0][2].documentHash, readyContext.documentHash);
    assert.equal(calls[0][2].challenge, readyContext.challenge);
    assert.equal(calls[0][2].consent, true);
});

test('uncertain server replies lock editing and retry the identical signing intent', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); throw new Error('Connection lost'); } }, [readyContext, readyContext.values, false, 'Company Signer', 'CS', { type: 'typed' }, true]);
    await find(fixture.render(), item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
    assert.equal(fixture.state(9), true);
    const retry = fixture.render();
    assert.equal(find(retry, item => item.type === 'input' && item.props?.autoComplete === 'name').props.disabled, true);
    await find(retry, item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][2], calls[1][2]);
});

test('repeated submission is serialized before React commits disabled controls', async () => {
    let finish, count = 0;
    const fixture = await componentFixture({ nativeContractRequest: async () => { count++; await new Promise(resolve => { finish = resolve; }); return {}; } }, [readyContext, readyContext.values, false, 'Company Signer', 'CS', { type: 'typed' }, true]);
    const submit = find(fixture.render(), item => item.props?.className === 'native-signature-form').props.onSubmit;
    const first = submit({ preventDefault() {} });
    await submit({ preventDefault() {} });
    assert.equal(count, 1);
    finish(); await first;
});

test('an account switch clears the document and rejects the previous pending response', async () => {
    const browser = eventHub(), page = eventHub(), pending = [];
    let account = 'company', token = 'token-one';
    const fixture = await componentFixture({ window: browser, document: page,
        getStoredUser: () => ({ id: account }), authStorage: { getItem: () => token },
        nativeContractRequest: () => new Promise(resolve => pending.push(resolve)),
    });
    fixture.render(); fixture.runEffects();
    assert.equal(pending.length, 1);
    account = 'another-person'; token = 'token-two'; browser.dispatch('auth:changed');
    assert.equal(fixture.state(0), null);
    assert.equal(pending.length, 2);
    pending[0](readyContext); await Promise.resolve(); await Promise.resolve();
    assert.equal(fixture.state(0), null, 'previous account document cannot reappear');
    pending[1]({ ...readyContext, contract: { id: 'other' }, role: 'booster' }); await Promise.resolve(); await Promise.resolve();
    assert.equal(fixture.state(0).contract.id, 'other');
    fixture.cleanup();
});
