const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { serialize, deserialize } = require('node:v8');

const copy = value => deserialize(serialize(value));
const matches = (record, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(condition => matches(record, condition));
    if (key === 'OR') return value.some(condition => matches(record, condition));
    if (key === 'NOT') return !matches(record, value);
    if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
        if ('equals' in value) return value.mode === 'insensitive'
            ? String(record[key]).toLowerCase() === String(value.equals).toLowerCase() : record[key] === value.equals;
        if ('in' in value) return value.in.includes(record[key]);
        if ('not' in value) return record[key] !== value.not;
        if ('lt' in value) return record[key] < value.lt;
        // Prisma compound unique indexes are represented as nested fields.
        if (key.includes('_')) return matches(record, value);
    }
    return value === null ? record[key] == null : record[key] === value;
});

function database() {
    let state = {
        contracts: new Map(), signatures: new Map(), notifications: new Map(), profiles: new Map(), emails: new Map(), audits: new Map(),
        users: new Map([
            ['owner', { id: 'owner', role: 'ADMIN', isOwner: true, email: 'owner@example.test', username: 'Owner', suspendedAt: null }],
            ['booster', { id: 'booster', role: 'PROVIDER', email: 'booster@example.test', username: 'Booster', suspendedAt: null }],
            ['other', { id: 'other', role: 'ADMIN', email: 'other@example.test', username: 'Other', suspendedAt: null }],
        ]),
    };
    const rows = (name, where) => [...state[name].values()].filter(row => matches(row, where));
    const hydrate = row => row ? { ...copy(row), nativeSignatures: copy(rows('signatures', { contractId: row.id })) } : null;
    let pending = Promise.resolve();
    const db = {
        emailFailureEvent: null,
        state: () => state,
        $queryRawUnsafe: async () => [],
        user: {
            findUnique: async ({ where }) => copy(rows('users', where)[0] || null),
            findFirst: async ({ where }) => copy(rows('users', where)[0] || null),
            findMany: async ({ where } = {}) => copy(rows('users', where)),
        },
        boosterContract: {
            findUnique: async ({ where }) => hydrate(rows('contracts', where)[0]),
            findFirst: async ({ where }) => hydrate(rows('contracts', where)[0]),
            create: async ({ data }) => {
                if (state.contracts.has(data.id)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
                const row = { createdAt: new Date(), signedAt: null, companySignedAt: null, boosterSignedAt: null, revokedAt: null, ...copy(data) };
                state.contracts.set(row.id, row);
                return hydrate(row);
            },
            upsert: async ({ where, create, update = {} }) => {
                const row = rows('contracts', where)[0];
                if (!row) return db.boosterContract.create({ data: create });
                Object.assign(row, copy(update));
                return hydrate(row);
            },
            update: async ({ where, data }) => {
                const row = rows('contracts', where)[0];
                assert.ok(row, 'updated contract exists');
                Object.assign(row, copy(data));
                return hydrate(row);
            },
            updateMany: async ({ where, data }) => {
                const changed = rows('contracts', where);
                changed.forEach(row => Object.assign(row, copy(data)));
                return { count: changed.length };
            },
        },
        nativeContractSignature: {
            findUnique: async ({ where }) => copy(rows('signatures', where)[0] || null),
            findFirst: async ({ where }) => copy(rows('signatures', where)[0] || null),
            findMany: async ({ where }) => copy(rows('signatures', where)),
            create: async ({ data }) => {
                if (rows('signatures', { contractId: data.contractId }).some(row => row.role === data.role || row.requestId === data.requestId)) {
                    throw Object.assign(new Error('duplicate signature'), { code: 'P2002' });
                }
                const row = { id: randomUUID(), ...copy(data) };
                state.signatures.set(row.id, row);
                return copy(row);
            },
        },
        managementAuditLog: {
            create: async ({ data }) => {
                const row = { id: randomUUID(), ...copy(data) };
                state.audits.set(row.id, row);
                return copy(row);
            },
        },
        notification: {
            upsert: async ({ where, create, update }) => {
                const existing = state.notifications.get(where.id);
                state.notifications.set(where.id, existing ? { ...existing, ...copy(update) } : copy(create));
            },
            updateMany: async ({ where, data }) => {
                const changed = rows('notifications', where);
                changed.forEach(row => Object.assign(row, copy(data)));
                return { count: changed.length };
            },
        },
        nativeContractEmail: {
            createMany: async ({ skipDuplicates, data }) => {
                assert.equal(skipDuplicates, true);
                if (data[0]?.event === db.emailFailureEvent) throw new Error('synthetic email outbox failure');
                for (const row of data) {
                    if (!state.emails.has(row.id)) state.emails.set(row.id, copy(row));
                }
                return { count: data.length };
            },
        },
        boosterProfile: {
            upsert: async ({ where, create, update }) => {
                const current = state.profiles.get(where.userId);
                state.profiles.set(where.userId, current ? { ...current, ...copy(update) } : copy(create));
            },
            updateMany: async ({ where, data }) => {
                const changed = rows('profiles', where);
                changed.forEach(row => Object.assign(row, copy(data)));
                return { count: changed.length };
            },
        },
    };
    db.$transaction = async fn => {
        const before = pending;
        let release;
        pending = new Promise(resolve => { release = resolve; });
        await before;
        const saved = copy(state);
        try { return await fn(db); }
        catch (error) { state = saved; throw error; }
        finally { release(); }
    };
    return db;
}

const currentCommercialValues = { WorkLocation: 'Vietnam', PayeeLegalName: 'Test Booster', ReferenceLanguage: 'English/Vietnamese' };
const fixedPaymentValues = { WorkLocation: 'Vietnam', ReferenceLanguage: 'English/Vietnamese' };

function agreementStub() {
    const flags = { failPdf: false, pdfCalls: [] };
    let version = 'FB-BSA-2.1';
    let fields = [{ key: 'PaymentMethod', label: 'Payment method', maxLength: 100, required: true, defaultValue: '' }];
    return {
        flags,
        get VERSION() { return version; },
        set VERSION(next) {
            version = next;
            if (['FB-BSA-2.3', 'FB-BSA-2.4'].includes(next)) fields = Object.keys(next === 'FB-BSA-2.4' ? fixedPaymentValues : currentCommercialValues).map(key => ({
                key, label: key, maxLength: 100, required: true, defaultValue: key === 'ReferenceLanguage' ? 'English/Vietnamese' : '',
            }));
        },
        setFields(next) { fields = copy(next); },
        commercialFields: () => copy(fields),
        assertAssets: () => {},
        validateValues: values => {
            if (!values || Object.keys(values).some(key => !fields.some(field => field.key === key)) || fields.some(field =>
                typeof values[field.key] !== 'string' || !values[field.key].trim() || values[field.key].length > field.maxLength)) {
                throw Object.assign(new Error('Complete the agreement details.'), { status: 400 });
            }
            return Object.fromEntries(fields.map(field => [field.key, values[field.key].trim()]));
        },
        createSnapshot: (contract, values = {}) => ({
            version, htmlSource: `<p>Frozen agreement ${version}</p>`, documentBase64: Buffer.from(`%PDF-base-${version}`).toString('base64'), fields: [],
            values: { ...Object.fromEntries(fields.map(field => [field.key, values[field.key] ?? field.defaultValue])),
                AgreementId: contract.id, ProviderLegalName: contract.signerName, ProviderEmail: contract.signerEmail,
                ProviderUsername: contract.providerUsername, EffectiveDate: new Date(contract.startsAt).toISOString().slice(0, 10) },
            company: { name: contract.companySignerName, email: contract.companySignerEmail }, booster: { name: contract.signerName, email: contract.signerEmail },
        }),
        snapshotHash: snapshot => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
        renderHtml: (snapshot, signatures = []) => `<article>${snapshot.htmlSource}<p>${snapshot.values.PaymentMethod || ''}</p><p>${signatures.map(row => row.legalName).join(', ')}</p></article>`,
        renderPdf: async (snapshot, signatures = [], options = {}) => {
            flags.pdfCalls.push(copy({ snapshot, signatures, options }));
            if (flags.failPdf) throw new Error('PDF storage unavailable');
            return Buffer.from(`%PDF-${options.completed ? 'completed' : 'prepared'}-${JSON.stringify(snapshot.values)}-${signatures.map(row => row.role).join(',')}`);
        },
    };
}

async function fixture(t) {
    const agreementPath = require.resolve('../src/utils/nativeAgreement');
    const signingPath = require.resolve('../src/utils/nativeContractSigning');
    const savedModules = [agreementPath, signingPath].map(path => [path, require.cache[path]]);
    const names = ['JWT_SECRET', 'DOCUSIGN_COMPANY_SIGNER_NAME', 'DOCUSIGN_COMPANY_SIGNER_EMAIL'];
    const savedEnv = names.map(name => [name, process.env[name]]);
    Object.assign(process.env, { JWT_SECRET: 'native-contract-unit-secret', DOCUSIGN_COMPANY_SIGNER_NAME: 'Test Owner', DOCUSIGN_COMPANY_SIGNER_EMAIL: 'owner@example.test' });
    const agreement = agreementStub();
    require.cache[agreementPath] = { exports: agreement };
    delete require.cache[signingPath];
    const service = require(signingPath);
    const db = database();
    const actor = id => copy(db.state().users.get(id));
    const issue = async (extra = {}) => {
        const input = { requestId: randomUUID(), boosterId: 'booster', issuedById: 'owner', signerName: 'Test Booster', startsAt: '2026-10-01', ...extra };
        await service.createContract(db, input);
        return db.boosterContract.findUnique({ where: { id: input.requestId } });
    };
    const context = async (contractId, user = 'owner') => service.signingContext(db, await db.boosterContract.findUnique({ where: { id: contractId } }), actor(user));
    const prepare = async (contractId, values = agreement.VERSION === 'FB-BSA-2.4' ? fixedPaymentValues : agreement.VERSION === 'FB-BSA-2.3' ? currentCommercialValues : { PaymentMethod: 'Manual transfer' }) => {
        await service.prepareContract(db, contractId, actor('owner'), values);
        return context(contractId);
    };
    const body = (ctx, extra = {}) => ({ requestId: randomUUID(), documentHash: ctx.documentHash, challenge: ctx.challenge,
        legalName: ctx.role === 'company' ? 'Test Owner' : 'Test Booster', initials: ctx.role === 'company' ? 'TO' : 'TB', consent: true, signature: { type: 'typed' }, ...extra });
    const sign = (contractId, user, payload) => service.signContract(db, contractId, actor(user), payload, { ip: '192.0.2.12', userAgent: 'FastBoost test browser' });
    t.after(() => {
        for (const [name, value] of savedEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
        for (const [path, entry] of savedModules) { if (entry) require.cache[path] = entry; else delete require.cache[path]; }
    });
    return { service, agreement, db, actor, issue, context, prepare, body, sign };
}

test('native contracts snapshot saved identities and keep private signing evidence off ordinary responses', async t => {
    const f = await fixture(t);
    const c = await f.issue({ providerUsername: 'Injected identity' });
    assert.equal(c.signingProvider, 'FASTBOOST');
    assert.equal(c.templateId, 'FB-BSA-2.1');
    assert.equal(c.nativeCompanySignerId, 'owner');
    assert.equal(c.signerEmail, 'booster@example.test');
    assert.equal(c.nativeSnapshot.values.ProviderUsername, 'Booster');
    assert.ok(c.nativeDocumentHash == null, 'an unprepared agreement has no accepted document hash');
    assert.equal(f.db.state().notifications.get(`contract-${c.id}`).title, 'Awaiting FastBoost agreement details');
    assert.equal(f.db.state().notifications.get(`contract-company-${c.id}`).title, 'Complete the agreement details');
    assert.deepEqual([...f.db.state().emails.keys()], [`${c.id}:ISSUED:BOOSTER`]);
    await f.service.createContract(f.db, { requestId: c.id, boosterId: 'booster', issuedById: 'owner',
        signerName: 'Test Booster', startsAt: '2026-10-01' });
    assert.deepEqual([...f.db.state().emails.keys()], [`${c.id}:ISSUED:BOOSTER`], 'retrying issuance does not queue a second email');
    const publicValue = f.service.publicContract({ ...c, nativePdf: Buffer.from('private bytes'), nativePdfHash: 'a'.repeat(64), nativeDocumentHash: 'b'.repeat(64), nativeSignatures: [{ clientIp: '192.0.2.12', userAgent: 'private browser', requestHash: 'c'.repeat(64) }] });
    const encoded = JSON.stringify(publicValue);
    for (const secret of ['private bytes', 'htmlSource', 'documentBase64', '192.0.2.12', 'private browser', 'requestHash']) assert.ok(!encoded.includes(secret), secret);
    assert.equal(publicValue.id, c.id);
    assert.equal(f.db.state().signatures.size, 0);
    assert.equal(f.db.state().profiles.size, 0);
});

test('assigned FastBoost signer prepares the unsigned draft; version 2.1 still signs company-first', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    await assert.rejects(f.context(c.id, 'other'), error => [403, 404].includes(error.status));
    const providerDraft = await f.context(c.id, 'booster');
    assert.equal(providerDraft.prepared, false);
    assert.equal(providerDraft.canPrepare, false);
    assert.equal(providerDraft.canSign, false);
    assert.equal(providerDraft.fields.length, 1);
    assert.equal((await f.context(c.id)).canPrepare, true);
    await assert.rejects(f.service.prepareContract(f.db, c.id, f.actor('booster'), { PaymentMethod: 'Transfer' }), error => [403, 404].includes(error.status));
    await assert.rejects(f.service.prepareContract(f.db, c.id, f.actor('other'), { PaymentMethod: 'Transfer' }), error => [403, 404].includes(error.status));
    const ctx = await f.prepare(c.id);
    const providerReview = await f.context(c.id, 'booster');
    assert.equal(providerReview.canPrepare, false);
    assert.equal(providerReview.canSign, false, 'submitting details does not sign the contract');
    assert.equal(providerReview.challenge, null);
    assert.equal(ctx.canPrepare, true, 'FastBoost can correct submitted details until the first signature');
    assert.equal(f.db.state().notifications.get(`contract-company-${c.id}`).title, 'Agreement ready for your signature');
    assert.equal(f.db.state().notifications.get(`contract-${c.id}`).title, 'Awaiting FastBoost signature');
    const jwt = require('jsonwebtoken');
    const forbiddenBoosterChallenge = jwt.sign({ purpose: 'fastboost-contract-signature-v1', contractId: c.id,
        actorId: 'booster', role: 'BOOSTER', documentHash: providerReview.documentHash,
        pdfHash: f.db.state().contracts.get(c.id).nativePdfHash, consentVersion: f.agreement.VERSION }, process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m', issuer: 'FastBoost', audience: 'contract-signing' });
    await assert.rejects(f.sign(c.id, 'booster', f.body(providerReview, { challenge: forbiddenBoosterChallenge })), error => error.status === 409);
    assert.equal(f.db.state().signatures.size, 0);
    f.db.state().users.get('owner').suspendedAt = new Date();
    await assert.rejects(f.sign(c.id, 'owner', f.body(ctx)), error => [403, 404].includes(error.status));
    f.db.state().users.get('owner').suspendedAt = null;
    f.db.state().users.get('owner').role = 'CUSTOMER';
    await assert.rejects(f.service.signContract(f.db, c.id, { ...f.actor('owner'), role: 'ADMIN' }, f.body(ctx)), error => [403, 404].includes(error.status));
    assert.equal(f.db.state().signatures.size, 0);
});

test('preparation requires complete commercial values and stale prepared hashes cannot be signed', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    await assert.rejects(f.prepare(c.id, {}), error => error.status === 400);
    await assert.rejects(f.prepare(c.id, { PaymentMethod: 'Transfer', ProviderEmail: 'attacker@example.test' }), error => error.status === 400);
    const first = await f.prepare(c.id, { PaymentMethod: 'First transfer' });
    const firstPayload = f.body(first);
    const second = await f.prepare(c.id, { PaymentMethod: 'Updated transfer' });
    assert.notEqual(second.documentHash, first.documentHash);
    await assert.rejects(f.sign(c.id, 'owner', firstPayload), error => error.status === 409);
    assert.equal(f.db.state().signatures.size, 0);
    assert.match(second.html, /Updated transfer/);
    assert.doesNotMatch(second.html, /First transfer/);
});

test('an unsigned 2.1 agreement previews 2.2 without mutation and requires owner re-preparation', async t => {
    const f = await fixture(t);
    f.agreement.setFields([
        { key: 'PaymentMethod', label: 'Payment method', maxLength: 100, required: true, defaultValue: '' },
        { key: 'ServiceScope', label: 'Old service scope', maxLength: 180, required: true, defaultValue: '' },
        { key: 'AuthorizedSignatory', label: 'Old business signatory', maxLength: 100, required: true, defaultValue: 'Not applicable' },
        { key: 'DataAccessCountries', label: 'Old data-access countries', maxLength: 120, required: true, defaultValue: '' },
    ]);
    const c = await f.issue();
    const old = await f.prepare(c.id, { PaymentMethod: 'First transfer', ServiceScope: 'Old scope',
        AuthorizedSignatory: 'Not applicable', DataAccessCountries: 'Canada' });
    const oldPayload = f.body(old);
    const storedBefore = copy(f.db.state());
    f.agreement.VERSION = 'FB-BSA-2.2';
    f.agreement.setFields([{ key: 'PaymentMethod', label: 'Payment method', maxLength: 100, required: true, defaultValue: '' }]);

    const providerDraft = await f.context(c.id, 'booster');
    const ownerDraft = await f.context(c.id);
    assert.deepEqual(f.db.state(), storedBefore, 'previewing the new version does not mutate saved contract evidence');
    assert.equal(providerDraft.documentVersion, 'FB-BSA-2.2');
    assert.equal(providerDraft.prepared, false);
    assert.equal(providerDraft.canPrepare, false);
    assert.equal(providerDraft.canSign, false);
    assert.equal(providerDraft.documentHash, null);
    assert.deepEqual(providerDraft.fields.map(field => field.key), ['PaymentMethod']);
    assert.equal('ServiceScope' in providerDraft.values, false);
    assert.equal('AuthorizedSignatory' in providerDraft.values, false);
    assert.equal('DataAccessCountries' in providerDraft.values, false);
    assert.match(providerDraft.html, /FB-BSA-2\.2/);
    assert.equal(ownerDraft.canSign, false);
    assert.equal(ownerDraft.canPrepare, true);
    assert.equal(ownerDraft.challenge, null);
    assert.equal(ownerDraft.contract.documentAvailable, false);
    assert.throws(() => f.service.document(f.db.state().contracts.get(c.id)), error => error.status === 409);
    await assert.rejects(f.sign(c.id, 'owner', oldPayload), error => error.status === 409);

    await f.service.prepareContract(f.db, c.id, f.actor('owner'), { PaymentMethod: 'Current transfer' });
    const upgraded = await f.context(c.id);
    assert.equal(upgraded.documentVersion, 'FB-BSA-2.2');
    assert.equal(upgraded.prepared, true);
    assert.equal(upgraded.canSign, false, 'FastBoost waits for the provider to sign version 2.2');
    const providerUpgraded = await f.context(c.id, 'booster');
    assert.equal(providerUpgraded.canSign, true);
    assert.equal(providerUpgraded.signingOrder, 'BOOSTER_FIRST');
    assert.equal(upgraded.contract.documentAvailable, true);
    assert.match(upgraded.html, /Current transfer/);
    assert.equal(f.db.state().contracts.get(c.id).templateId, 'FB-BSA-2.2');
    assert.equal('ServiceScope' in f.db.state().contracts.get(c.id).nativeSnapshot.values, false);
    assert.equal('AuthorizedSignatory' in f.db.state().contracts.get(c.id).nativeSnapshot.values, false);
    assert.equal('DataAccessCountries' in f.db.state().contracts.get(c.id).nativeSnapshot.values, false);
    assert.notEqual(upgraded.documentHash, old.documentHash);
});

test('a provider can complete a company-signed 2.1 agreement after 2.3 becomes current', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const company = await f.prepare(c.id);
    await f.sign(c.id, 'owner', f.body(company));
    f.agreement.VERSION = 'FB-BSA-2.3';
    const booster = await f.context(c.id, 'booster');
    assert.equal(booster.documentVersion, 'FB-BSA-2.1');
    assert.equal(booster.contract.signingOrder, 'COMPANY_FIRST');
    assert.equal(booster.canSign, true);
    assert.equal(booster.canPrepare, false);
    assert.match(booster.html, /FB-BSA-2\.1/);
    assert.equal(require('jsonwebtoken').decode(booster.challenge).consentVersion, 'FB-BSA-2.1');
    await f.sign(c.id, 'booster', f.body(booster));
    const saved = f.db.state().contracts.get(c.id);
    assert.equal(saved.nativeSnapshot.version, 'FB-BSA-2.1');
    assert.equal(saved.templateId, 'FB-BSA-2.1');
    assert.ok(saved.signedAt);
    assert.deepEqual([...f.db.state().emails.keys()].sort(), [
        `${c.id}:COMPLETED:BOOSTER`, `${c.id}:COMPLETED:COMPANY`, `${c.id}:ISSUED:BOOSTER`,
    ], 'historical company-first completion queues only the final copies');
});

test('version 2.2 has owner preparation, provider signature, then FastBoost countersignature', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.2';
    const c = await f.issue();
    const providerDraft = await f.context(c.id, 'booster');
    assert.equal(providerDraft.signingOrder, 'BOOSTER_FIRST');
    assert.equal(providerDraft.canPrepare, false);
    assert.equal(providerDraft.canSign, false);
    assert.equal((await f.context(c.id)).canSign, false);
    assert.equal((await f.context(c.id)).canPrepare, true);
    await assert.rejects(f.service.prepareContract(f.db, c.id, f.actor('booster'), { PaymentMethod: 'Bank transfer' }), error => error.status === 403);
    await f.prepare(c.id, { PaymentMethod: 'Bank transfer' });
    const provider = await f.context(c.id, 'booster');
    const ownerBefore = await f.context(c.id);
    assert.equal(provider.canSign, true);
    assert.equal(provider.canPrepare, false);
    assert.equal(ownerBefore.canSign, false);
    assert.equal(ownerBefore.canPrepare, true);
    assert.ok(f.db.state().emails.has(`${c.id}:READY:BOOSTER`));
    assert.equal(require('jsonwebtoken').decode(provider.challenge).consentVersion, 'FB-BSA-2.2');
    const fakeOwnerChallenge = require('jsonwebtoken').sign({ purpose: 'fastboost-contract-signature-v1', contractId: c.id,
        actorId: 'owner', role: 'COMPANY', documentHash: ownerBefore.documentHash,
        pdfHash: f.db.state().contracts.get(c.id).nativePdfHash, consentVersion: f.agreement.VERSION }, process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m', issuer: 'FastBoost', audience: 'contract-signing' });
    await assert.rejects(f.sign(c.id, 'owner', f.body(ownerBefore, { challenge: fakeOwnerChallenge })), error => error.status === 409);

    const providerPayload = f.body(provider);
    await f.sign(c.id, 'booster', providerPayload);
    await f.sign(c.id, 'booster', providerPayload);
    assert.equal(f.db.state().audits.size, 1, 'one provider signature creates one critical activity record');
    assert.deepEqual([...f.db.state().audits.values()].map(row => [row.action, row.actorName]), [['contract.sign', 'Booster']]);
    const partlySigned = f.db.state().contracts.get(c.id);
    assert.ok(partlySigned.boosterSignedAt);
    assert.equal(partlySigned.companySignedAt, null);
    assert.equal(partlySigned.signedAt, null);
    assert.equal(f.db.state().profiles.size, 0);
    assert.equal(f.db.state().notifications.get(`contract-company-${c.id}`).title, 'Agreement ready for your signature');
    assert.equal(f.db.state().notifications.get(`contract-${c.id}`).title, 'Awaiting FastBoost signature');
    assert.deepEqual([...f.db.state().emails.keys()].sort(), [
        `${c.id}:BOOSTER_SIGNED:COMPANY`, `${c.id}:ISSUED:BOOSTER`, `${c.id}:READY:BOOSTER`,
    ], 'a provider signature retry does not queue a second owner alert');
    await assert.rejects(f.prepare(c.id, { PaymentMethod: 'Changed after first signature' }), error => error.status === 409);
    const owner = await f.context(c.id);
    assert.equal(owner.canSign, true);
    assert.equal((await f.context(c.id, 'booster')).canSign, false);
    const ownerPayload = f.body(owner);
    await f.sign(c.id, 'owner', ownerPayload);
    await f.sign(c.id, 'owner', ownerPayload);
    const completed = f.db.state().contracts.get(c.id);
    assert.ok(completed.companySignedAt && completed.signedAt && completed.nativeCompletedAt);
    assert.equal(completed.signedName, 'Test Booster', 'the contract keeps the provider name when the owner signs last');
    assert.equal(f.db.state().profiles.size, 1);
    assert.match(completed.nativePdf.toString(), /^%PDF-completed-/);
    assert.equal(f.db.state().signatures.size, 2);
    assert.equal(f.db.state().notifications.get(`contract-${c.id}`).read, true);
    assert.equal(f.db.state().notifications.get(`contract-company-${c.id}`).read, true);
    assert.deepEqual([...f.db.state().emails.keys()].sort(), [
        `${c.id}:BOOSTER_SIGNED:COMPANY`, `${c.id}:COMPLETED:BOOSTER`, `${c.id}:COMPLETED:COMPANY`,
        `${c.id}:ISSUED:BOOSTER`, `${c.id}:READY:BOOSTER`,
    ], 'the final signature queues one completed copy per signer');
});

test('version 2.3 is finalized and signed by FastBoost before the read-only provider signature', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.3';
    const c = await f.issue({ startsAt: '2026-11-01' });
    const providerDraft = await f.context(c.id, 'booster');
    assert.equal(providerDraft.signingOrder, 'COMPANY_FIRST');
    assert.equal(providerDraft.contract.signingOrder, 'COMPANY_FIRST');
    assert.deepEqual(providerDraft.fields.map(field => field.key), ['WorkLocation', 'PayeeLegalName', 'ReferenceLanguage']);
    assert.equal(providerDraft.canPrepare, false);
    assert.equal(providerDraft.canSign, false);
    await assert.rejects(f.service.prepareContract(f.db, c.id, f.actor('booster'), currentCommercialValues), error => error.status === 403);

    const owner = await f.prepare(c.id, currentCommercialValues);
    assert.equal(owner.canSign, true);
    assert.equal(owner.canPrepare, true);
    assert.equal(owner.values.EffectiveDate, '2026-11-01');
    assert.equal((await f.context(c.id, 'booster')).canSign, false);
    assert.equal((await f.context(c.id, 'booster')).challenge, null);
    const prematureProvider = await f.context(c.id, 'booster');
    const prematureChallenge = require('jsonwebtoken').sign({ purpose: 'fastboost-contract-signature-v1', contractId: c.id,
        actorId: 'booster', role: 'BOOSTER', documentHash: owner.documentHash,
        pdfHash: f.db.state().contracts.get(c.id).nativePdfHash, consentVersion: 'FB-BSA-2.3' }, process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m', issuer: 'FastBoost', audience: 'contract-signing' });
    await assert.rejects(f.sign(c.id, 'booster', f.body(prematureProvider, { challenge: prematureChallenge })),
        error => error.status === 409 && /FastBoost must sign/.test(error.message));
    assert.equal(f.db.state().emails.has(`${c.id}:READY:BOOSTER`), false, 'preparation alone does not invite the provider to sign');
    const frozenSnapshot = copy(f.db.state().contracts.get(c.id).nativeSnapshot);
    const ownerPayload = f.body(owner);
    await f.sign(c.id, 'owner', ownerPayload);
    await f.sign(c.id, 'owner', ownerPayload);
    assert.equal(f.db.state().signatures.size, 1);
    assert.equal(f.db.state().profiles.size, 0);
    assert.ok(f.db.state().emails.has(`${c.id}:COMPANY_SIGNED:BOOSTER`));
    assert.equal(f.db.state().notifications.get(`contract-company-${c.id}`).title, 'Awaiting provider signature');
    assert.equal(f.db.state().notifications.get(`contract-${c.id}`).title, 'Contract ready to sign');
    assert.equal((await f.context(c.id)).canPrepare, false);
    await assert.rejects(f.prepare(c.id, { ...currentCommercialValues, PayeeLegalName: 'Changed payee' }), error => error.status === 409);
    const provider = await f.context(c.id, 'booster');
    assert.equal(provider.canPrepare, false);
    assert.equal(provider.canSign, true);
    assert.equal(provider.documentHash, owner.documentHash);
    assert.equal(require('jsonwebtoken').decode(provider.challenge).consentVersion, 'FB-BSA-2.3');
    await assert.rejects(f.service.prepareContract(f.db, c.id, f.actor('booster'), { ...currentCommercialValues, PayeeLegalName: 'Changed payee' }), error => error.status === 403);
    const providerPayload = f.body(provider);
    await f.sign(c.id, 'booster', providerPayload);
    await f.sign(c.id, 'booster', providerPayload);
    const completed = f.db.state().contracts.get(c.id);
    assert.deepEqual(completed.nativeSnapshot, frozenSnapshot);
    assert.equal(completed.signedName, 'Test Booster');
    assert.ok(completed.signedAt && completed.nativeCompletedAt && completed.companySignedAt && completed.boosterSignedAt);
    assert.equal(f.db.state().signatures.size, 2);
    assert.equal(f.db.state().profiles.size, 1);
    assert.deepEqual([...f.db.state().emails.keys()].sort(), [
        `${c.id}:COMPANY_SIGNED:BOOSTER`, `${c.id}:COMPLETED:BOOSTER`, `${c.id}:COMPLETED:COMPANY`, `${c.id}:ISSUED:BOOSTER`,
    ]);
});

test('version 2.4 prepares without a payee entry and retains company-first signing and invitations', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.4';
    const c = await f.issue();
    const owner = await f.prepare(c.id);
    assert.deepEqual(owner.fields.map(field => field.key), ['WorkLocation', 'ReferenceLanguage']);
    assert.equal('PayeeLegalName' in owner.values, false);
    assert.equal(owner.canSign, true);
    assert.equal(owner.signingOrder, 'COMPANY_FIRST');
    assert.equal((await f.context(c.id, 'booster')).canSign, false);
    await f.sign(c.id, 'owner', f.body(owner));
    assert.ok(f.db.state().emails.has(`${c.id}:COMPANY_SIGNED:BOOSTER`));
    const provider = await f.context(c.id, 'booster');
    assert.equal(provider.canSign, true);
    assert.equal(provider.canPrepare, false);
    assert.equal(require('jsonwebtoken').decode(provider.challenge).consentVersion, 'FB-BSA-2.4');
    await f.sign(c.id, 'booster', f.body(provider));
    assert.ok(f.db.state().contracts.get(c.id).signedAt);
    assert.equal(f.db.state().signatures.size, 2);
    assert.ok(f.db.state().emails.has(`${c.id}:COMPLETED:BOOSTER`));
    assert.ok(f.db.state().emails.has(`${c.id}:COMPLETED:COMPANY`));
});

test('unsigned 2.3 drafts upgrade to 2.4 without carrying the payee field or a stale challenge', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.3';
    const c = await f.issue();
    const oldOwner = await f.prepare(c.id);
    const before = copy(f.db.state());
    f.agreement.VERSION = 'FB-BSA-2.4';
    const preview = await f.context(c.id);
    assert.deepEqual(f.db.state(), before, 'preview never changes saved evidence');
    assert.equal(preview.documentVersion, 'FB-BSA-2.4');
    assert.equal(preview.prepared, false);
    assert.equal(preview.canSign, false);
    assert.equal(preview.signingOrder, 'COMPANY_FIRST');
    assert.equal('PayeeLegalName' in preview.values, false);
    assert.deepEqual(preview.fields.map(field => field.key), ['WorkLocation', 'ReferenceLanguage']);
    assert.equal(preview.values.WorkLocation, currentCommercialValues.WorkLocation);
    await assert.rejects(f.sign(c.id, 'owner', f.body(oldOwner)), error => error.status === 409 && /version changed/.test(error.message));
    const owner = await f.prepare(c.id);
    assert.equal(owner.documentVersion, 'FB-BSA-2.4');
    assert.equal(owner.canSign, true);
    assert.equal(owner.values.ProviderLegalName, oldOwner.values.ProviderLegalName);
    assert.equal(owner.values.EffectiveDate, oldOwner.values.EffectiveDate);
    assert.equal('PayeeLegalName' in f.db.state().contracts.get(c.id).nativeSnapshot.values, false);
    assert.notEqual(owner.documentHash, oldOwner.documentHash);
});

test('company-signed 2.3 agreements retain their accepted payee, document and provider countersignature after 2.4 launches', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.3';
    const c = await f.issue();
    const owner = await f.prepare(c.id);
    await f.sign(c.id, 'owner', f.body(owner));
    const frozen = copy(f.db.state().contracts.get(c.id));
    f.agreement.VERSION = 'FB-BSA-2.4';
    const provider = await f.context(c.id, 'booster');
    assert.equal(provider.documentVersion, 'FB-BSA-2.3');
    assert.equal(provider.signingOrder, 'COMPANY_FIRST');
    assert.equal(provider.values.PayeeLegalName, currentCommercialValues.PayeeLegalName);
    assert.equal(provider.documentHash, frozen.nativeDocumentHash);
    assert.equal(provider.canSign, true);
    assert.equal(provider.canPrepare, false);
    assert.deepEqual(f.service.document(f.db.state().contracts.get(c.id)), frozen.nativePdf);
    await assert.rejects(f.prepare(c.id), error => error.status === 409);
    await f.sign(c.id, 'booster', f.body(provider));
    const completed = f.db.state().contracts.get(c.id);
    assert.deepEqual(completed.nativeSnapshot, frozen.nativeSnapshot);
    assert.equal(completed.nativeDocumentHash, frozen.nativeDocumentHash);
    assert.equal(completed.templateId, 'FB-BSA-2.3');
    assert.ok(completed.signedAt);
});

test('unsigned 2.2 drafts upgrade to company-first 2.3 and reject an outstanding provider challenge', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.2';
    const c = await f.issue();
    await f.prepare(c.id);
    const oldProvider = await f.context(c.id, 'booster');
    const oldPayload = f.body(oldProvider);
    assert.equal(oldProvider.canSign, true);
    const before = copy(f.db.state());
    f.agreement.VERSION = 'FB-BSA-2.3';
    const preview = await f.context(c.id, 'booster');
    assert.deepEqual(f.db.state(), before, 'preview cannot rewrite evidence');
    assert.equal(preview.signingOrder, 'COMPANY_FIRST');
    assert.equal(preview.contract.signingOrder, 'COMPANY_FIRST');
    assert.equal(f.service.publicContract(f.db.state().contracts.get(c.id)).signingOrder, 'COMPANY_FIRST');
    assert.equal(preview.prepared, false);
    assert.equal(preview.canSign, false);
    assert.equal(preview.documentVersion, 'FB-BSA-2.3');
    await assert.rejects(f.sign(c.id, 'booster', oldPayload), error => error.status === 409 && /version changed/.test(error.message));
    const owner = await f.prepare(c.id, currentCommercialValues);
    assert.equal(owner.canSign, true);
    assert.equal(owner.documentVersion, 'FB-BSA-2.3');
    assert.equal(f.db.state().contracts.get(c.id).templateId, 'FB-BSA-2.3');
    assert.equal('PaymentMethod' in f.db.state().contracts.get(c.id).nativeSnapshot.values, false);
    assert.deepEqual(owner.fields.map(field => field.key), ['WorkLocation', 'PayeeLegalName', 'ReferenceLanguage']);
    assert.notEqual(owner.documentHash, oldProvider.documentHash);
    assert.equal((await f.context(c.id, 'booster')).canSign, false);
});

test('a provider-signed 2.2 agreement keeps its frozen terms and owner countersignature after 2.3 launches', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.2';
    const c = await f.issue();
    await f.prepare(c.id);
    await f.sign(c.id, 'booster', f.body(await f.context(c.id, 'booster')));
    const frozenSnapshot = copy(f.db.state().contracts.get(c.id).nativeSnapshot);
    f.agreement.VERSION = 'FB-BSA-2.3';
    const owner = await f.context(c.id);
    assert.equal(owner.documentVersion, 'FB-BSA-2.2');
    assert.equal(owner.signingOrder, 'BOOSTER_FIRST');
    assert.equal(owner.contract.signingOrder, 'BOOSTER_FIRST');
    assert.equal(owner.canPrepare, false);
    assert.equal(owner.canSign, true);
    await f.sign(c.id, 'owner', f.body(owner));
    const saved = f.db.state().contracts.get(c.id);
    assert.deepEqual(saved.nativeSnapshot, frozenSnapshot);
    assert.equal(saved.templateId, 'FB-BSA-2.2');
    assert.ok(saved.signedAt);
    assert.equal(f.db.state().emails.has(`${c.id}:COMPANY_SIGNED:BOOSTER`), false);
});

test('a failed 2.3 company-signed invitation enqueue rolls back the signature and retries safely', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.3';
    const c = await f.issue();
    const owner = await f.prepare(c.id, currentCommercialValues);
    const payload = f.body(owner);
    const before = copy(f.db.state());
    f.db.emailFailureEvent = 'COMPANY_SIGNED';
    await assert.rejects(f.sign(c.id, 'owner', payload), /synthetic email outbox failure/);
    assert.deepEqual(f.db.state(), before);
    f.db.emailFailureEvent = null;
    await f.sign(c.id, 'owner', payload);
    assert.equal(f.db.state().signatures.size, 1);
    assert.ok(f.db.state().emails.has(`${c.id}:COMPANY_SIGNED:BOOSTER`));
});

test('owner corrections replace the provider signing challenge without duplicate READY email', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.2';
    const c = await f.issue();
    await f.prepare(c.id, { PaymentMethod: 'First bank account' });
    const oldProvider = await f.context(c.id, 'booster');
    await f.prepare(c.id, { PaymentMethod: 'Correct bank account' });
    const provider = await f.context(c.id, 'booster');
    assert.notEqual(provider.documentHash, oldProvider.documentHash);
    assert.equal(f.db.state().emails.size, 2, 'ISSUED and READY each have one fixed outbox ID');
    await assert.rejects(f.sign(c.id, 'booster', f.body(oldProvider)), error => error.status === 409);
    assert.equal(f.db.state().signatures.size, 0);
    await f.sign(c.id, 'booster', f.body(provider));
    assert.equal(f.db.state().signatures.size, 1);
});

test('a failed email enqueue rolls back the first signature and can be retried', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.2';
    const c = await f.issue();
    await f.prepare(c.id);
    const provider = await f.context(c.id, 'booster');
    const payload = f.body(provider);
    const before = copy(f.db.state());
    f.db.emailFailureEvent = 'BOOSTER_SIGNED';
    await assert.rejects(f.sign(c.id, 'booster', payload), /synthetic email outbox failure/);
    assert.deepEqual(f.db.state(), before, 'the signature and PDF update roll back with the outbox insert');
    f.db.emailFailureEvent = null;
    await f.sign(c.id, 'booster', payload);
    assert.equal(f.db.state().signatures.size, 1);
    assert.ok(f.db.state().emails.has(`${c.id}:BOOSTER_SIGNED:COMPANY`));
});

test('consent, identity, signer-bound challenge and bounded drawing payloads are enforced', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const ctx = await f.prepare(c.id);
    for (const extra of [
        { consent: false }, { legalName: 'Another Person' }, { initials: '' }, { challenge: '' },
        { signature: { type: 'drawn', width: 600, height: 180, strokes: [[[0, 0], [601, 20]]] } },
        { signature: { type: 'drawn', width: 600, height: 180, strokes: [[[0, 0], [10, Infinity]]] } },
        { signature: { type: 'image', content: '<svg onload=alert(1)>' } },
    ]) {
        await assert.rejects(f.sign(c.id, 'owner', f.body(ctx, extra)), error => [400, 401, 403, 409].includes(error.status));
    }
    const jwt = require('jsonwebtoken');
    const claims = jwt.decode(ctx.challenge);
    const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 2 }, process.env.JWT_SECRET);
    await assert.rejects(f.sign(c.id, 'owner', f.body(ctx, { challenge: expired })), error => [401, 403, 409].includes(error.status));
    const otherContract = await f.issue();
    const otherCtx = await f.prepare(otherContract.id);
    await assert.rejects(f.sign(c.id, 'owner', f.body(ctx, { challenge: otherCtx.challenge })), error => [401, 403, 409].includes(error.status));
    assert.equal(f.db.state().signatures.size, 0);
});

test('company signature freezes the exact terms, records consent, and unlocks only the assigned booster', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const prepared = await f.prepare(c.id);
    const payload = f.body(prepared);
    await f.sign(c.id, 'owner', payload);
    const companyRecord = [...f.db.state().signatures.values()][0];
    assert.equal(companyRecord.role, 'COMPANY');
    assert.equal(companyRecord.actorId, 'owner');
    assert.equal(companyRecord.actorEmail, 'owner@example.test');
    assert.equal(companyRecord.documentHash, prepared.documentHash);
    assert.ok(companyRecord.signedAt instanceof Date);
    assert.ok(companyRecord.consentText.length > 20);
    assert.equal(companyRecord.clientIp, '192.0.2.12');
    const saved = f.db.state().contracts.get(c.id);
    assert.ok(saved.companySignedAt);
    assert.equal(saved.signedAt, null);
    assert.equal(f.db.state().profiles.size, 0);
    await assert.rejects(f.prepare(c.id, { PaymentMethod: 'Changed after signing' }), error => error.status === 409);
    const booster = await f.context(c.id, 'booster');
    assert.equal(booster.role, 'booster');
    assert.equal(booster.canSign, true);
    assert.equal(booster.canPrepare, false);
    assert.equal(booster.documentHash, prepared.documentHash);
    assert.match(booster.html, /Test Owner/);
    f.db.state().users.get('booster').role = 'CUSTOMER';
    f.db.state().users.get('booster').hasBoosterAccess = false;
    await assert.rejects(f.sign(c.id, 'booster', f.body(booster)), error => [403, 404].includes(error.status));
});

test('changed saved terms or PDF bytes fail closed before a signature can be recorded', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const prepared = await f.prepare(c.id);
    const saved = f.db.state().contracts.get(c.id);
    const originalSnapshot = copy(saved.nativeSnapshot);
    const originalPdf = Buffer.from(saved.nativePdf);
    saved.nativeSnapshot.values.PaymentMethod = 'Altered without a new review';
    await assert.rejects(f.context(c.id), error => error.status === 503);
    await assert.rejects(f.sign(c.id, 'owner', f.body(prepared)), error => error.status === 503);
    f.db.state().contracts.get(c.id).nativeSnapshot = originalSnapshot;
    f.db.state().contracts.get(c.id).nativePdf = Buffer.from('%PDF-replaced without matching its retained digest');
    await assert.rejects(f.context(c.id), error => error.status === 503);
    await assert.rejects(f.sign(c.id, 'owner', f.body(prepared)), error => error.status === 503);
    f.db.state().contracts.get(c.id).nativePdf = originalPdf;
    assert.equal((await f.context(c.id)).canSign, true);
    assert.equal(f.db.state().signatures.size, 0);
});

test('a valid drawn signature is retained as bounded vector data with its consent and document hash', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const prepared = await f.prepare(c.id);
    const signature = { type: 'drawn', width: 600, height: 180, strokes: [[[12, 80], [100, 40], [220, 110]], [[250, 95], [450, 60]]] };
    const payload = f.body(prepared, { signature });
    await f.service.signContract(f.db, c.id, f.actor('owner'), payload, { ip: 'x'.repeat(200), userAgent: 'y'.repeat(1000) });
    const record = [...f.db.state().signatures.values()][0];
    assert.deepEqual(record.signature, signature);
    assert.equal(record.documentHash, prepared.documentHash);
    assert.equal(record.clientIp.length, 128);
    assert.equal(record.userAgent.length, 500);
    const rendered = f.agreement.flags.pdfCalls.at(-1);
    assert.deepEqual(rendered.signatures[0].signature, signature);
    assert.equal(rendered.options.completed, false);
});

test('identical signature retries are idempotent and cannot replace signed evidence', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const prepared = await f.prepare(c.id);
    const payload = f.body(prepared);
    await f.sign(c.id, 'owner', payload);
    const evidence = copy([...f.db.state().signatures.values()][0]);
    const companySignedAt = f.db.state().contracts.get(c.id).companySignedAt;
    await f.sign(c.id, 'owner', payload);
    assert.equal(f.db.state().signatures.size, 1);
    assert.deepEqual([...f.db.state().signatures.values()][0], evidence);
    assert.deepEqual(f.db.state().contracts.get(c.id).companySignedAt, companySignedAt);
    await assert.rejects(f.sign(c.id, 'owner', { ...payload, initials: 'XX' }), error => error.status === 409);
    await assert.rejects(f.sign(c.id, 'owner', { ...payload, requestId: randomUUID() }), error => error.status === 409);
    assert.equal(f.db.state().signatures.size, 1);
});

test('two concurrent submits produce one authoritative signature and preserve the winning evidence', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const prepared = await f.prepare(c.id);
    const result = await Promise.allSettled([f.sign(c.id, 'owner', f.body(prepared)), f.sign(c.id, 'owner', f.body(prepared))]);
    assert.equal(result.filter(row => row.status === 'fulfilled').length, 1);
    const failure = result.find(row => row.status === 'rejected');
    assert.equal(failure.reason.status, 409);
    assert.equal(f.db.state().signatures.size, 1);
    assert.equal(f.db.state().profiles.size, 0);
});

test('final PDF failure rolls back the second signature and tenure; successful retry persists exact completed bytes', async t => {
    const f = await fixture(t);
    const c = await f.issue({ startsAt: '2099-01-01' });
    const company = await f.prepare(c.id);
    await f.sign(c.id, 'owner', f.body(company));
    const booster = await f.context(c.id, 'booster');
    const payload = f.body(booster);
    f.agreement.flags.failPdf = true;
    await assert.rejects(f.sign(c.id, 'booster', payload), /PDF storage unavailable/);
    assert.equal(f.db.state().signatures.size, 1);
    assert.equal(f.db.state().profiles.size, 0);
    assert.equal(f.db.state().contracts.get(c.id).boosterSignedAt, null);
    assert.equal(f.db.state().contracts.get(c.id).signedAt, null);
    f.agreement.flags.failPdf = false;
    await f.sign(c.id, 'booster', payload);
    const signed = f.db.state().contracts.get(c.id);
    assert.equal(signed.status, 'completed');
    assert.ok(signed.companySignedAt && signed.boosterSignedAt && signed.signedAt && signed.nativeCompletedAt);
    assert.equal(f.db.state().signatures.size, 2);
    assert.equal(Buffer.isBuffer(signed.nativePdf), true);
    assert.match(signed.nativePdf.toString(), /^%PDF-completed-/);
    assert.equal(signed.nativePdfHash, createHash('sha256').update(signed.nativePdf).digest('hex'));
    assert.equal(f.db.state().profiles.get('booster').startedAt.toISOString(), '2099-01-01T00:00:00.000Z');
    const finalBytes = Buffer.from(signed.nativePdf);
    assert.deepEqual(f.service.document(signed), finalBytes);
    await f.sign(c.id, 'booster', payload);
    assert.deepEqual(f.db.state().contracts.get(c.id).nativePdf, finalBytes);
});

test('completing a later agreement never changes established booster tenure', async t => {
    const f = await fixture(t);
    f.db.state().profiles.set('booster', { userId: 'booster', startedAt: new Date('2020-01-01') });
    const c = await f.issue();
    const company = await f.prepare(c.id);
    await f.sign(c.id, 'owner', f.body(company));
    const booster = await f.context(c.id, 'booster');
    await f.sign(c.id, 'booster', f.body(booster));
    assert.equal(f.db.state().profiles.get('booster').startedAt.toISOString(), '2020-01-01T00:00:00.000Z');
});

function legacyContract(f, extra = {}) {
    const contract = {
        id: randomUUID(), boosterId: 'booster', issuedById: 'other', title: 'Booster Service Agreement',
        signerName: 'Test Booster', signerEmail: 'booster@example.test', companySignerName: 'Test Owner', companySignerEmail: 'owner@example.test',
        startsAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), templateId: 'FB-BSA-2.0',
        signingProvider: 'DOCUSIGN', environment: 'demo', accountId: 'sandbox-account', envelopeId: 'sandbox-envelope', status: 'sent',
        signedAt: null, companySignedAt: null, boosterSignedAt: null, revokedAt: null, ...extra,
    };
    f.db.state().contracts.set(contract.id, copy(contract));
    return contract;
}

test('explicit replacement independently verifies an unsigned sandbox envelope and retains its original identity', async t => {
    const f = await fixture(t);
    const original = legacyContract(f);
    const replacementId = randomUUID();
    let checks = 0;
    const verify = async inspected => {
        checks++;
        assert.equal(inspected.envelopeId, original.envelopeId);
        assert.equal(inspected.environment, 'demo');
        return { status: 'delivered' };
    };
    const result = await f.service.replaceLegacyContract(f.db, original, f.actor('owner'), replacementId, verify);
    assert.equal(result.id, replacementId);
    assert.equal(result.replacesContractId, original.id);
    assert.equal(result.signingProvider, 'FASTBOOST');
    assert.equal(result.issuedById, 'owner');
    const retired = f.db.state().contracts.get(original.id);
    assert.ok(retired.revokedAt);
    assert.equal(retired.status, 'replaced');
    for (const key of ['environment', 'accountId', 'envelopeId', 'templateId', 'signingProvider', 'signerName', 'signerEmail', 'companySignerEmail']) assert.equal(retired[key], original[key], key);
    assert.equal(f.db.state().contracts.size, 2);
    assert.equal(f.db.state().profiles.size, 0);
    assert.equal(f.db.state().signatures.size, 0);
    const retry = await f.service.replaceLegacyContract(f.db, copy(retired), f.actor('owner'), replacementId, verify);
    assert.equal(retry.id, replacementId);
    assert.equal(checks, 1, 'a confirmed retry returns its existing replacement without creating another envelope or checking it again');
    await assert.rejects(f.service.replaceLegacyContract(f.db, copy(retired), f.actor('owner'), randomUUID(), verify), error => error.status === 409);
});

test('replacement request collisions cannot retire an original or reuse an unrelated website agreement', async t => {
    const f = await fixture(t);
    const occupied = await f.issue();
    const original = legacyContract(f);
    const before = copy(f.db.state());
    await assert.rejects(f.service.replaceLegacyContract(f.db, original, f.actor('owner'), occupied.id, async () => ({ status: 'sent' })), error => error.status === 409);
    assert.deepEqual(f.db.state(), before);
});

test('production, signed, unresolved and unverified envelopes cannot be replaced or mutated', async t => {
    const f = await fixture(t);
    const cases = [
        { saved: { environment: 'production' }, status: { status: 'sent' } },
        { saved: { companySignedAt: new Date() }, status: { status: 'sent' } },
        { saved: { boosterSignedAt: new Date() }, status: { status: 'sent' } },
        { saved: { signedAt: new Date(), status: 'completed' }, status: { status: 'completed' } },
        { saved: { envelopeId: null }, status: { status: 'sent' } },
        { saved: { revokedAt: new Date() }, status: { status: 'sent' } },
        { saved: {}, status: { status: 'sent', companySignedAt: new Date() } },
        { saved: {}, status: { status: 'completed', signedAt: new Date() } },
        { saved: {}, status: { status: 'unknown' } },
        { saved: {}, status: { status: 'voided' } },
        { saved: {}, error: new Error('DocuSign cannot be reached') },
    ];
    for (const row of cases) {
        const original = legacyContract(f, row.saved);
        const before = copy(f.db.state());
        await assert.rejects(f.service.replaceLegacyContract(f.db, original, f.actor('owner'), randomUUID(), async () => {
            if (row.error) throw row.error;
            return row.status;
        }), error => error.status === 409);
        assert.deepEqual(f.db.state(), before);
    }
    const original = legacyContract(f);
    let checked = false;
    await assert.rejects(f.service.replaceLegacyContract(f.db, original, f.actor('other'), randomUUID(), async () => { checked = true; return { status: 'sent' }; }), error => error.status === 409);
    assert.equal(checked, false, 'an unassigned admin cannot initiate an external status check for replacement');
});

test('a company challenge cannot be reused as the booster signing review after the company has signed', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const company = await f.prepare(c.id);
    await f.sign(c.id, 'owner', f.body(company));
    const booster = await f.context(c.id, 'booster');
    await assert.rejects(f.sign(c.id, 'booster', f.body(booster, { challenge: company.challenge })), error => error.status === 409);
    assert.equal(f.db.state().signatures.size, 1);
    assert.equal(f.db.state().profiles.size, 0);
});

test('archived native agreements remain readable to authorized parties but cannot be prepared or signed', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const prepared = await f.prepare(c.id);
    const payload = f.body(prepared);
    const saved = f.db.state().contracts.get(c.id);
    saved.archivedAt = new Date();
    const before = copy(f.db.state());
    const read = await f.context(c.id);
    assert.equal(read.canSign, false);
    assert.equal(read.challenge, null);
    assert.equal(read.prepared, true);
    assert.equal(read.contract.archivedAt.toISOString(), saved.archivedAt.toISOString());
    assert.equal(read.documentHash, prepared.documentHash);
    assert.equal(read.html, prepared.html);
    assert.deepEqual(f.service.document(saved), saved.nativePdf);
    await assert.rejects(f.prepare(c.id, { PaymentMethod: 'Changed archived terms' }), error => error.status === 409);
    await assert.rejects(f.sign(c.id, 'owner', payload), error => error.status === 409);
    const archivedProvider = await f.context(c.id, 'booster');
    assert.equal(archivedProvider.canPrepare, false);
    assert.equal(archivedProvider.canSign, false);
    assert.deepEqual(f.db.state(), before, 'archive reads and blocked mutations preserve the exact saved record, evidence and PDF');
});

test('archiving after the first signature preserves its PDF and blocks both second signing and an old retry', async t => {
    const f = await fixture(t);
    const c = await f.issue();
    const prepared = await f.prepare(c.id);
    const companyPayload = f.body(prepared);
    await f.sign(c.id, 'owner', companyPayload);
    const boosterReview = await f.context(c.id, 'booster');
    const boosterPayload = f.body(boosterReview);
    f.db.state().contracts.get(c.id).archivedAt = new Date();
    const before = copy(f.db.state());
    const archived = await f.context(c.id, 'booster');
    assert.equal(archived.canSign, false);
    assert.equal(archived.challenge, null);
    assert.equal(archived.signatures.length, 1);
    assert.equal(archived.signatures[0].role, 'COMPANY');
    assert.equal(archived.html, boosterReview.html);
    await assert.rejects(f.sign(c.id, 'booster', boosterPayload), error => error.status === 409);
    await assert.rejects(f.sign(c.id, 'owner', companyPayload), error => error.status === 409);
    assert.deepEqual(f.db.state(), before);
    assert.equal(f.db.state().profiles.size, 0);
});

test('archiving after a 2.2 provider signature blocks the owner countersignature', async t => {
    const f = await fixture(t);
    f.agreement.VERSION = 'FB-BSA-2.2';
    const c = await f.issue();
    await f.prepare(c.id);
    const provider = await f.context(c.id, 'booster');
    await f.sign(c.id, 'booster', f.body(provider));
    const owner = await f.context(c.id);
    assert.equal(owner.canSign, true);
    const ownerPayload = f.body(owner);
    f.db.state().contracts.get(c.id).archivedAt = new Date();
    const before = copy(f.db.state());
    const archived = await f.context(c.id);
    assert.equal(archived.canSign, false);
    assert.equal(archived.challenge, null);
    await assert.rejects(f.sign(c.id, 'owner', ownerPayload), error => error.status === 409);
    assert.deepEqual(f.db.state(), before);
    assert.equal(f.db.state().profiles.size, 0);
});

test('an archived sandbox agreement cannot offer or create a website replacement', async t => {
    const f = await fixture(t);
    const original = legacyContract(f, { archivedAt: new Date() });
    const read = await f.service.signingContext(f.db, original, f.actor('owner'));
    assert.equal(read.canReplace, false);
    const before = copy(f.db.state());
    let verified = false;
    await assert.rejects(f.service.replaceLegacyContract(f.db, original, f.actor('owner'), randomUUID(), async () => {
        verified = true;
        return { status: 'sent' };
    }), error => error.status === 409);
    assert.equal(verified, false, 'an archived record never initiates a provider status check');
    assert.deepEqual(f.db.state(), before);
});
