const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, PDFArray, PDFName, decodePDFRawStream } = require('pdf-lib');
const agreement = require('../src/utils/nativeAgreement');

const contract = { id: '00000000-0000-4000-8000-000000000001', signerName: 'Nguyễn Minh Anh', signerEmail: 'booster@example.test',
    providerUsername: 'PreviewBooster', startsAt: '2026-10-30', companySignerName: 'An Nguyen Nguyen', companySignerEmail: 'owner@example.test' };
const snapshot = () => agreement.createSnapshot(contract, { WorkLocation: 'Manitoba, Canada', ReferenceLanguage: 'English/Vietnamese' });
const signed = (role, changes = {}) => ({ role, legalName: role === 'COMPANY' ? contract.companySignerName : contract.signerName,
    signedAt: '2026-10-30T02:05:07.123Z', initials: '', signature: { type: 'typed', style: 1 }, ...changes });
const contents = (pdf, page) => {
    const value = page.node.Contents(), references = value instanceof PDFArray ? value.asArray() : [value];
    return references.map(reference => Buffer.from(decodePDFRawStream(pdf.context.lookup(reference)).decode()).toString('latin1'));
};

// Decode the newly authored Type0-font strings so assertions cover visible copy,
// not just PDF byte counts. The original saved page stream is checked separately.
function authoredText(pdf, page) {
    const fonts = page.node.Resources().lookup(PDFName.of('Font'));
    const maps = new Map();
    for (const [name, reference] of fonts.entries()) {
        const font = pdf.context.lookup(reference), unicode = font.get(PDFName.of('ToUnicode'));
        if (!unicode || font.get(PDFName.of('Subtype'))?.toString() !== '/Type0') continue;
        const cmap = Buffer.from(decodePDFRawStream(pdf.context.lookup(unicode)).decode()).toString();
        const mapping = new Map();
        for (const [, glyph, hex] of cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/giu)) {
            const bytes = Buffer.from(hex, 'hex'); let text = '';
            for (let offset = 0; offset < bytes.length; offset += 2) text += String.fromCharCode(bytes.readUInt16BE(offset));
            mapping.set(glyph.toUpperCase(), text);
        }
        maps.set(name.toString().slice(1), mapping);
    }
    let current; const lines = [];
    for (const source of contents(pdf, page).slice(1)) {
        for (const match of source.matchAll(/\/([^\s]+)\s+[\d.]+\s+Tf|<([0-9a-f]+)>\s*Tj/giu)) {
            if (match[1]) { current = maps.get(match[1]); continue; }
            lines.push((match[2].match(/.{4}/gu) || []).map(glyph => current?.get(glyph.toUpperCase()) || '').join(''));
        }
    }
    return lines.join('\n');
}

test('presentation replaces only the old signature table and keeps all other saved page content', async () => {
    const saved = snapshot(), original = JSON.stringify(saved), hash = agreement.snapshotHash(saved);
    const base = await PDFDocument.load(Buffer.from(saved.documentBase64, 'base64'));
    const result = await PDFDocument.load(await agreement.renderPresentationPdf(saved, [signed('COMPANY'), signed('BOOSTER')], { completed: true }));
    assert.equal(result.getPageCount(), base.getPageCount(), 'no electronic completion appendix is added');
    for (let index = 0; index < base.getPageCount() - 1; index++) {
        assert.ok(contents(result, result.getPages()[index]).includes(contents(base, base.getPages()[index])[0]), 'saved legal PDF operators stay byte-identical');
    }
    const source = contents(base, base.getPages().at(-1))[0];
    const cleaned = contents(result, result.getPages().at(-1)).find(value => value.includes('(FASTBOOST  /  BOOSTER SERVICE AGREEMENT)'));
    const start = source.indexOf('q\n1 0 0 1 60 186 cm\n');
    const footer = source.indexOf('q\n1 0 0 1 60 180 cm\n', start);
    assert.ok(start > 0 && footer > start);
    assert.ok(cleaned.startsWith(source.slice(0, start)));
    assert.ok(cleaned.endsWith(source.slice(footer)));
    assert.doesNotMatch(cleaned, /\(Signature\)|\(Date\)|\(Schedule A approval \/ initials\)/u);
    assert.match(cleaned, /required local terms are completed/u, 'approval wording remains intact');
    assert.match(cleaned, /Keep signed copies private/u, 'saved wording below the cards remains intact');
    const text = authoredText(result, result.getPages().at(-1));
    assert.match(text, /FASTBOOST\nSigned/u);
    assert.match(text, /PROVIDER\nSigned/u);
    assert.match(text, /Nguyễn Minh Anh/u);
    assert.match(text, /Signed by/u);
    assert.match(text, /Oct 30, 2026\n02:05 UTC/u);
    assert.doesNotMatch(text, /initials|completion record|Account email/u);
    assert.equal(result.getForm().getFields().length, 0);
    assert.equal(JSON.stringify(saved), original);
    assert.equal(agreement.snapshotHash(saved), hash);
});

test('unsigned and partially signed cards retain status and historical initials without a blank initials field', async () => {
    const saved = snapshot();
    const result = await PDFDocument.load(await agreement.renderPresentationPdf(saved, [signed('COMPANY', { initials: 'ANN' })]));
    const text = authoredText(result, result.getPages().at(-1));
    assert.match(text, /PROVIDER\nAwaiting signature\nSignature pending/u);
    assert.equal((text.match(/Schedule A initials:/gu) || []).length, 1);
    assert.match(text, /Schedule A initials: ANN/u);
    assert.doesNotMatch(text, /approval \/ initials/u);
    await assert.rejects(agreement.renderPresentationPdf(saved, [signed('COMPANY')], { completed: true }), /Both signatures/u);
});

test('all typed styles, Vietnamese long names and drawn marks fit without changing saved evidence', async () => {
    const saved = snapshot();
    const longName = 'Nguyễn Thị Thùy Dương Trần Đặng Huyền Anh Nguyễn Thị Thùy Dương Trần Đặng Huyền Anh';
    for (const style of [undefined, 1, 2, 3]) {
        const mark = { type: 'typed', ...(style && { style }) };
        const signatures = [signed('COMPANY', { legalName: longName, signature: mark }), signed('BOOSTER', {
            signature: { type: 'drawn', width: 600, height: 180, strokes: [[[0, 180], [120, 20], [260, 150], [600, 0]]] },
        })];
        const original = JSON.stringify(signatures);
        const result = await PDFDocument.load(await agreement.renderPresentationPdf(saved, signatures, { completed: true }));
        assert.match(authoredText(result, result.getPages().at(-1)), /Nguyễn/u);
        const fontNames = result.getPages().at(-1).node.Resources().lookup(PDFName.of('Font')).entries()
            .map(([, reference]) => result.context.lookup(reference).get(PDFName.of('BaseFont'))?.toString()).join(' ');
        assert.match(fontNames, style === 3 ? /GreatVibes/u : /DancingScript/u);
        assert.equal(JSON.stringify(signatures), original);
    }
    await assert.rejects(agreement.renderPresentationPdf(saved, [signed('COMPANY', { legalName: 'Unsupported 💥' })]), /font cannot render/u);
    await assert.rejects(agreement.renderPresentationPdf(saved, [signed('COMPANY', { signature: { type: 'drawn', strokes: [[[700, 10]]] } })]), /drawn signature/u);
});

test('saved signature positions and role order control presentation across historical versions', async () => {
    for (const [version, shift, reversed] of [['FB-BSA-2.1', 21, false], ['FB-BSA-2.2', -240, true], ['FB-BSA-2.3', 83, false], ['FB-BSA-2.4', 0, false]]) {
        const saved = snapshot(); saved.version = version;
        const pdf = await PDFDocument.load(Buffer.from(saved.documentBase64, 'base64'));
        const page = pdf.getPages().at(-1), source = contents(pdf, page)[0];
        const moved = source.replace('1 0 0 1 60 186 cm', `1 0 0 1 60 ${186 - shift} cm`);
        page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(Buffer.from(moved, 'latin1'))));
        saved.documentBase64 = Buffer.from(await pdf.save()).toString('base64');
        for (const field of saved.fields.filter(field => field.type !== 'textTabs')) {
            field.yPosition = String(Number(field.yPosition) + shift);
            if (reversed) field.xPosition = String(Number(field.xPosition) === 76 ? 328 : 76);
        }
        const result = await PDFDocument.load(await agreement.renderPresentationPdf(saved, [signed('COMPANY'), signed('BOOSTER')], { completed: true }));
        const text = authoredText(result, result.getPages().at(-1));
        assert.equal(text.indexOf('PROVIDER') < text.indexOf('FASTBOOST'), reversed);
        assert.equal(result.getTitle(), `FastBoost Booster Service Agreement - ${version}`);
        assert.equal(result.getPageCount(), pdf.getPageCount());
    }
});

test('original typed signatures retain canonically supported Greek and Cyrillic names in the new presentation', async () => {
    const saved = snapshot();
    for (const legalName of ['Александр Иванов', 'Αλέξανδρος Παπαδόπουλος']) {
        for (const style of [undefined, 1]) {
            const signatures = [signed('COMPANY', { legalName, signature: { type: 'typed', ...(style && { style }) } })];
            const original = JSON.stringify(signatures);
            const canonical = await PDFDocument.load(await agreement.renderPdf(saved, signatures));
            const result = await PDFDocument.load(await agreement.renderPresentationPdf(saved, signatures));
            const text = authoredText(result, result.getPages().at(-1)).replace(/\s+/gu, ' ');
            assert.ok(text.includes(legalName), 'display retains every character in the accepted name');
            assert.equal(result.getPageCount(), canonical.getPageCount());
            assert.equal(JSON.stringify(signatures), original, 'fallback changes only presentation');
        }
        for (const style of (legalName.startsWith('А') ? [2] : [2, 3])) {
            await assert.rejects(agreement.renderPresentationPdf(saved, [signed('COMPANY', { legalName, signature: { type: 'typed', style } })]), /font cannot render/u,
                'explicit handwriting styles retain their validated font rather than silently switching');
        }
    }
});

test('presentation preserves canonical fitting for previously accepted long commercial values', async () => {
    const saved = agreement.createSnapshot({ ...contract, providerUsername: 'W'.repeat(60) },
        { WorkLocation: 'Manitoba, Canada', ReferenceLanguage: 'English/Vietnamese' });
    const original = JSON.stringify(saved);
    await agreement.renderPdf(saved);
    const result = await PDFDocument.load(await agreement.renderPresentationPdf(saved));
    assert.ok(authoredText(result, result.getPages()[0]).replace(/\s/gu, '').includes('W'.repeat(60)),
        'every character of the accepted maximum-length username is retained');
    assert.equal(JSON.stringify(saved), original);
});

test('unknown or damaged signature geometry fails closed instead of erasing agreement text', async () => {
    const saved = snapshot();
    const changed = structuredClone(saved);
    changed.fields.find(field => field.type === 'signHereTabs').xPosition = '100';
    await assert.rejects(agreement.renderPresentationPdf(changed), /layout cannot be displayed safely/u);
    const pdf = await PDFDocument.load(Buffer.from(saved.documentBase64, 'base64'));
    const page = pdf.getPages().at(-1), source = contents(pdf, page)[0];
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(Buffer.from(source.replace('(Schedule A approval / initials)', '(Unrecognized detail)'), 'latin1'))));
    // Both labels must be absent to make the saved table unidentifiable.
    const damaged = contents(pdf, page)[0].replace('(Schedule A approval / initials)', '(Unrecognized detail)');
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(Buffer.from(damaged, 'latin1'))));
    await assert.rejects(agreement.renderPresentationPdf({ ...saved, documentBase64: Buffer.from(await pdf.save()).toString('base64') }), /cannot be identified safely/u);
    await assert.rejects(agreement.renderPresentationPdf(saved, [signed('COMPANY'), signed('COMPANY')]), /signatures are invalid/u);
});
