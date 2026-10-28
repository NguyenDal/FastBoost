import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transformWithOxc } from 'vite';
import { agreementSigningPath, hasDrawnSignature, signatureMissingRequirements, signatureSubmission, signingValuesMatch } from '../src/utils/nativeSigning.js';
import { nativeSigningText, nativeSigningFieldLabel, nativeSigningFieldHelp } from '../src/utils/nativeSigningI18n.js';
import { nativeContractBoosterFirst, nativeContractPendingStatus } from '../src/utils/contractSigning.js';

test('the built-in agreement route binds the specific contract and retains a safe local destination', () => {
    assert.equal(agreementSigningPath('contract-123'), '/provider/contracts/contract-123/sign');
    assert.equal(agreementSigningPath('a&contract=b'), '/provider/contracts/a%26contract%3Db/sign');
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
        useEffect(effect) { effects.push(effect); }, useMemo: factory => factory(), useCallback: callback => callback,
        createPortal: children => children, translateAgreementHtml: html => html,
        nativeSigningText, nativeSigningFieldLabel, nativeSigningFieldHelp,
        Navbar: 'Navbar', ContractSignaturePad: 'SignaturePad', Link: 'Link',
        signatureSubmission, signatureMissingRequirements, signingValuesMatch, hasDrawnSignature, agreementSigningPath,
        nativeContractBoosterFirst, nativeContractPendingStatus,
        CONTRACT_SIGNING_CHANNEL: 'test-signing', date: value => value,
        getStoredUser: () => ({ id: 'company' }), hasValidSession: () => true,
        authStorage: { getItem: () => 'session' }, useNavigate: () => () => {},
        window: { ...eventHub(), innerHeight: 900, scrollY: 0, scrollTo() {}, matchMedia: () => ({ matches: true }) },
        document: eventHub(), crypto: { randomUUID: () => 'signature-request' },
        ...bindings,
    });
    return {
        render() { cursor = 0; refCursor = 0; return component({ id: 'contract' }); },
        state: index => states[index],
        ref: index => refs[index],
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
function textContent(tree) {
    if (tree == null || typeof tree === 'boolean') return '';
    if (typeof tree !== 'object') return String(tree);
    return (Array.isArray(tree) ? tree : [tree.props?.children]).map(textContent).join('');
}
function attachAgreementDocument(fixture, fields = [], frameKey = 'frozen-hash-en') {
    const markerNodes = fields.map(field => ({
        getAttribute: name => name === 'data-native-field' ? field.key : null,
        querySelector: () => ({ focus() {}, getBoundingClientRect: () => ({ top: 100 }) }),
    }));
    const section = { append(node) { node.parentNode = this; }, querySelector: () => ({ before(node) { node.parentNode = section; } }) };
    const mounts = new Map();
    const doc = {
        body: { classList: { add() {}, toggle() {} }, scrollHeight: 1200 },
        documentElement: { scrollHeight: 1200 },
        getElementById: () => section,
        createElement: () => ({ dataset: {}, parentNode: null }),
        querySelectorAll: () => markerNodes,
        querySelector(selector) {
            if (selector === '[data-native-review-mount]') return mounts.get('review');
            if (selector === '[data-native-signature-mount]') return mounts.get('signature');
            return null;
        },
    };
    section.append = node => { node.parentNode = section; mounts.set(node.dataset.nativeReviewMount === '' ? 'review' : 'signature', node); };
    section.querySelector = () => ({ before(node) { section.append(node); } });
    const frame = { contentDocument: doc, dataset: { frameKey }, style: {}, getBoundingClientRect: () => ({ top: 50 }) };
    fixture.render();
    fixture.ref(0).current = frame;
    find(fixture.render(), node => node.type === 'iframe').props.onLoad({ currentTarget: frame });
    return fixture.render();
}
const readyContext = { contract: { id: 'contract', companySignerName: 'Company Signer', signerName: 'Booster' }, documentHash: 'frozen-hash', challenge: 'challenge', values: { EndDate: 'Ongoing' }, fields: [], prepared: true, canSign: true, role: 'company', signingOrder: 'BOOSTER_FIRST', signatures: [], consentText: 'Exact server consent statement.', html: '<h1>Exact agreement</h1>' };

test('the FastBoost owner saves only current agreement fields, including fixed language, without identity fields', async () => {
    const calls = [];
    const draft = { ...readyContext, role: 'company', canPrepare: true, canSign: false, prepared: false, documentHash: null,
        values: { EndDate: 'Ongoing', ReferenceLanguage: 'English/Vietnamese', ProviderLegalName: 'Locked identity', ServiceScope: 'old removed value', AuthorizedSignatory: 'old removed value' },
        fields: [{ key: 'EndDate', label: 'End date' }, { key: 'ReferenceLanguage', label: 'Language' }] };
    const preparedOwner = { ...readyContext, role: 'company', canPrepare: true, canSign: false, values: draft.values, fields: draft.fields };
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); return preparedOwner; } }, [draft, draft.values, true]);
    const tree = attachAgreementDocument(fixture, draft.fields, 'draft-en');
    const review = find(tree, item => item.type === 'button' && item.props.children === 'Review completed agreement');
    assert.ok(review, 'assigned FastBoost owner can save terms from within the document');
    assert.equal(find(tree, item => item.type === 'p' && item.props.children === 'Signing is not available for this account at this stage.'), null);
    await review.props.onClick({ preventDefault() {} });
    assert.equal(calls[0][1], 'prepare');
    assert.equal(JSON.stringify(calls[0][2]), JSON.stringify({ values: { EndDate: 'Ongoing', ReferenceLanguage: 'English/Vietnamese' } }));
    const preparedTree = attachAgreementDocument(fixture, draft.fields);
    assert.ok(find(preparedTree, item => item.props?.className === 'native-inline-notice'), 'owner now waits for booster signature');
    assert.equal(find(preparedTree, item => item.props?.className === 'native-signature-form'), null);
    assert.equal(calls.length, 1, 'preparation alone must not sign');
});

test('the guide jumps through editable document fields and skips the fixed agreement language', async () => {
    const calls = [];
    const fields = [
        { key: 'EndDate', label: 'End date' },
        { key: 'ReferenceLanguage', label: 'Agreement language' },
        { key: 'PaymentMethod', label: 'Agreed payment method' },
    ];
    const draft = { ...readyContext, role: 'company', canPrepare: true, canSign: false, prepared: false, documentHash: null,
        values: { EndDate: 'Ongoing', ReferenceLanguage: 'English/Vietnamese', PaymentMethod: '' }, fields };
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); } }, [draft, draft.values, true]);
    attachAgreementDocument(fixture, fields, 'draft-en');
    const next = find(fixture.render(), item => item.type === 'button' && item.props.children === 'Next field');
    next.props.onClick();
    assert.equal(fixture.state(13), 0);
    find(fixture.render(), item => item.type === 'button' && item.props.children === 'Next field').props.onClick();
    assert.equal(fixture.state(13), 1, 'the second step is PaymentMethod, not ReferenceLanguage');
    assert.equal(calls.length, 0, 'navigation must not prepare or sign a contract');
});

test('the booster sees an unprepared draft without owner textboxes or a prepare action', async () => {
    const boosterDraft = { ...readyContext, role: 'booster', canPrepare: false, canSign: false, prepared: false, documentHash: null,
        values: { EndDate: 'Ongoing' }, fields: [{ key: 'EndDate', label: 'End date' }] };
    const fixture = await componentFixture({}, [boosterDraft, boosterDraft.values, false]);
    const tree = attachAgreementDocument(fixture, boosterDraft.fields, 'draft-en');
    assert.equal(find(tree, item => item.props?.className === 'native-signing-parties'), null);
    assert.equal(find(tree, item => item.props?.className === 'native-signing-outcome'), null);
    assert.ok(find(tree, item => item.props?.className === 'native-inline-notice'));
    assert.equal(find(tree, item => item.type === 'button' && item.props.children === 'Save for booster review'), null);
    assert.equal(find(tree, item => item.props?.className === 'native-inline-field'), null);
});

test('the booster receives a signature form only after owner preparation', async () => {
    const boosterReview = { ...readyContext, role: 'booster', canPrepare: false, canSign: true };
    const fixture = await componentFixture({}, [boosterReview, boosterReview.values, false]);
    const tree = attachAgreementDocument(fixture);
    assert.ok(find(tree, item => item.props?.className === 'native-signature-form'));
    assert.equal(find(tree, item => item.props?.className === 'native-inline-field'), null);
});

test('FastBoost completes the fields and reviews a plain document before explicitly signing first', async () => {
    const calls = [];
    const fields = [{ key: 'PayeeLegalName', label: 'Payee legal name', required: true }];
    const draft = { ...readyContext, signingOrder: 'COMPANY_FIRST', canPrepare: true, canSign: false, prepared: false, documentHash: null, values: { PayeeLegalName: 'Booster Example' }, fields };
    const prepared = { ...draft, prepared: true, documentHash: 'frozen-hash', canSign: true };
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); return prepared; } }, [draft, draft.values, true]);
    const tree = attachAgreementDocument(fixture, fields, 'draft-en');
    assert.ok(find(tree, item => item.props?.className === 'native-inline-field'));
    assert.equal(find(tree, item => item.props?.className === 'native-inline-actions')?.props.children?.type, 'button', 'preparation has a single compact action');
    await find(tree, item => item.type === 'button' && item.props.children === 'Review completed agreement').props.onClick({ preventDefault() {} });
    const review = attachAgreementDocument(fixture, fields);
    assert.equal(find(review, item => item.props?.className === 'native-inline-field'), null, 'completed terms are document text');
    assert.ok(find(review, item => item.props?.className === 'native-signature-form'));
    assert.equal(find(review, item => item.type === 'input' && item.props.type === 'checkbox').props.checked, false, 'review requires fresh signing consent');
    assert.deepEqual(calls.map(call => call[1]), ['prepare'], 'review never signs automatically');
});

test('the booster only reads completed terms and signs after FastBoost', async () => {
    const fields = [{ key: 'PayeeLegalName', label: 'Payee legal name' }];
    const context = { ...readyContext, signingOrder: 'COMPANY_FIRST', role: 'booster', canPrepare: false, canSign: false, fields, values: { PayeeLegalName: 'Booster Example' } };
    const waiting = await componentFixture({}, [context, context.values, true]);
    const before = attachAgreementDocument(waiting, fields);
    assert.equal(find(before, item => item.props?.className === 'native-inline-field'), null, 'stale editing state cannot expose owner fields');
    assert.equal(find(before, item => item.props?.className === 'native-signature-form'), null);
    const signedContext = { ...context, canSign: true, contract: { ...context.contract, companySignedAt: '2026-10-27' }, signatures: [{ role: 'COMPANY' }] };
    const ready = await componentFixture({}, [signedContext, context.values, false]);
    const after = attachAgreementDocument(ready, fields);
    assert.equal(find(after, item => item.props?.className === 'native-inline-field'), null);
    assert.equal(find(after, item => item.type === 'button' && item.props.children === 'Edit details'), null);
    assert.ok(find(after, item => item.props?.className === 'native-signature-form'));
});

test('switching to the Vietnamese reading view does not submit a signature', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); } }, [readyContext, readyContext.values, false]);
    const toggle = find(fixture.render(), item => item.type === 'button' && item.props.children === 'VN');
    toggle.props.onClick();
    const tree = fixture.render();
    assert.equal(find(tree, item => item.type === 'iframe').props['data-frame-key'], 'frozen-hash-vi');
    assert.equal(calls.length, 0);
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
    const tree = attachAgreementDocument(fixture);
    assert.equal(calls.length, 0, 'displaying the page cannot accept a contract');
    const form = find(tree, item => item.props?.className === 'native-signature-form');
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'sign');
    assert.equal(calls[0][2].documentHash, readyContext.documentHash);
    assert.equal(calls[0][2].challenge, readyContext.challenge);
    assert.equal(calls[0][2].consent, true);
});

test('the embedded agreement allows form submission while keeping document scripts blocked', async () => {
    const fixture = await componentFixture({}, [readyContext, readyContext.values, false]);
    const frame = find(fixture.render(), item => item.type === 'iframe');
    const permissions = new Set(frame.props.sandbox.split(/\s+/));
    assert.ok(permissions.has('allow-forms'), 'a browser must be able to dispatch the embedded form submit event');
    assert.ok(permissions.has('allow-same-origin'), 'the parent must still mount and control the signature form');
    assert.equal(permissions.has('allow-scripts'), false, 'agreement HTML must not execute its own scripts');
});

test('missing signing requirements appear beside the disabled button and clear as the signer completes them', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); } }, [readyContext, readyContext.values, false]);
    let form = find(attachAgreementDocument(fixture), item => item.props?.className === 'native-signature-form');
    let guidance = find(form, item => item.props?.id === 'native-signature-requirements');
    let submit = find(form, item => item.type === 'button' && item.props.children === 'Sign agreement');
    assert.ok(guidance, 'the explanation belongs inside the visible signing form');
    assert.equal(guidance.props.role, 'status');
    for (const key of ['signatureNameRequired', 'signatureInitialsRequired', 'signatureConsentRequired']) {
        assert.ok(textContent(guidance).includes(nativeSigningText('en', key)), `missing ${key} is explained`);
    }
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props['aria-describedby'], guidance.props.id);
    find(form, item => item.type === 'input' && item.props.name === 'legalName').props.onChange({ target: { value: 'C' } });
    form = find(fixture.render(), item => item.props?.className === 'native-signature-form');
    guidance = find(form, item => item.props?.id === 'native-signature-requirements');
    assert.ok(textContent(guidance).includes(nativeSigningText('en', 'signatureNameRequired')), 'a one-character name must still explain the minimum length');
    find(form, item => item.type === 'input' && item.props.name === 'legalName').props.onChange({ target: { value: 'Company Signer' } });
    find(form, item => item.type === 'input' && item.props.name === 'initials').props.onChange({ target: { value: 'CS' } });
    form = find(fixture.render(), item => item.props?.className === 'native-signature-form');
    guidance = find(form, item => item.props?.id === 'native-signature-requirements');
    assert.ok(textContent(guidance).includes(nativeSigningText('en', 'signatureConsentRequired')));
    assert.equal(textContent(guidance).includes(nativeSigningText('en', 'signatureNameRequired')), false);
    assert.equal(textContent(guidance).includes(nativeSigningText('en', 'signatureInitialsRequired')), false);
    find(form, item => item.type === 'input' && item.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    form = find(fixture.render(), item => item.props?.className === 'native-signature-form');
    submit = find(form, item => item.type === 'button' && item.props.children === 'Sign agreement');
    assert.equal(find(form, item => item.props?.id === 'native-signature-requirements'), null);
    assert.equal(submit.props.disabled, false);
    assert.equal(Boolean(submit.props['aria-describedby']), false);
    assert.equal(calls.length, 0, 'completing the prerequisites must not sign automatically');
});

test('drawn signing explains the missing drawing in the selected language until a stroke is supplied', async () => {
    const states = [readyContext, readyContext.values, false, 'Company Signer', 'CS', { type: 'drawn', width: 600, height: 180, strokes: [] }, true];
    states[14] = 'vi';
    const fixture = await componentFixture({}, states);
    let form = find(attachAgreementDocument(fixture, [], 'frozen-hash-vi'), item => item.props?.className === 'native-signature-form');
    const guidance = find(form, item => item.props?.id === 'native-signature-requirements');
    assert.ok(guidance);
    const translated = nativeSigningText('vi', 'signatureDrawingRequired');
    assert.notEqual(translated, nativeSigningText('en', 'signatureDrawingRequired'));
    assert.ok(textContent(guidance).includes(translated));
    assert.equal(find(form, item => item.type === 'button' && item.props.children === nativeSigningText('vi', 'signAgreement')).props.disabled, true);
    find(form, item => item.type === 'SignaturePad').props.onChange({ type: 'drawn', width: 600, height: 180, strokes: [[[1, 1], [10, 10]]] });
    form = find(fixture.render(), item => item.props?.className === 'native-signature-form');
    assert.equal(find(form, item => item.props?.id === 'native-signature-requirements'), null);
    assert.equal(find(form, item => item.type === 'button' && item.props.children === nativeSigningText('vi', 'signAgreement')).props.disabled, false);
});

test('a rejected signature is explained in the form without a second offscreen alert', async () => {
    const failureMessage = 'Use the full legal name assigned to your signing invitation.';
    const fixture = await componentFixture({ nativeContractRequest: async () => { throw Object.assign(new Error(failureMessage), { status: 400 }); } },
        [readyContext, readyContext.values, false, 'Incorrect Signer', 'IS', { type: 'typed' }, true]);
    await find(attachAgreementDocument(fixture), item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
    const tree = fixture.render();
    const form = find(tree, item => item.props?.className === 'native-signature-form');
    const inlineAlert = find(form, item => item.props?.role === 'alert');
    assert.ok(inlineAlert, 'a signer at the end of the document must see why submission failed');
    assert.equal(textContent(inlineAlert), failureMessage);
    const alerts = [];
    find(tree, item => { if (item.props?.role === 'alert') alerts.push(item); return false; });
    assert.deepEqual(alerts, [inlineAlert], 'the same error must not also be announced above the document');
    assert.equal(find(form, item => item.type === 'input' && item.props.type === 'checkbox').props.checked, false, 'a rejected signing attempt requires renewed consent');
});

test('uncertain server replies lock editing and retry the identical signing intent', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); throw new Error('Connection lost'); } }, [readyContext, readyContext.values, false, 'Company Signer', 'CS', { type: 'typed' }, true]);
    await find(attachAgreementDocument(fixture), item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
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
    const submit = find(attachAgreementDocument(fixture), item => item.props?.className === 'native-signature-form').props.onSubmit;
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
