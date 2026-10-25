const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const agreement = require('../src/utils/nativeAgreement');
const contract = {
    id: '00000000-0000-4000-8000-000000000001', signerName: 'Nguyễn Minh Anh', signerEmail: 'provider@example.test',
    providerUsername: 'TestBooster', startsAt: '2026-10-22', companySignerName: 'An Nguyen Nguyen', companySignerEmail: 'owner@example.test',
};
const values = () => ({ ...Object.fromEntries(agreement.commercialFields().map(field => [field.key, field.defaultValue])),
    WorkLocation: 'Manitoba, Canada', PaymentMethod: 'Bank transfer', PayeeLegalName: 'Nguyễn Minh Anh',
    ProviderTimeZone: 'America/Winnipeg' });
const signature = (role, legalName, initials, time) => ({ role, legalName, initials, signedAt: time,
    signature: { type: 'typed' }, actorId: role.toLowerCase(), requestId: `${role}-test-request`,
    consentText: 'I agree to use electronic signatures and sign this exact agreement and Schedule A.' });

test('issued snapshot is self-contained, current, and hash binds every accepted value', () => {
    const snapshot = agreement.createSnapshot(contract, agreement.validateValues(values()));
    assert.equal(snapshot.version, 'FB-BSA-2.2');
    assert.equal(snapshot.values.AgreementId, contract.id);
    assert.equal(snapshot.values.ProviderLegalName, contract.signerName);
    assert.equal(snapshot.fields.some(field => field.tabLabel === 'ReferenceLanguage'), false, 'fixed languages do not create a PDF entry field');
    assert.equal(Buffer.from(snapshot.documentBase64, 'base64').subarray(0, 5).toString(), '%PDF-');
    assert.doesNotMatch(snapshot.htmlSource, /DocuSign|SANDBOX TEST COPY/);
    assert.equal(agreement.snapshotHash(snapshot), agreement.snapshotHash(JSON.parse(JSON.stringify(snapshot))));
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
    assert.equal(agreement.snapshotHash(snapshot), agreement.snapshotHash(reordered));
    assert.notEqual(agreement.snapshotHash(snapshot), agreement.snapshotHash({ ...snapshot, values: { ...snapshot.values, WorkLocation: 'Different accepted country' } }));
    assert.throws(() => agreement.createSnapshot({ ...contract, providerUsername: undefined }), /identities/);
});

test('commercial settings reject missing fields, control characters and forged locked identities', () => {
    assert.equal(agreement.commercialFields().length, 7);
    assert.equal(agreement.commercialFields().find(field => field.key === 'ReferenceLanguage').defaultValue, 'English/Vietnamese');
    assert.equal(agreement.commercialFields().some(field => ['AuthorizedSignatory', 'ServiceScope', 'JurisdictionAddendum', 'DataAccessCountries'].includes(field.key)), false);
    assert.throws(() => agreement.validateValues({ ...values(), ProviderLegalName: 'Someone Else' }), /unknown/);
    assert.throws(() => agreement.validateValues({ ...values(), WorkLocation: ' ' }), /work country/);
    assert.throws(() => agreement.validateValues({ ...values(), PaymentMethod: 'a'.repeat(71) }), /payment method/);
    assert.throws(() => agreement.validateValues({ ...values(), ServiceScope: 'not in this version' }), /unknown/);
    assert.throws(() => agreement.validateValues({ ...values(), AuthorizedSignatory: 'Not applicable' }), /unknown/);
    assert.throws(() => agreement.validateValues({ ...values(), DataAccessCountries: 'Canada' }), /unknown/);
    assert.throws(() => agreement.validateValues({ ...values(), ReferenceLanguage: 'English only' }), /languages cannot be changed/);
    const normalized = agreement.validateValues({ ...values(), PayeeLegalName: '  Nguyễn Minh Anh  ' });
    assert.equal(normalized.PayeeLegalName, contract.signerName);
});

test('HTML preview fills repeated values and escapes names, terms and saved signature labels', () => {
    const snapshot = agreement.createSnapshot({ ...contract, signerName: '<img src=x onerror=alert(1)>' }, values());
    snapshot.values.WorkLocation = '<script>alert(1)</script>';
    const html = agreement.renderHtml(snapshot, [signature('BOOSTER', '<svg onload=alert(2)>', 'AB', '2026-10-22T05:00:00Z')]);
    assert.doesNotMatch(html, /<script>|<img src=x|<svg onload|data-download-agreement|data-print\b/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal((html.match(/&lt;script&gt;/g) || []).length, 2, 'work location is synchronized in both sections');
    assert.equal((html.match(/data-native-field="WorkLocation"/g) || []).length, 2, 'repeated agreement values have stable inline field markers');
    assert.match(html, /data-native-field="ReferenceLanguage"><span data-native-value>/);
    assert.doesNotMatch(html, /data-native-field="ProviderLegalName"/, 'locked identities do not become commercial inputs');
    assert.doesNotMatch(html, /\[PROVIDER_LEGAL_NAME\]|\[WORK_COUNTRY/);
    assert.doesNotMatch(html, /Permitted service scope — required|Jurisdiction addendum \/ variations — required/);
    assert.doesNotMatch(html, /Authorized signatory, if a business|data-native-field="AuthorizedSignatory"|data-native-field="DataAccessCountries"/);
    assert.match(html, /<td>Available languages<\/td><td><span class="fb-template"><span data-native-field="ReferenceLanguage"><span data-native-value>English\/Vietnamese<\/span><\/span><\/span><\/td>/);
});

test('historical signed snapshots still display removed version 2.1 values', () => {
    const html = agreement.renderHtml({ htmlSource: '<html><head></head><body><span class="fb-template">[SIGNATORY_NAME_AND_TITLE / NOT APPLICABLE]</span><span class="fb-template">[GAMES / SERVICES / REGIONS / PERMITTED METHODS]</span><span class="fb-template">[NONE REQUIRED / IDENTIFIED SIGNED ADDENDUM]</span></body></html>',
        values: { AuthorizedSignatory: 'Not applicable', ServiceScope: 'League of Legends coaching', JurisdictionAddendum: 'None required' } });
    assert.match(html, /League of Legends coaching/);
    assert.match(html, /Not applicable/);
    assert.match(html, /None required/);
    assert.doesNotMatch(html, /\[GAMES|\[NONE REQUIRED/);
});

test('PDF supports Vietnamese identities, both signature methods and a completion record', async () => {
    const snapshot = agreement.createSnapshot(contract, agreement.validateValues(values()));
    const company = signature('COMPANY', contract.companySignerName, 'ANN', '2026-10-22T05:00:00Z');
    const booster = { ...signature('BOOSTER', contract.signerName, 'NMA', '2026-10-22T05:02:00Z'),
        signature: { type: 'drawn', width: 600, height: 180, strokes: [[[20, 120], [120, 30], [220, 120], [330, 60]]] } };
    const draft = await PDFDocument.load(await agreement.renderPdf(snapshot));
    const signedBytes = await agreement.renderPdf(snapshot, [company, booster], { completed: true });
    const signed = await PDFDocument.load(signedBytes);
    assert.equal(signed.getPageCount(), draft.getPageCount() + 1);
    assert.equal(signed.getTitle(), `FastBoost Booster Service Agreement - ${agreement.VERSION}`);
    assert.equal(signed.getForm().getFields().length, 0, 'completed output has no editable form fields');
    assert.match(agreement.renderHtml(snapshot, [company, booster]), /aria-label="Drawn signature"/);
    await assert.rejects(agreement.renderPdf(snapshot, [company], { completed: true }), /Both signatures/);
    await assert.rejects(agreement.renderPdf({ ...snapshot, values: { ...snapshot.values, WorkLocation: 'Unsupported \u{1f4a5}' } }), /font cannot render/);
});
