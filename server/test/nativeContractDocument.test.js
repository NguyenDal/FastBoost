const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { serialize, deserialize } = require('node:v8');
const agreement = require('../src/utils/nativeAgreement');
const { presentationDocument } = require('../src/utils/nativeContractDocument');

const copy = value => deserialize(serialize(value));
const digest = value => createHash('sha256').update(value).digest('hex');
function fixture(version = 'FB-BSA-2.4', count = 2) {
    const snapshot = { version, values: { WorkLocation: 'Original work location', PayeeLegalName: 'Original payee' },
        htmlSource: `Original ${version} terms`, documentBase64: 'saved-base-document', fields: [{ tabLabel: 'HistoricalField' }] };
    const hash = agreement.snapshotHash(snapshot);
    const firstRole = version === 'FB-BSA-2.2' ? 'BOOSTER' : 'COMPANY';
    const signatures = [firstRole, firstRole === 'COMPANY' ? 'BOOSTER' : 'COMPANY'].slice(0, count).map((role, index) => ({
        contractId: 'saved-contract', role, documentHash: hash, signedAt: new Date(`2026-10-24T0${index + 1}:00:00Z`),
        legalName: `${role} Original Name`, initials: 'ON', signature: { type: 'typed', style: 1 },
        requestId: `saved-request-${role}`, consentText: 'Original recorded consent', clientIp: '192.0.2.1', userAgent: 'Original audit agent',
    }));
    const nativePdf = Buffer.from('%PDF-1.7\noriginal retained PDF with completion record');
    const contract = { id: 'saved-contract', signingProvider: 'FASTBOOST', nativeSnapshot: snapshot,
        nativePreparedAt: new Date('2026-10-24T00:00:00Z'), nativeDocumentHash: hash, nativePdf, nativePdfHash: digest(nativePdf),
        companySignedAt: signatures.find(row => row.role === 'COMPANY')?.signedAt || null,
        boosterSignedAt: signatures.find(row => row.role === 'BOOSTER')?.signedAt || null,
        signedAt: count === 2 ? signatures[1].signedAt : null, nativeCompletedAt: count === 2 ? signatures[1].signedAt : null,
    };
    return { contract, signatures };
}

test('every native version renders display copies from its saved snapshot without changing evidence', async () => {
    for (const version of ['FB-BSA-2.1', 'FB-BSA-2.2', 'FB-BSA-2.3', 'FB-BSA-2.4']) {
        for (const count of [0, 1, 2]) {
            const input = fixture(version, count), original = copy(input);
            const output = Buffer.from(`%PDF-modern-${version}-${count}`);
            let renders = 0;
            const result = await presentationDocument(input.contract, input.signatures, async (snapshot, signatures, options) => {
                renders++;
                assert.deepEqual(snapshot, original.contract.nativeSnapshot);
                assert.deepEqual(signatures, original.signatures);
                assert.equal(options.completed, count === 2);
                // Even an accidental renderer mutation must not touch evidence.
                snapshot.values.WorkLocation = 'Changed in renderer copy';
                if (signatures[0]) signatures[0].initials = 'Changed in renderer copy';
                return output;
            });
            assert.equal(result, output);
            assert.equal(renders, 1);
            assert.deepEqual(input, original);
        }
    }
});

test('tampered or incomplete retained agreement evidence cannot produce a presentation', async () => {
    const changes = [
        contract => { contract.signingProvider = 'DOCUSIGN'; },
        contract => { contract.nativePreparedAt = null; },
        contract => { contract.nativeSnapshot = null; },
        contract => { contract.nativeSnapshot.values.WorkLocation = 'Changed after signing'; },
        contract => { contract.nativeDocumentHash = '0'.repeat(64); },
        contract => { contract.nativePdf = Buffer.from('%PDF-changed'); },
        contract => { contract.nativePdfHash = '0'.repeat(64); },
        contract => { contract.nativePdf = Buffer.from('not a PDF'); contract.nativePdfHash = digest(contract.nativePdf); },
    ];
    for (const change of changes) {
        const { contract, signatures } = fixture(); change(contract);
        await assert.rejects(presentationDocument(contract, signatures, () => assert.fail('unverified evidence must not render')), error => error.status === 503);
    }
});

test('missing, duplicated, mismatched, or interleaved signature records fail closed', async () => {
    const mutations = [
        input => { input.signatures = undefined; },
        input => { input.signatures.pop(); },
        input => { input.signatures.push(copy(input.signatures[0])); },
        input => { input.signatures[0].role = 'OTHER'; },
        input => { input.signatures[0].contractId = 'another-contract'; },
        input => { input.signatures[0].documentHash = '0'.repeat(64); },
        input => { input.signatures[0].signedAt = new Date('2026-10-24T03:00:00Z'); },
        input => { input.signatures[0].signedAt = 'invalid-date'; },
        input => { input.signatures[0].signature = null; },
        input => { input.signatures[0].legalName = ''; },
        input => { input.contract.companySignedAt = null; },
        input => { input.contract.nativeCompletedAt = null; },
        input => { input.contract.signedAt = null; },
        input => { input.contract.signedAt = new Date('2026-10-24T04:00:00Z'); },
        input => { input.contract.signedAt = input.contract.nativeCompletedAt = new Date('2026-10-24T04:00:00Z'); },
    ];
    for (const mutate of mutations) {
        const input = fixture(); mutate(input);
        await assert.rejects(presentationDocument(input.contract, input.signatures, () => assert.fail('inconsistent signatures must not render')), error => error.status === 503);
    }
});

test('archived signed copies remain available and render failures cannot replace the original PDF', async () => {
    const input = fixture('FB-BSA-2.2');
    input.contract.archivedAt = new Date('2026-10-25T00:00:00Z');
    const original = copy(input);
    assert.match((await presentationDocument(input.contract, input.signatures, async () => Buffer.from('%PDF-modern'))).toString(), /modern/);
    await assert.rejects(presentationDocument(input.contract, input.signatures, async () => { throw new Error('Renderer unavailable'); }), /Renderer unavailable/);
    for (const invalid of [Buffer.from('not a PDF'), undefined, 'PDF string']) {
        await assert.rejects(presentationDocument(input.contract, input.signatures, async () => invalid), error => error.status === 503);
    }
    assert.deepEqual(input, original);
});
