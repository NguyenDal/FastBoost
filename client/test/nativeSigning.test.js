import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transformWithOxc } from 'vite';
import { agreementSigningPath, formatLocalSignatureTime, hasDrawnSignature, signatureMissingRequirements, signatureSubmission, signingValuesMatch } from '../src/utils/nativeSigning.js';
import { nativeSigningText, nativeSigningFieldLabel, nativeSigningFieldHelp } from '../src/utils/nativeSigningI18n.js';
import { nativeContractBoosterFirst, nativeContractPendingStatus } from '../src/utils/contractSigning.js';

test('the built-in agreement route binds the specific contract and retains a safe local destination', () => {
    assert.equal(agreementSigningPath('contract-123'), '/provider/contracts/contract-123/sign');
    assert.equal(agreementSigningPath('a&contract=b'), '/provider/contracts/a%26contract%3Db/sign');
});

test('signature times show the same instant in the reader timezone and language', () => {
    const instant = '2026-10-29T00:54:49.153Z';
    assert.equal(formatLocalSignatureTime(instant, 'en', 'America/Winnipeg'), 'Oct 28, 2026, 7:54 PM');
    assert.equal(formatLocalSignatureTime(instant, 'en', 'Asia/Ho_Chi_Minh'), 'Oct 29, 2026, 7:54 AM');
    assert.equal(formatLocalSignatureTime(instant, 'vi', 'Asia/Ho_Chi_Minh'), '7:54 29 thg 10, 2026');
    for (const invalid of ['', null, undefined, 'not-a-timestamp']) assert.equal(formatLocalSignatureTime(invalid), null);
});

test('only the exact prepared commercial values remain eligible for signing', () => {
    assert.equal(signingValuesMatch({ WorkLocation: 'Canada', EndDate: 'Ongoing' }, { EndDate: 'Ongoing', WorkLocation: 'Canada' }), true);
    assert.equal(signingValuesMatch({ WorkLocation: 'Canada', EndDate: 'Ongoing' }, { WorkLocation: 'Canada', EndDate: '2026-12-31' }), false);
    assert.equal(signingValuesMatch({ WorkLocation: 'Canada' }, { WorkLocation: 'Canada', EndDate: 'Ongoing' }), false);
});

test('ambiguous signature retries preserve request identity and original challenge', () => {
    let ids = 0;
    const input = { context: { documentHash: 'accepted-hash', challenge: 'challenge-one' }, legalName: '  Test Signer  ', consent: true };
    const first = signatureSubmission(input, null, () => `request-${++ids}`);
    const retried = signatureSubmission({ ...input, context: { ...input.context, challenge: 'refreshed-challenge' } }, first, () => `request-${++ids}`);
    assert.equal(retried, first);
    assert.equal(retried.body.requestId, 'request-1');
    assert.equal(retried.body.challenge, 'challenge-one');
    assert.equal(retried.body.legalName, 'Test Signer');
    assert.equal(Object.hasOwn(retried.body, 'initials'), false, 'name-only signing must not invent initials');
    assert.deepEqual(retried.body.signature, { type: 'typed' });
    const changed = signatureSubmission({ ...input, context: { ...input.context, documentHash: 'another-document' } }, first, () => `request-${++ids}`);
    assert.equal(changed.body.requestId, 'request-2');
});

test('name-only signing still requires a prepared document, explicit acceptance and a valid name', () => {
    const input = { context: { documentHash: 'hash', challenge: 'challenge' }, legalName: 'Signer', consent: true };
    for (const changed of [{ context: {} }, { consent: false }, { legalName: ' ' }, { legalName: 'A' }]) {
        assert.throws(() => signatureSubmission({ ...input, ...changed }, null, () => 'unused'));
    }
    assert.deepEqual(signatureMissingRequirements({ legalName: '' }), ['legalName']);
    assert.deepEqual(signatureMissingRequirements({ legalName: 'Signer' }), []);
});

test('drawn signing rejects empty marks and typed signing never submits preserved drawing strokes', () => {
    const input = { context: { documentHash: 'hash', challenge: 'challenge' }, legalName: 'Signer', consent: true };
    for (const strokes of [[], [[[1, 1]]]]) {
        const signature = { type: 'drawn', width: 600, height: 180, strokes };
        assert.deepEqual(signatureMissingRequirements({ legalName: 'Signer', signature }), ['signature']);
        assert.throws(() => signatureSubmission({ ...input, signature }, null, () => 'unused'));
    }
    const strokes = [[[1, 1], [10, 10]]];
    assert.equal(hasDrawnSignature({ type: 'drawn', strokes }), true);
    const typed = signatureSubmission({ ...input, signature: { type: 'typed', width: 600, height: 180, strokes } }, null, () => 'request');
    assert.deepEqual(typed.body.signature, { type: 'typed' }, 'the chosen signing mode controls the recorded evidence');
    const drawn = signatureSubmission({ ...input, signature: { type: 'drawn', style: 3, width: 600, height: 180, strokes } }, null, () => 'drawing-request');
    assert.deepEqual(drawn.body.signature, { type: 'drawn', width: 600, height: 180, strokes }, 'drawn evidence does not retain an unrelated font style');
});

test('typed signature style is validated, recorded and included in retry identity', () => {
    let ids = 0;
    const input = { context: { documentHash: 'accepted-hash', challenge: 'first-challenge' }, legalName: 'Signer', consent: true, signature: { type: 'typed', style: 1 } };
    const first = signatureSubmission(input, null, () => `request-${++ids}`);
    assert.deepEqual(first.body.signature, { type: 'typed', style: 1 });
    const retry = signatureSubmission({ ...input, context: { ...input.context, challenge: 'new-challenge' } }, first, () => `request-${++ids}`);
    assert.equal(retry, first, 'a retry of the same displayed mark retains its exact request');
    for (const style of [2, 3]) {
        const changed = signatureSubmission({ ...input, signature: { type: 'typed', style } }, first, () => `request-${++ids}`);
        assert.notEqual(changed.body.requestId, first.body.requestId, 'changing the displayed signature is a new signing intent');
        assert.deepEqual(changed.body.signature, { type: 'typed', style });
    }
    for (const style of [0, 4, '2', null, Number.NaN]) {
        assert.throws(() => signatureSubmission({ ...input, signature: { type: 'typed', style } }, null, () => 'unused'), /signature style/);
    }
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
        createPortal: (children, target) => ({ ...children, portalTarget: target }), translateAgreementHtml: html => html,
        nativeSigningText, nativeSigningFieldLabel, nativeSigningFieldHelp,
        Navbar: 'Navbar', Link: 'Link', ContractSignaturePad: 'SignaturePad',
        signatureSubmission, signatureMissingRequirements, signingValuesMatch, hasDrawnSignature, agreementSigningPath, formatLocalSignatureTime,
        nativeContractBoosterFirst, nativeContractPendingStatus,
        CONTRACT_SIGNING_CHANNEL: 'test-signing', date: value => value,
        getStoredUser: () => ({ id: 'company' }), hasValidSession: () => true,
        authStorage: { getItem: () => 'session' }, useNavigate: () => () => {},
        window: { ...eventHub(), innerHeight: 900, scrollY: 0, scrollTo() {}, matchMedia: () => ({ matches: true }) },
        document: eventHub(), crypto: { randomUUID: () => 'signature-request' },
        ...bindings,
    });
    return {
        render(props = { id: 'contract' }) { cursor = 0; refCursor = 0; return component(props); },
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
function attachAgreementDocument(fixture, fields = [], frameKey = 'frozen-hash-en', times = []) {
    const markerNodes = fields.map(field => ({
        getAttribute: name => name === 'data-native-field' ? field.key : null,
        querySelector: () => ({ focus() {}, getBoundingClientRect: () => ({ top: 100 }) }),
    }));
    const mounts = new Map();
    const classList = () => {
        const classes = new Set();
        return { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); } };
    };
    const node = (dataset = {}) => ({
        dataset, parentNode: null, classList: classList(), children: [], hidden: false,
        append(child) { child.parentNode = this; this.children.push(child); for (const key of Object.keys(child.dataset)) mounts.set(key, child); },
        before(child) { this.parentNode.append(child); },
        closest(selector) { return selector === '[data-native-signature-role]' ? (this.dataset.nativeSignatureRole ? this : this.parentNode?.closest(selector)) : null; },
        getAttribute(name) { return name === 'data-native-signature-role' ? this.dataset.nativeSignatureRole : null; },
    });
    const section = node(), cards = node();
    section.append(cards);
    const roleCards = Object.fromEntries(['COMPANY', 'BOOSTER'].map(role => {
        const card = node({ nativeSignatureRole: role });
        const mark = node(), details = node();
        card.append(mark); card.append(details);
        card.querySelector = selector => selector === '.fb-signature-mark' ? mark : selector === '.fb-signature-details' ? details : null;
        cards.append(card);
        return [role, card];
    }));
    const select = selector => {
        if (selector === '[data-native-review-mount]') return mounts.get('nativeReviewMount');
        if (selector === '[data-native-signature-mount]') return mounts.get('nativeSignatureMount');
        if (selector === '[data-native-signing-notice-mount]') return mounts.get('nativeSigningNoticeMount');
        if (selector === '.fb-signatures') return cards;
        const role = selector.match(/data-native-signature-role=["'](COMPANY|BOOSTER)["']/)?.[1];
        return role ? roleCards[role] : null;
    };
    section.querySelector = select;
    const doc = {
        body: { classList: { add() {}, toggle() {} }, scrollHeight: 1200 },
        documentElement: { scrollHeight: 1200 },
        getElementById: () => section,
        createElement: () => node(),
        querySelectorAll: selector => selector === '[data-native-field]' ? markerNodes : selector === '[data-native-signature-role]' ? Object.values(roleCards) : selector === 'time[data-native-date-time]' ? times : [],
        querySelector: select,
    };
    const frame = { contentDocument: doc, dataset: { frameKey }, style: {}, getBoundingClientRect: () => ({ top: 50 }) };
    fixture.render();
    fixture.ref(0).current = frame;
    find(fixture.render(), node => node.type === 'iframe').props.onLoad({ currentTarget: frame });
    return fixture.render();
}
const readyContext = { contract: { id: 'contract', companySignerName: 'Company Signer', signerName: 'Booster' }, documentHash: 'frozen-hash', challenge: 'challenge', values: { EndDate: 'Ongoing' }, fields: [], prepared: true, canSign: true, role: 'company', signingOrder: 'BOOSTER_FIRST', signatures: [], consentText: 'Exact server consent statement.', html: '<h1>Exact agreement</h1>' };

test('loading the agreement localizes visible signature times without changing exact audit timestamps', async () => {
    const instant = '2026-10-29T00:54:49.153Z';
    const attributes = Object.freeze({ datetime: instant, title: instant, 'data-native-date-time': instant });
    const time = { textContent: 'Original UTC display', getAttribute: name => attributes[name], setAttribute() { assert.fail('timestamp attributes must remain unchanged'); } };
    const malformed = { textContent: 'Original fallback', getAttribute: () => 'invalid-timestamp' };
    const fixture = await componentFixture({ formatLocalSignatureTime: (value, language) => formatLocalSignatureTime(value, language, 'America/Winnipeg') }, [readyContext, readyContext.values, false]);
    attachAgreementDocument(fixture, [], 'frozen-hash-en', [time, malformed]);
    assert.equal(time.textContent, 'Oct 28, 2026, 7:54 PM');
    assert.deepEqual(attributes, { datetime: instant, title: instant, 'data-native-date-time': instant });
    assert.equal(malformed.textContent, 'Original fallback', 'an invalid display marker must not erase the original value');
});

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
    assert.equal(fixture.state(10), 0);
    find(fixture.render(), item => item.type === 'button' && item.props.children === 'Next field').props.onClick();
    assert.equal(fixture.state(10), 1, 'the second step is PaymentMethod, not ReferenceLanguage');
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

test('each signer enters their name inside only their own eligible signature card', async () => {
    for (const [role, expectedCard] of [['company', 'COMPANY'], ['booster', 'BOOSTER']]) {
        const context = { ...readyContext, role };
        const fixture = await componentFixture({}, [context, context.values, false]);
        const tree = attachAgreementDocument(fixture);
        const forms = [];
        find(tree, item => { if (item.props?.className === 'native-signature-form') forms.push(item); return false; });
        assert.equal(forms.length, 1);
        assert.equal(forms[0].portalTarget.closest('[data-native-signature-role]')?.dataset.nativeSignatureRole, expectedCard);
        const inputs = [];
        find(forms[0], item => { if (item.type === 'input') inputs.push(item); return false; });
        assert.deepEqual(inputs.map(item => item.props.name), ['legalName']);
        const box = find(forms[0], item => item.props?.className === 'native-signature-box');
        assert.ok(box, 'the signature input has a shared box with its mode controls');
        assert.ok(find(box, item => item.props?.className === 'native-signature-options'), 'Auto/Draw controls belong inside the signature box');
        assert.equal(find(box, item => item.type === 'input' && item.props.name === 'legalName'), inputs[0]);
    }
});

test('focusing the signature box fills the assigned name for each role without signing', async () => {
    for (const [role, expectedName] of [['company', 'Company Signer'], ['booster', 'Booster']]) {
        const calls = [];
        const context = { ...readyContext, role };
        const fixture = await componentFixture({ nativeContractRequest: async (...args) => calls.push(args) }, [context, context.values, false]);
        const input = find(attachAgreementDocument(fixture), item => item.type === 'input' && item.props.name === 'legalName');
        assert.equal(input.props.value, '', 'the signature box remains empty until the signer chooses it');
        input.props.onFocus();
        const tree = fixture.render();
        assert.equal(find(tree, item => item.type === 'input' && item.props.name === 'legalName').props.value, expectedName);
        assert.equal(find(tree, item => item.type === 'button' && item.props.type === 'submit').props.disabled, false);
        assert.equal(calls.length, 0, 'choosing the signature box cannot accept an agreement');
    }
});

test('refocusing the signature box preserves a name the signer has edited', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => calls.push(args) }, [readyContext, readyContext.values, false]);
    let input = find(attachAgreementDocument(fixture), item => item.type === 'input' && item.props.name === 'legalName');
    input.props.onFocus();
    input = find(fixture.render(), item => item.type === 'input' && item.props.name === 'legalName');
    input.props.onChange({ target: { value: 'Company Legal Signer' } });
    input = find(fixture.render(), item => item.type === 'input' && item.props.name === 'legalName');
    input.props.onFocus();
    assert.equal(find(fixture.render(), item => item.type === 'input' && item.props.name === 'legalName').props.value, 'Company Legal Signer');
    assert.equal(calls.length, 0);
});

test('a locked signature box cannot refill the name during submission or uncertain confirmation', async () => {
    for (const [busy, uncertain] of [[true, false], [false, true]]) {
        const calls = [];
        const fixture = await componentFixture({ nativeContractRequest: async (...args) => calls.push(args) }, [readyContext, readyContext.values, false, '', busy, '', uncertain]);
        const input = find(attachAgreementDocument(fixture), item => item.type === 'input' && item.props.name === 'legalName');
        assert.equal(input.props.disabled, true);
        input.props.onFocus();
        assert.equal(find(fixture.render(), item => item.type === 'input' && item.props.name === 'legalName').props.value, '');
        assert.equal(calls.length, 0);
    }
});

test('Draw requires a real mark and records it only after explicit signing', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); return {}; } }, [readyContext, readyContext.values, false]);
    let tree = attachAgreementDocument(fixture);
    find(tree, item => item.type === 'button' && item.props.children === 'Draw').props.onClick();
    tree = fixture.render();
    const emptyPad = find(tree, item => item.type === 'SignaturePad');
    assert.ok(emptyPad);
    const box = find(tree, item => item.props?.className === 'native-signature-box');
    assert.equal(find(box, item => item.type === 'SignaturePad'), emptyPad);
    assert.ok(find(box, item => item.props?.className === 'native-signature-options'), 'drawing and Auto/Draw controls share the same signature box');
    assert.equal(find(tree, item => item.type === 'button' && item.props.type === 'submit').props.disabled, true);
    assert.equal(find(tree, item => item.type === 'input' && item.props.name === 'initials'), null);
    assert.equal(calls.length, 0, 'selecting Draw cannot sign');
    const drawing = { type: 'drawn', width: 600, height: 180, strokes: [[[20, 70], [45, 60], [80, 90]]] };
    emptyPad.props.onChange(drawing);
    tree = fixture.render();
    assert.equal(find(tree, item => item.type === 'button' && item.props.type === 'submit').props.disabled, false);
    assert.equal(calls.length, 0, 'drawing cannot sign automatically');
    await find(tree, item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'sign');
    assert.equal(calls[0][2].legalName, readyContext.contract.companySignerName);
    assert.equal(calls[0][2].consent, true);
    assert.equal(JSON.stringify(calls[0][2].signature), JSON.stringify(drawing));
    assert.equal(Object.hasOwn(calls[0][2], 'initials'), false);
});

test('Auto and Draw preserve an unfinished drawing while mode changes never sign', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => calls.push(args) }, [readyContext, readyContext.values, false]);
    let tree = attachAgreementDocument(fixture);
    assert.equal(find(tree, item => item.type === 'button' && item.props.children === 'Auto').props['aria-pressed'], true);
    find(tree, item => item.type === 'button' && item.props['aria-label'] === 'Signature style 2').props.onClick();
    tree = fixture.render();
    find(tree, item => item.type === 'button' && item.props.children === 'Draw').props.onClick();
    const drawing = { type: 'drawn', width: 600, height: 180, strokes: [[[1, 2], [3, 4]]] };
    find(fixture.render(), item => item.type === 'SignaturePad').props.onChange(drawing);
    tree = fixture.render();
    find(tree, item => item.type === 'button' && item.props.children === 'Auto').props.onClick();
    tree = fixture.render();
    assert.equal(find(tree, item => item.type === 'SignaturePad'), null);
    assert.equal(find(tree, item => item.type === 'input' && item.props.name === 'legalName').props.value, readyContext.contract.companySignerName);
    assert.equal(find(tree, item => item.type === 'input' && item.props.name === 'legalName').props['data-signature-style'], 2);
    find(tree, item => item.type === 'button' && item.props.children === 'Draw').props.onClick();
    tree = fixture.render();
    assert.equal(find(tree, item => item.type === 'button' && item.props.children === 'Draw').props['aria-pressed'], true);
    assert.equal(JSON.stringify(find(tree, item => item.type === 'SignaturePad').props.signature.strokes), JSON.stringify(drawing.strokes));
    assert.equal(calls.length, 0);
});

test('selecting a signature style fills the name but records that style only on explicit signing', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); return {}; } }, [readyContext, readyContext.values, false]);
    let tree = attachAgreementDocument(fixture);
    const box = find(tree, item => item.props?.className === 'native-signature-box');
    for (const [index, font] of ['Original handwriting', 'Dancing Script', 'Great Vibes'].entries()) {
        const option = find(box, item => item.type === 'button' && item.props['aria-label'] === `Signature style ${index + 1}`);
        assert.equal(option.props.title, font);
        assert.equal(option.props['aria-pressed'], index === 0);
    }
    find(box, item => item.type === 'button' && item.props['aria-label'] === 'Signature style 3').props.onClick();
    tree = fixture.render();
    const input = find(tree, item => item.type === 'input' && item.props.name === 'legalName');
    assert.equal(input.props.value, readyContext.contract.companySignerName);
    assert.equal(input.props['data-signature-style'], 3);
    assert.equal(calls.length, 0, 'choosing a visual style cannot accept an agreement');
    await find(tree, item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(calls[0][2].signature), JSON.stringify({ type: 'typed', style: 3 }));
});

test('clearing a drawing keeps the selected typed style for returning to Auto', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => calls.push(args) }, [readyContext, readyContext.values, false]);
    let tree = attachAgreementDocument(fixture);
    find(tree, item => item.type === 'button' && item.props['aria-label'] === 'Signature style 3').props.onClick();
    tree = fixture.render();
    find(tree, item => item.type === 'button' && item.props.children === 'Draw').props.onClick();
    let pad = find(fixture.render(), item => item.type === 'SignaturePad');
    pad.props.onChange({ type: 'drawn', width: 600, height: 180, strokes: [[[1, 2], [3, 4]]] });
    pad = find(fixture.render(), item => item.type === 'SignaturePad');
    assert.equal(pad.props.clearLabel, 'Clear signature');
    const padFixture = await componentFixture({}, [], { name: 'ContractSignaturePad', path: '../src/components/ContractSignaturePad.jsx' });
    const clear = find(padFixture.render(pad.props), item => item.type === 'button' && item.props['aria-label'] === 'Clear signature');
    assert.equal(clear.props.disabled, false);
    clear.props.onClick();
    tree = fixture.render();
    assert.equal(find(tree, item => item.type === 'SignaturePad').props.signature.strokes.length, 0);
    assert.equal(find(tree, item => item.type === 'button' && item.props.type === 'submit').props.disabled, true);
    find(tree, item => item.type === 'button' && item.props.children === 'Auto').props.onClick();
    tree = fixture.render();
    assert.equal(find(tree, item => item.type === 'input' && item.props.name === 'legalName').props['data-signature-style'], 3);
    assert.equal(calls.length, 0);
});

test('signature modes and styles are locked while submission or confirmation is pending', async () => {
    for (const [busy, uncertain] of [[true, false], [false, true]]) {
        const fixture = await componentFixture({}, [readyContext, readyContext.values, false, 'Company Signer', busy, '', uncertain]);
        const tree = attachAgreementDocument(fixture);
        for (const label of ['Auto', 'Draw']) {
            assert.equal(find(tree, item => item.type === 'button' && item.props.children === label).props.disabled, true);
        }
        for (const style of [1, 2, 3]) {
            const option = find(tree, item => item.type === 'button' && item.props['aria-label'] === `Signature style ${style}`);
            assert.equal(option.props.disabled, true);
            option.props.onClick();
        }
        assert.equal(fixture.state(12).style, 1, 'even a queued style action must not change a pending signing intent');
    }
});

test('a saved signature keeps the document visible without a redundant saved panel or another signing form', async () => {
    for (const role of ['company', 'booster']) {
        const context = { ...readyContext, role, canSign: false, signatures: [{ role: role === 'company' ? 'COMPANY' : 'BOOSTER', legalName: 'Signed Person' }] };
        const fixture = await componentFixture({}, [context, context.values, false]);
        const tree = attachAgreementDocument(fixture);
        assert.ok(find(tree, item => item.type === 'iframe'));
        assert.equal(find(tree, item => item.props?.className === 'native-signing-outcome'), null);
        assert.equal(find(tree, item => item.props?.className === 'native-signature-form'), null);
        assert.equal(find(tree, item => item.props?.className === 'native-signature-options'), null);
        assert.equal(find(tree, item => item.props?.className === 'native-signing-unavailable'), null);
    }
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
    assert.equal(find(review, item => item.type === 'input' && item.props.name === 'legalName').props.value, '', 'review still needs the signer to enter their name');
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

test('rendering a ready agreement never signs it; explicit submit uses the accepted snapshot and typed name only', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); return {}; } }, [readyContext, readyContext.values, false, 'Company Signer']);
    const tree = attachAgreementDocument(fixture);
    assert.equal(calls.length, 0, 'displaying the page cannot accept a contract');
    const form = find(tree, item => item.props?.className === 'native-signature-form');
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'sign');
    assert.equal(calls[0][2].documentHash, readyContext.documentHash);
    assert.equal(calls[0][2].challenge, readyContext.challenge);
    assert.equal(calls[0][2].consent, true);
    assert.equal(calls[0][2].legalName, 'Company Signer');
    assert.equal(Object.hasOwn(calls[0][2], 'initials'), false);
    assert.equal(JSON.stringify(calls[0][2].signature), JSON.stringify({ type: 'typed', style: 1 }));
    assert.equal(find(fixture.render(), item => item.props?.className === 'native-signing-message'), null, 'saving does not add another success panel above the agreement');
});

test('the embedded agreement allows form submission while keeping document scripts blocked', async () => {
    const fixture = await componentFixture({}, [readyContext, readyContext.values, false]);
    const frame = find(fixture.render(), item => item.type === 'iframe');
    const permissions = new Set(frame.props.sandbox.split(/\s+/));
    assert.ok(permissions.has('allow-forms'), 'a browser must be able to dispatch the embedded form submit event');
    assert.ok(permissions.has('allow-same-origin'), 'the parent must still mount and control the signature form');
    assert.equal(permissions.has('allow-scripts'), false, 'agreement HTML must not execute its own scripts');
});

test('typing a name enables signing but never submits until the user explicitly signs', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); } }, [readyContext, readyContext.values, false]);
    let form = find(attachAgreementDocument(fixture), item => item.props?.className === 'native-signature-form');
    let submit = find(form, item => item.type === 'button' && item.props.children === 'Sign agreement');
    assert.equal(find(form, item => item.props?.id === 'native-signature-requirements'), null);
    assert.equal(submit.props.disabled, true);
    assert.equal(find(form, item => item.type === 'input' && item.props.name === 'initials'), null);
    assert.equal(find(form, item => item.type === 'input' && ['checkbox', 'radio'].includes(item.props.type)), null);
    assert.equal(find(form, item => item.type === 'SignaturePad'), null);
    assert.equal(find(form, item => item.props?.id === 'native-signature-consent'), null, 'the card does not repeat the agreement instructions');
    assert.equal(textContent(form).includes(readyContext.consentText), false);
    assert.equal(submit.props['aria-describedby'], undefined, 'the button must not refer to a removed instruction');
    find(form, item => item.type === 'input' && item.props.name === 'legalName').props.onChange({ target: { value: 'C' } });
    form = find(fixture.render(), item => item.props?.className === 'native-signature-form');
    assert.equal(find(form, item => item.type === 'button' && item.props.children === 'Sign agreement').props.disabled, true);
    find(form, item => item.type === 'input' && item.props.name === 'legalName').props.onChange({ target: { value: 'Company Signer' } });
    form = find(fixture.render(), item => item.props?.className === 'native-signature-form');
    submit = find(form, item => item.type === 'button' && item.props.children === 'Sign agreement');
    assert.equal(find(form, item => item.props?.id === 'native-signature-requirements'), null);
    assert.equal(submit.props.disabled, false);
    assert.equal(calls.length, 0, 'completing the prerequisites must not sign automatically');
});

test('the Vietnamese view keeps the same single-name signing action and does not submit on typing', async () => {
    const calls = [];
    const states = [readyContext, readyContext.values, false, '', false, '', false, '', null, '', -1, 'vi'];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => calls.push(args) }, states);
    let form = find(attachAgreementDocument(fixture, [], 'frozen-hash-vi'), item => item.props?.className === 'native-signature-form');
    assert.equal(find(form, item => item.props?.id === 'native-signature-requirements'), null);
    assert.equal(find(form, item => item.type === 'button' && item.props.children === nativeSigningText('vi', 'signAgreement')).props.disabled, true);
    find(form, item => item.type === 'input' && item.props.name === 'legalName').props.onChange({ target: { value: 'Nguyễn An' } });
    form = find(fixture.render(), item => item.props?.className === 'native-signature-form');
    assert.equal(find(form, item => item.type === 'button' && item.props.children === nativeSigningText('vi', 'signAgreement')).props.disabled, false);
    assert.equal(find(form, item => item.type === 'input' && item.props.name === 'initials'), null);
    assert.equal(find(form, item => item.props?.className === 'native-consent-translation'), null);
    assert.equal(find(form, item => item.props?.id === 'native-signature-consent'), null);
    assert.equal(calls.length, 0);
});

test('a rejected signature is explained in the form without a second offscreen alert', async () => {
    const failureMessage = 'Use the full legal name assigned to your signing invitation.';
    const fixture = await componentFixture({ nativeContractRequest: async () => { throw Object.assign(new Error(failureMessage), { status: 400 }); } },
        [readyContext, readyContext.values, false, 'Incorrect Signer']);
    await find(attachAgreementDocument(fixture), item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
    const tree = fixture.render();
    const form = find(tree, item => item.props?.className === 'native-signature-form');
    const inlineAlert = find(form, item => item.props?.role === 'alert');
    assert.ok(inlineAlert, 'a signer at the end of the document must see why submission failed');
    assert.equal(textContent(inlineAlert), failureMessage);
    const alerts = [];
    find(tree, item => { if (item.props?.role === 'alert') alerts.push(item); return false; });
    assert.deepEqual(alerts, [inlineAlert], 'the same error must not also be announced above the document');
    assert.equal(find(form, item => item.type === 'button' && item.props.type === 'submit').props.disabled, false, 'a definitive rejection allows another explicit signing attempt');
});

test('uncertain server replies lock editing and retry the identical signing intent', async () => {
    const calls = [];
    const fixture = await componentFixture({ nativeContractRequest: async (...args) => { calls.push(args); throw new Error('Connection lost'); } }, [readyContext, readyContext.values, false, 'Company Signer']);
    await find(attachAgreementDocument(fixture), item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
    assert.equal(fixture.state(6), true);
    const retry = fixture.render();
    assert.equal(find(retry, item => item.type === 'input' && item.props?.autoComplete === 'name').props.disabled, true);
    await find(retry, item => item.props?.className === 'native-signature-form').props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][2], calls[1][2]);
});

test('repeated submission is serialized before React commits disabled controls', async () => {
    let finish, count = 0;
    const fixture = await componentFixture({ nativeContractRequest: async () => { count++; await new Promise(resolve => { finish = resolve; }); return {}; } }, [readyContext, readyContext.values, false, 'Company Signer']);
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
    }, [null, {}, false, 'Previous Person', false, '', false, '', null, '', -1, 'en', { type: 'drawn', style: 3, width: 600, height: 180, strokes: [[[1, 2], [3, 4]]] }]);
    fixture.render(); fixture.runEffects();
    assert.equal(pending.length, 1);
    account = 'another-person'; token = 'token-two'; browser.dispatch('auth:changed');
    assert.equal(fixture.state(0), null);
    assert.equal(fixture.state(3), '', 'another account must not inherit the previous signer name');
    assert.equal(fixture.state(12).type, 'typed');
    assert.equal(fixture.state(12).style, 1);
    assert.equal(fixture.state(12).strokes.length, 0, 'another account must not inherit a previous drawing');
    assert.equal(pending.length, 2);
    pending[0](readyContext); await Promise.resolve(); await Promise.resolve();
    assert.equal(fixture.state(0), null, 'previous account document cannot reappear');
    pending[1]({ ...readyContext, contract: { id: 'other' }, role: 'booster' }); await Promise.resolve(); await Promise.resolve();
    assert.equal(fixture.state(0).contract.id, 'other');
    fixture.cleanup();
});
