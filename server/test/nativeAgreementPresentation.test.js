const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, PDFArray, PDFName, decodePDFRawStream } = require('pdf-lib');
const agreement = require('../src/utils/nativeAgreement');
const { parseDocument, DomUtils } = require('htmlparser2');

const contract = { id: '00000000-0000-4000-8000-000000000001', signerName: 'Nguyễn Minh Anh', signerEmail: 'booster@example.test',
    providerUsername: 'PreviewBooster', startsAt: '2026-10-30', companySignerName: 'An Nguyen Nguyen', companySignerEmail: 'owner@example.test' };
const snapshot = () => agreement.createSnapshot(contract, { WorkLocation: 'Manitoba, Canada', ReferenceLanguage: 'English/Vietnamese' });
const signed = (role, changes = {}) => ({ role, legalName: role === 'COMPANY' ? contract.companySignerName : contract.signerName,
    signedAt: '2026-10-30T02:05:07.123Z', initials: '', signature: { type: 'typed', style: 1 }, ...changes });
const contents = (pdf, page) => {
    const value = page.node.Contents(), references = value instanceof PDFArray ? value.asArray() : [value];
    return references.map(reference => Buffer.from(decodePDFRawStream(pdf.context.lookup(reference)).decode()).toString('latin1'));
};

// Decode both PDFKit's TJ/bfrange and pdf-lib's Tj/bfchar strings. Tests check
// actual displayed content, including ligatures and accented saved identities.
function authoredItems(pdf, page) {
    const fonts = page.node.Resources().lookup(PDFName.of('Font'));
    const maps = new Map();
    for (const [name, reference] of fonts.entries()) {
        const font = pdf.context.lookup(reference), unicode = font.get(PDFName.of('ToUnicode'));
        if (!unicode || font.get(PDFName.of('Subtype'))?.toString() !== '/Type0') continue;
        const cmap = Buffer.from(decodePDFRawStream(pdf.context.lookup(unicode)).decode()).toString();
        const mapping = new Map();
        const decode = hex => {
            const bytes = Buffer.from(hex.replace(/\s/gu, ''), 'hex'); let text = '';
            for (let offset = 0; offset < bytes.length; offset += 2) text += String.fromCharCode(bytes.readUInt16BE(offset));
            return text;
        };
        for (const [, block] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)) {
            for (const [, glyph, hex] of block.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f\s]+)>/giu)) mapping.set(glyph.toUpperCase(), decode(hex));
        }
        for (const [, first, , values] of cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/giu)) {
            let glyph = parseInt(first, 16);
            for (const [, hex] of values.matchAll(/<([0-9a-f\s]+)>/giu)) mapping.set((glyph++).toString(16).padStart(4, '0').toUpperCase(), decode(hex));
        }
        maps.set(name.toString().slice(1), mapping);
    }
    let current, size, x, y; const items = [];
    for (const source of contents(pdf, page)) {
        for (const match of source.matchAll(/\/([^\s]+)\s+([\d.]+)\s+Tf|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm|<([0-9a-f]+)>\s*Tj|\[([^\]]*)\]\s*TJ/giu)) {
            if (match[1]) { current = maps.get(match[1]); size = Number(match[2]); continue; }
            if (match[3]) { x = Number(match[3]); y = Number(match[4]); continue; }
            const hex = match[5] || [...match[6].matchAll(/<([0-9a-f]+)>/giu)].map(value => value[1]).join('');
            items.push({ x, y, size, text: (hex.match(/.{4}/gu) || []).map(glyph => current?.get(glyph.toUpperCase()) || '').join('') });
        }
    }
    return items;
}
const authoredText = (pdf, page) => authoredItems(pdf, page).map(item => item.text).join('\n');
const documentText = pdf => pdf.getPages().map(page => authoredItems(pdf, page)
    .filter(item => item.y > 46 && item.y < 746).map(item => item.text).join('\n')).join('\n');
const compact = value => value.replace(/\s+/gu, '');
const inSignatureCard = node => {
    for (let parent = node.parent; parent; parent = parent.parent) if (parent.attribs?.class?.includes('fb-signature-card')) return true;
    return false;
};

test('compact presentation preserves all saved agreement wording and values without changing evidence', async () => {
    const saved = snapshot(), original = JSON.stringify(saved), hash = agreement.snapshotHash(saved);
    const base = await PDFDocument.load(Buffer.from(saved.documentBase64, 'base64'));
    const result = await PDFDocument.load(await agreement.renderPresentationPdf(saved, [signed('COMPANY'), signed('BOOSTER')], { completed: true }));
    assert.ok(result.getPageCount() < base.getPageCount(), 'compact rows reduce wasted pages');
    const completeText = documentText(result);
    const rendered = parseDocument(agreement.renderHtml(saved));
    const sections = DomUtils.findAll(node => node.name === 'section' && node.attribs?.class === 'fb-section', rendered.children);
    for (const section of sections) {
        const nodes = DomUtils.findAll(node => ['h2', 'p', 'td', 'th', 'li'].includes(node.name) && !inSignatureCard(node), [section]);
        for (const node of nodes) assert.ok(compact(completeText).includes(compact(DomUtils.textContent(node))),
            `Saved wording retained: ${DomUtils.textContent(node).slice(0, 90)}`);
    }
    const firstPage = authoredText(result, result.getPages()[0]);
    for (const value of [contract.id, contract.signerName, contract.signerEmail, contract.providerUsername, 'Manitoba, Canada', 'October 30, 2026']) {
        assert.ok(compact(firstPage).includes(compact(value)), `Identity table fits first page: ${value}`);
    }
    const firstItems = authoredItems(result, result.getPages()[0]);
    const referenceLine = firstItems.find(item => item.text.includes(contract.id));
    const legalNameLine = firstItems.find(item => item.text === contract.signerName.split(' ')[0]);
    assert.ok(referenceLine && legalNameLine && Math.abs(referenceLine.y - legalNameLine.y) < 45,
        'one-line values have ordinary table spacing, not blank signing-field heights');
    const text = authoredText(result, result.getPages().at(-1));
    assert.match(text, /FASTBOOST\nSigned/u);
    assert.match(text, /PROVIDER\nSigned/u);
    assert.match(text, /Nguyễn Minh Anh/u);
    assert.match(text, /Signed by/u);
    assert.match(text, /Oct 30, 2026[^\n]*02:05 UTC/u, 'saved date and time stay on one line');
    assert.doesNotMatch(completeText, /Electronic signing completion record|Account email|Schedule A approval \/ initials/u);
    assert.equal(result.getForm().getFields().length, 0);
    assert.equal(JSON.stringify(saved), original);
    assert.equal(agreement.snapshotHash(saved), hash);
});

test('flow uses the exact saved wording and populated values instead of the current template', async () => {
    const saved = snapshot();
    saved.htmlSource = saved.htmlSource.replace('No continuous screen monitoring or access to unrelated private accounts is authorized.',
        'Historical saved wording remains the accepted text for this agreement.');
    saved.values.WorkLocation = 'Québec, Canada';
    const original = JSON.stringify(saved), hash = agreement.snapshotHash(saved);
    const pdf = await PDFDocument.load(await agreement.renderPresentationPdf(saved));
    const text = compact(documentText(pdf));
    assert.ok(text.includes(compact('Historical saved wording remains the accepted text for this agreement.')));
    assert.ok(!text.includes(compact('No continuous screen monitoring or access to unrelated private accounts is authorized.')));
    assert.ok(text.includes(compact('Québec, Canada')));
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
        const saved = snapshot(); saved.htmlSource = saved.htmlSource.replaceAll(saved.version, version); saved.version = version;
        if (reversed) saved.htmlSource = saved.htmlSource.replace(
            /(<div class="fb-signatures">)(<div class="fb-signature-card">[\s\S]*?<\/div>)(<div class="fb-signature-card">[\s\S]*?<\/div>)/u, '$1$3$2');
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
        assert.equal(text.lastIndexOf('\nPROVIDER\n') < text.lastIndexOf('\nFASTBOOST\n'), reversed);
        assert.equal(result.getTitle(), `FastBoost Booster Service Agreement - ${version}`);
        assert.ok(result.getPageCount() <= pdf.getPageCount());
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
            assert.ok(result.getPageCount() <= canonical.getPageCount());
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

test('unknown saved HTML structure or placeholders fail closed instead of dropping contract content', async () => {
    const saved = snapshot();
    await assert.rejects(agreement.renderPresentationPdf({ ...saved, htmlSource: saved.htmlSource.replace(
        '<section class="fb-section" id="parties"', '<article>Required saved clause</article><section class="fb-section" id="parties"') }),
    /saved|agreement|unsupported|unexpected/iu);
    await assert.rejects(agreement.renderPresentationPdf({ ...saved, htmlSource: saved.htmlSource.replace('[AGREEMENT_ID]', '[UNRECOGNIZED_REQUIRED_VALUE]') }),
        /saved|agreement|placeholder|unknown/iu);
    await assert.rejects(agreement.renderPresentationPdf({ ...saved, htmlSource: '' }), /saved|agreement|unavailable|missing/iu);
});
