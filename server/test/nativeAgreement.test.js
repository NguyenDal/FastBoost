const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PDFDocument, PDFDict, PDFName } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const agreement = require('../src/utils/nativeAgreement');
const contract = {
    id: '00000000-0000-4000-8000-000000000001', signerName: 'Nguyễn Minh Anh', signerEmail: 'provider@example.test',
    providerUsername: 'TestBooster', startsAt: '2026-10-22', companySignerName: 'An Nguyen Nguyen', companySignerEmail: 'owner@example.test',
};
const values = () => ({ ...Object.fromEntries(agreement.commercialFields().map(field => [field.key, field.defaultValue])),
    WorkLocation: 'Manitoba, Canada' });
const signature = (role, legalName, initials, time) => ({ role, legalName, initials, signedAt: time,
    signature: { type: 'typed' }, actorId: role.toLowerCase(), requestId: `${role}-test-request`,
    consentText: 'I agree to use electronic signatures and sign this exact agreement and Schedule A.' });

test('issued snapshot is self-contained, current, and hash binds every accepted value', () => {
    const snapshot = agreement.createSnapshot(contract, agreement.validateValues(values()));
    assert.equal(snapshot.version, 'FB-BSA-2.4');
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
    assert.equal(agreement.commercialFields().length, 2);
    assert.equal(agreement.commercialFields().find(field => field.key === 'ReferenceLanguage').defaultValue, 'English/Vietnamese');
    assert.equal(agreement.commercialFields().some(field => ['AuthorizedSignatory', 'ServiceScope', 'JurisdictionAddendum', 'DataAccessCountries'].includes(field.key)), false);
    assert.throws(() => agreement.validateValues({ ...values(), ProviderLegalName: 'Someone Else' }), /unknown/);
    assert.throws(() => agreement.validateValues({ ...values(), WorkLocation: ' ' }), /work country/);
    for (const key of ['EndDate', 'PaymentMethod', 'PayeeLegalName', 'TransferFeeVariation', 'ProviderTimeZone']) {
        assert.throws(() => agreement.validateValues({ ...values(), [key]: 'not in this version' }), /unknown/);
    }
    assert.throws(() => agreement.validateValues({ ...values(), ServiceScope: 'not in this version' }), /unknown/);
    assert.throws(() => agreement.validateValues({ ...values(), AuthorizedSignatory: 'Not applicable' }), /unknown/);
    assert.throws(() => agreement.validateValues({ ...values(), DataAccessCountries: 'Canada' }), /unknown/);
    assert.throws(() => agreement.validateValues({ ...values(), ReferenceLanguage: 'English only' }), /languages cannot be changed/);
    const normalized = agreement.validateValues({ ...values(), WorkLocation: '  Việt Nam  ' });
    assert.equal(normalized.WorkLocation, 'Việt Nam');
});

test('HTML preview fills repeated values and escapes names, terms and saved signature labels', () => {
    const snapshot = agreement.createSnapshot({ ...contract, signerName: '<img src=x onerror=alert(1)>' }, values());
    snapshot.values.WorkLocation = '<script>alert(1)</script>';
    const savedSignature = signature('BOOSTER', '<svg onload=alert(2)>', '<AB>', '2026-10-22T05:00:00.123Z');
    const original = JSON.stringify({ snapshot, savedSignature });
    const originalHash = agreement.snapshotHash(snapshot);
    const html = agreement.renderHtml(snapshot, [savedSignature]);
    assert.doesNotMatch(html, /<script>|<img src=x|<svg onload|data-download-agreement|data-print\b/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal((html.match(/&lt;script&gt;/g) || []).length, 1, 'work location appears only in the parties section');
    assert.equal((html.match(/data-native-field="WorkLocation"/g) || []).length, 1, 'agreement values have stable inline field markers');
    assert.match(html, /data-native-field="ReferenceLanguage"><span data-native-value>/);
    assert.doesNotMatch(html, /data-native-field="ProviderLegalName"/, 'locked identities do not become commercial inputs');
    assert.doesNotMatch(html, /\[PROVIDER_LEGAL_NAME\]|\[WORK_COUNTRY/);
    assert.doesNotMatch(html, /Permitted service scope — required|Jurisdiction addendum \/ variations — required/);
    assert.doesNotMatch(html, /Authorized signatory, if a business|data-native-field="AuthorizedSignatory"|data-native-field="DataAccessCountries"/);
    assert.match(html, /<td>Available languages<\/td><td><span class="fb-template"><span data-native-field="ReferenceLanguage"><span data-native-value>English\/Vietnamese<\/span><\/span><\/span><\/td>/);
    assert.match(html, /class="fb-signature-card is-signed"/);
    assert.match(html, /class="fb-signature-card is-pending"/);
    assert.match(html, /class="fb-signature-card is-signed" data-native-signature-role="BOOSTER"/);
    assert.match(html, /class="fb-signature-card is-pending" data-native-signature-role="COMPANY"/);
    assert.match(html, /class="fb-signature-script" data-native-value>&lt;svg onload=alert\(2\)&gt;<\/span>/);
    assert.doesNotMatch(html, /Schedule A initials/);
    assert.match(html, /<time datetime="2026-10-22T05:00:00.123Z" data-native-date-time="2026-10-22T05:00:00.123Z" title="2026-10-22T05:00:00.123Z">Oct 22, 2026 · 05:00 UTC<\/time>/);
    assert.match(html, /class="fb-signature-placeholder">Signature pending<\/span>/);
    assert.doesNotMatch(html, /fb-signature-party/);
    assert.equal(JSON.stringify({ snapshot, savedSignature }), original, 'display formatting leaves accepted terms and signature evidence untouched');
    assert.equal(agreement.snapshotHash(snapshot), originalHash);
});

test('signature cards omit initials while the PDF retains historical initials and the frozen document', async () => {
    const snapshot = agreement.createSnapshot(contract, agreement.validateValues(values()));
    const company = signature('COMPANY', contract.companySignerName, 'ANN', '2026-10-22T05:00:00Z');
    const booster = signature('BOOSTER', contract.signerName, '', '2026-10-22T05:02:00Z');
    const original = JSON.stringify({ snapshot, company, booster });
    const hash = agreement.snapshotHash(snapshot);
    const pendingHtml = agreement.renderHtml(snapshot);
    assert.doesNotMatch(pendingHtml, /Schedule A initials/);
    const html = agreement.renderHtml(snapshot, [company, booster]);
    assert.doesNotMatch(html, /Schedule A initials/);
    assert.equal(company.initials, 'ANN');
    assert.match(html, /class="fb-signature-script" data-native-value>Nguyễn Minh Anh<\/span>/);
    const draft = await PDFDocument.load(await agreement.renderPdf(snapshot));
    const completed = await PDFDocument.load(await agreement.renderPdf(snapshot, [company, booster], { completed: true }));
    assert.equal(completed.getPageCount(), draft.getPageCount() + 1);
    assert.equal(completed.getForm().getFields().length, 0);
    assert.equal(JSON.stringify({ snapshot, company, booster }), original);
    assert.equal(agreement.snapshotHash(snapshot), hash);
});

test('the company attribution uses the recorded signer only below the mark and retains exact timestamp evidence', () => {
    const snapshot = agreement.createSnapshot(contract, agreement.validateValues(values()));
    const company = signature('COMPANY', 'Actual <Signer>', 'AS', '2026-10-22T05:00:00.123Z');
    const html = agreement.renderHtml(snapshot, [company]);
    assert.doesNotMatch(html, /fb-signature-party/);
    assert.match(html, /<span>Signed by<\/span><strong>Actual &lt;Signer&gt;, trading as FastBoost<\/strong>/);
    assert.match(html, /class="fb-signature-script" data-native-value>Actual &lt;Signer&gt;<\/span>/);
    assert.match(html, /datetime="2026-10-22T05:00:00.123Z" data-native-date-time="2026-10-22T05:00:00.123Z" title="2026-10-22T05:00:00.123Z"/);
    assert.equal(company.legalName, 'Actual <Signer>');
});

test('additional typed styles use matching self-hosted fonts in HTML and PDF with Vietnamese glyph coverage', async () => {
    const fonts = [[2, 'DancingScript.ttf'], [3, 'GreatVibes-Regular.ttf']];
    const snapshot = agreement.createSnapshot(contract, agreement.validateValues(values()));
    const hash = agreement.snapshotHash(snapshot);
    for (const [style, filename] of fonts) {
        const bytes = readFileSync(resolve(__dirname, '../private/legal/fonts', filename));
        assert.deepEqual(bytes, readFileSync(resolve(__dirname, '../../client/public/legal/fonts', filename)),
            'preview and PDF must use identical font assets');
        const sourceFont = fontkit.create(bytes);
        const vietnamese = 'Trần Nguyễn Đặng Thị Huyền Anh Nguyễn Thị Thùy Dương';
        assert.ok(Array.from(vietnamese + vietnamese.normalize('NFD')).every(character => sourceFont.hasGlyphForCodePoint(character.codePointAt(0))));
        const company = { ...signature('COMPANY', 'Trần Nguyễn Đặng Thị Huyền Anh', '', '2026-10-22T05:00:00Z'), signature: { type: 'typed', style } };
        const html = agreement.renderHtml(snapshot, [company]);
        assert.match(html, new RegExp(`class="fb-signature-script fb-signature-style-${style}" data-native-value>Trần Nguyễn Đặng Thị Huyền Anh`));
        const pdf = await PDFDocument.load(await agreement.renderPdf(snapshot, [company]));
        const fontObjects = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter(object => object instanceof PDFDict);
        assert.ok(fontObjects.some(object => String(object.get(PDFName.of('BaseFont')) || '').includes(sourceFont.postscriptName)),
            `style ${style} embeds its selected handwriting font`);
        assert.equal(agreement.snapshotHash(snapshot), hash);
    }
    const legacy = signature('COMPANY', contract.companySignerName, 'ANN', '2026-10-22T05:00:00Z');
    assert.doesNotMatch(agreement.renderHtml(snapshot, [legacy]), /fb-signature-style-/);
    const legacyPdf = await PDFDocument.load(await agreement.renderPdf(snapshot, [legacy]));
    assert.ok(legacyPdf.context.enumerateIndirectObjects().every(([, object]) => !(object instanceof PDFDict)
        || !/DancingScript|GreatVibes/.test(String(object.get(PDFName.of('BaseFont')) || ''))),
    'styleless historical signatures keep their original PDF font');
});

test('style one preserves the original signature appearance and exact existing PDF drawing path', async () => {
    const snapshot = agreement.createSnapshot(contract, agreement.validateValues(values()));
    const legacy = signature('COMPANY', 'Nguyễn Thị Thùy Dương', 'NTTD', '2026-10-22T05:00:00Z');
    const original = { ...legacy, signature: { type: 'typed', style: 1 } };
    assert.match(agreement.renderHtml(snapshot, [original]), /class="fb-signature-script fb-signature-style-1" data-native-value>Nguyễn Thị Thùy Dương/);
    assert.deepEqual(await agreement.renderPdf(snapshot, [original]), await agreement.renderPdf(snapshot, [legacy]),
        'the original style must not change the existing NotoSans PDF representation');
});

test('a typed style cannot silently drop unsupported name characters or accept an unknown style', async () => {
    const snapshot = agreement.createSnapshot(contract, agreement.validateValues(values()));
    const company = { ...signature('COMPANY', 'Omega Ω', '', '2026-10-22T05:00:00Z'), signature: { type: 'typed', style: 2 } };
    await assert.rejects(agreement.renderPdf(snapshot, [company]), /style cannot display every character/);
    await assert.rejects(agreement.renderPdf(snapshot, [{ ...company, signature: { type: 'typed', style: 4 } }]), /three signature styles/);
});

test('current document fixes Remitly and company-paid fees, with only the start date and company-first signing', () => {
    const snapshot = agreement.createSnapshot({ ...contract, startsAt: '2026-11-01' }, agreement.validateValues(values()));
    const html = agreement.renderHtml(snapshot);
    assert.equal(snapshot.values.EffectiveDate, '2026-11-01', 'canonical stored date remains ISO');
    assert.match(html, /<td>Start date<\/td><td><span class="fb-template"><span data-native-date="2026-11-01">November 1, 2026<\/span><\/span><\/td>/);
    assert.match(html, /Manual transfer via <strong>Remitly<\/strong>/);
    assert.match(html, /<td>Payment method<\/td>/);
    assert.match(html, /Recipient and banking details are collected and verified separately through an approved secure process before payment\./);
    assert.match(html, /FastBoost pays the Provider by Remitly using recipient details verified separately before payment\./);
    assert.equal('PayeeLegalName' in snapshot.values, false);
    assert.match(html, /FastBoost pays all fees for the agreed transfer/);
    assert.match(html, /These are examples, not fixed contractual exchange rates/);
    assert.match(html, /FastBoost completes all required details and signs the saved agreement first/);
    assert.ok(html.indexOf('<h3>FASTBOOST</h3>') < html.indexOf('<h3>PROVIDER</h3>'));
    assert.doesNotMatch(html, /END_DATE_OR_ONGOING|PAYMENT_METHOD|PAYEE_LEGAL_NAME|PayeeLegalName|verified payee in Schedule A|Method \/ payee|WRITTEN REPLACEMENT RULE|PROVIDER_TIME_ZONE|optional end date|local time zone/);
    const packageFields = snapshot.fields.filter(field => field.type === 'textTabs');
    assert.ok(packageFields.every(field => field.role === 'COMPANY'));
    assert.equal(packageFields.some(field => ['EndDate', 'PaymentMethod', 'PayeeLegalName', 'TransferFeeVariation', 'ProviderTimeZone'].includes(field.tabLabel)), false);
});

test('historical 2.3 snapshots retain the accepted payee and formatted start date', () => {
    const snapshot = { version: 'FB-BSA-2.3', htmlSource: '<html><head></head><body><p>[EFFECTIVE_DATE]</p><p>Manual transfer via <strong>Remitly</strong>; verified payee <span class="fb-template">[PAYEE_LEGAL_NAME]</span>.</p></body></html>',
        values: { EffectiveDate: '2026-11-01', PayeeLegalName: 'Historical accepted payee' } };
    const original = JSON.stringify(snapshot);
    const html = agreement.renderHtml(snapshot);
    assert.match(html, /data-native-date="2026-11-01">November 1, 2026<\/span>/);
    assert.match(html, /data-native-field="PayeeLegalName"><span data-native-value>Historical accepted payee<\/span>/);
    assert.equal(JSON.stringify(snapshot), original, 'rendering never rewrites the historical snapshot');
});

test('historical snapshots keep their saved payment, fee, end date and timezone terms', () => {
    const html = agreement.renderHtml({ htmlSource: '<html><head></head><body>[PAYMENT_METHOD];[NONE / WRITTEN REPLACEMENT RULE];[END_DATE_OR_ONGOING];[PROVIDER_TIME_ZONE]</body></html>',
        values: { PaymentMethod: 'Historical bank transfer', TransferFeeVariation: 'Historical fee rule', EndDate: 'Ongoing', ProviderTimeZone: 'Asia/Ho_Chi_Minh' } });
    assert.match(html, /Historical bank transfer;Historical fee rule;Ongoing;Asia\/Ho_Chi_Minh/);
    assert.doesNotMatch(html, /data-native-field|\[PAYMENT_METHOD\]/);
});

test('historical start dates retain their frozen display format', () => {
    for (const version of ['FB-BSA-2.1', 'FB-BSA-2.2']) {
        const html = agreement.renderHtml({ version, htmlSource: '<html><head></head><body>[EFFECTIVE_DATE]</body></html>', values: { EffectiveDate: '2026-11-01' } });
        assert.match(html, /<body>2026-11-01<\/body>/);
        assert.doesNotMatch(html, /data-native-date/);
    }
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
    const signedHtml = agreement.renderHtml(snapshot, [company, booster]);
    assert.match(signedHtml, /class="fb-signature-drawing" viewBox="0 0 600 180" role="img" aria-label="Drawn signature"/);
    assert.match(signedHtml, /points="20,120 120,30 220,120 330,60"/);
    assert.equal((signedHtml.match(/class="fb-signature-script"/g) || []).length, 1, 'drawn signatures retain their actual strokes rather than a typed approximation');
    await assert.rejects(agreement.renderPdf(snapshot, [company], { completed: true }), /Both signatures/);
    await assert.rejects(agreement.renderPdf({ ...snapshot, values: { ...snapshot.values, WorkLocation: 'Unsupported \u{1f4a5}' } }), /font cannot render/);
});
