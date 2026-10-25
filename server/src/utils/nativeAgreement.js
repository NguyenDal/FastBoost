const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const VERSION = 'FB-BSA-2.2';
const root = resolve(__dirname, '../../private/legal');
const fail = message => Object.assign(new Error(message), { status: 400 });
const fields = [
    ['WorkLocation', 'Work country and state or province', 120, ''],
    ['EndDate', 'End date or Ongoing', 50, 'Ongoing'],
    ['PaymentMethod', 'Agreed payment method', 70, ''],
    ['PayeeLegalName', 'Payee legal name', 120, ''],
    ['TransferFeeVariation', 'Transfer fee variation', 150, 'None'],
    ['ProviderTimeZone', 'Provider time zone', 60, ''],
    ['ReferenceLanguage', 'Available languages', 20, 'English/Vietnamese'],
].map(([key, label, maxLength, defaultValue]) => ({ key, label, maxLength, defaultValue, required: true }));
const commercialFieldKeys = new Set(fields.map(field => field.key));
const placeholders = {
    AGREEMENT_ID: 'AgreementId', PROVIDER_LEGAL_NAME: 'ProviderLegalName', PROVIDER_EMAIL: 'ProviderEmail',
    PROVIDER_USERNAME: 'ProviderUsername', EFFECTIVE_DATE: 'EffectiveDate',
    'SIGNATORY_NAME_AND_TITLE / NOT APPLICABLE': 'AuthorizedSignatory',
    WORK_COUNTRY_AND_STATE_OR_PROVINCE: 'WorkLocation', END_DATE_OR_ONGOING: 'EndDate',
    PAYMENT_METHOD: 'PaymentMethod', PAYEE_LEGAL_NAME: 'PayeeLegalName',
    'NONE / WRITTEN REPLACEMENT RULE': 'TransferFeeVariation',
    'GAMES / SERVICES / REGIONS / PERMITTED METHODS': 'ServiceScope', PROVIDER_TIME_ZONE: 'ProviderTimeZone',
    COUNTRIES: 'DataAccessCountries', 'ENGLISH / IDENTIFY REVIEWED TRANSLATION AND AGREED CONFLICT RULE': 'ReferenceLanguage',
    'ENGLISH / VIETNAMESE': 'ReferenceLanguage',
    'NONE REQUIRED / IDENTIFIED SIGNED ADDENDUM': 'JurisdictionAddendum',
    'PROVIDER_LEGAL_NAME / AUTHORIZED SIGNATORY': 'ProviderLegalName',
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
        : JSON.stringify(value);
const snapshotHash = snapshot => createHash('sha256').update(canonical(snapshot)).digest('hex');
const commercialFields = () => fields.map(field => ({ ...field }));

function validateValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail('Complete the agreement settings before signing.');
    if (Object.keys(values).some(key => !fields.some(field => field.key === key))) throw fail('The agreement contains an unknown setting. Refresh and try again.');
    return Object.fromEntries(fields.map(field => {
        if (typeof values[field.key] !== 'string') throw fail(`Complete ${field.label.toLowerCase()}.`);
        const value = values[field.key].normalize('NFC').trim();
        if (!value || value.length > field.maxLength || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw fail(`Enter ${field.label.toLowerCase()} using 1–${field.maxLength} characters.`);
        if (field.key === 'ReferenceLanguage' && value !== field.defaultValue) throw fail('Agreement languages cannot be changed.');
        return [field.key, value];
    }));
}

function assetPackage() {
    const pkg = JSON.parse(readFileSync(resolve(root, 'booster-service-agreement.native.json'), 'utf8'));
    const htmlSource = readFileSync(resolve(root, 'provider-agreement-native.html'), 'utf8');
    if (pkg.version !== VERSION || !htmlSource.includes(VERSION) || pkg.documents?.length !== 1
        || Buffer.from(pkg.documents[0].documentBase64 || '', 'base64').subarray(0, 5).toString() !== '%PDF-'
        || pkg.recipients?.signers?.length !== 2 || /DocuSign/i.test(htmlSource)) {
        throw new Error('The FastBoost agreement signing assets are unavailable.');
    }
    return { pkg, htmlSource };
}

function assertAssets() {
    assetPackage();
    readFileSync(resolve(root, 'fonts/NotoSans-Regular.ttf'));
}

function createSnapshot(contract, values = {}) {
    const { pkg, htmlSource } = assetPackage();
    for (const key of ['id', 'signerName', 'signerEmail', 'providerUsername', 'companySignerName', 'companySignerEmail']) {
        if (typeof contract[key] !== 'string' || !contract[key].trim()) throw fail('Complete the saved agreement identities before preparing it.');
    }
    const editable = Object.fromEntries(fields.map(field => [field.key, typeof values[field.key] === 'string' ? values[field.key] : field.defaultValue]));
    const positions = pkg.recipients.signers.flatMap(signer => Object.entries(signer.tabs).flatMap(([type, tabs]) => tabs.map(tab => ({ ...tab, type, role: signer.roleName === 'FastBoost' ? 'COMPANY' : 'BOOSTER' }))));
    return {
        version: VERSION, htmlSource, documentBase64: pkg.documents[0].documentBase64, fields: positions,
        company: { name: contract.companySignerName, email: contract.companySignerEmail },
        booster: { name: contract.signerName, email: contract.signerEmail },
        values: { ...editable, AgreementId: contract.id, ProviderLegalName: contract.signerName,
            ProviderEmail: contract.signerEmail, ProviderUsername: contract.providerUsername,
            EffectiveDate: new Date(contract.startsAt).toISOString().slice(0, 10) },
    };
}

function renderHtml(snapshot, signatures = []) {
    let html = snapshot.htmlSource.replace(/\[([^\[\]]+)\]/g, (full, key) => {
        const label = placeholders[key];
        if (!label) return full;
        const value = escape(snapshot.values[label] || full);
        return commercialFieldKeys.has(label) ? `<span data-native-field="${label}"><span data-native-value>${value}</span></span>` : value;
    });
    html = html.replace(/<div class="fb-signature-card">([\s\S]*?)<\/div>/g, (full, content) => {
        const heading = content.match(/<h3>([^<]+)<\/h3>/i)?.[1]?.trim().toUpperCase();
        const role = heading === 'FASTBOOST' ? 'COMPANY' : heading === 'PROVIDER' ? 'BOOSTER' : null;
        if (!role) throw new Error('The agreement has an unrecognized signature card.');
        const signature = signatures.find(item => item.role === role);
        let line = 0;
        const labels = ['Signature', 'Date', 'Schedule A approval / initials'];
        const values = signature ? [signature.legalName, new Date(signature.signedAt).toISOString(), signature.initials] : ['Awaiting signature', '—', '—'];
        content = content.replace(/<p class="fb-signline">[\s\S]*?<\/p>/g, () => {
            const index = line++;
            const drawing = index === 0 && signature?.signature?.type === 'drawn'
                ? `<svg viewBox="0 0 600 180" role="img" aria-label="Drawn signature" style="display:block;width:100%;max-width:300px;height:90px">${signature.signature.strokes.map(stroke => `<polyline points="${escape(stroke.map(point => point.map(Number).join(',')).join(' '))}" fill="none" stroke="#241a40" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>` : '';
            return `<p class="fb-signline">${labels[index]}: <strong>${escape(values[index])}</strong>${drawing}</p>`;
        });
        if (role === 'COMPANY') content = content.replace('An Nguyen Nguyen, trading as FastBoost', `${escape(snapshot.company.name)}, trading as FastBoost`);
        return `<div class="fb-signature-card">${content}</div>`;
    });
    // Contract-specific download controls live in the authenticated FastBoost shell.
    html = html.replace(/<button\b[^>]*data-download-agreement[^>]*>[\s\S]*?<\/button>/g, '');
    html = html.replace(/<button\b[^>]*data-print\b[^>]*>[\s\S]*?<\/button>/g, '');
    return html.replace('</head>', '<style>.fb-template{color:inherit!important;overflow-wrap:anywhere}.fb-signline strong{overflow-wrap:anywhere}a[target="_top"]{pointer-events:none}</style></head>');
}

function wrapText(text, font, size, width) {
    const lines = [];
    let line = '';
    for (const character of Array.from(String(text))) {
        if (character === '\n') { lines.push(line); line = ''; continue; }
        if (font.widthOfTextAtSize(line + character, size) > width && line) {
            const breakAt = line.lastIndexOf(' ');
            if (character !== ' ' && breakAt > 0) {
                lines.push(line.slice(0, breakAt).trimEnd());
                line = line.slice(breakAt + 1) + character;
            } else { lines.push(line.trimEnd()); line = character.trimStart(); }
        } else line += character;
    }
    lines.push(line);
    return lines;
}

function drawBoxText(page, text, box, font, label) {
    const width = Number(box.width) || 212, height = Number(box.height) || (box.type === 'signHereTabs' ? 42 : 28);
    let size = 9, lines;
    do { lines = wrapText(text, font, size, width - 8); if (lines.length * size * 1.22 <= height - 5) break; size -= .5; } while (size >= 6);
    if (size < 6) throw fail(`Shorten ${label || 'the agreement field'} so it fits in the agreement PDF.`);
    page.drawText(lines.join('\n'), { x: Number(box.xPosition) + 3, y: page.getHeight() - Number(box.yPosition) - size - 2,
        font, size, lineHeight: size * 1.22, color: rgb(.10, .09, .18) });
}

function drawSignature(page, item, box, font) {
    if (item.signature?.type !== 'drawn') return drawBoxText(page, item.legalName, { ...box, width: '212', height: '42' }, font, 'the signature name');
    const width = 208, height = 38, x = Number(box.xPosition) + 2, top = page.getHeight() - Number(box.yPosition) - 2;
    for (const stroke of item.signature.strokes || []) {
        for (let i = 1; i < stroke.length; i++) page.drawLine({
            start: { x: x + stroke[i - 1][0] / 600 * width, y: top - stroke[i - 1][1] / 180 * height },
            end: { x: x + stroke[i][0] / 600 * width, y: top - stroke[i][1] / 180 * height }, thickness: .9, color: rgb(.15, .10, .25),
        });
    }
}

async function renderPdf(snapshot, signatures = [], { completed = false } = {}) {
    const pdf = await PDFDocument.load(Buffer.from(snapshot.documentBase64, 'base64'), { updateMetadata: false });
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(readFileSync(resolve(root, 'fonts/NotoSans-Regular.ttf')), { subset: true });
    const supported = new Set(font.getCharacterSet());
    const checkCharacters = text => {
        if (Array.from(String(text)).some(character => character !== '\n' && !supported.has(character.codePointAt(0)))) throw fail('An agreement value contains a character the PDF font cannot render. Contact support before signing.');
    };
    for (const value of Object.values(snapshot.values)) checkCharacters(value);
    for (const signature of signatures) { checkCharacters(signature.legalName); checkCharacters(signature.initials); }
    for (const box of snapshot.fields) {
        const page = pdf.getPages()[Number(box.pageNumber) - 1];
        if (!page) throw new Error('The saved agreement PDF field layout is invalid.');
        const signature = signatures.find(item => item.role === box.role);
        if (box.type === 'textTabs') drawBoxText(page, snapshot.values[box.tabLabel] || '', box, font, fields.find(field => field.key === box.tabLabel)?.label);
        else if (signature && box.type === 'signHereTabs') drawSignature(page, signature, box, font);
        else if (signature && box.type === 'initialHereTabs') drawBoxText(page, signature.initials, { ...box, width: '212', height: '28' }, font);
        else if (signature && box.type === 'dateSignedTabs') drawBoxText(page, new Date(signature.signedAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC'), box, font);
        else if (box.type === 'fullNameTabs') drawBoxText(page, signature?.legalName || (box.role === 'COMPANY' ? snapshot.company.name : snapshot.booster.name), box, font);
    }
    if (completed) {
        if (!signatures.some(item => item.role === 'COMPANY') || !signatures.some(item => item.role === 'BOOSTER')) throw new Error('Both signatures are required for a completed agreement.');
        let page = pdf.addPage([612, 792]), y = 735;
        const line = (text, size = 9, gap = 7) => {
            for (const part of wrapText(text, font, size, 500)) {
                if (y < 65) { page = pdf.addPage([612, 792]); y = 735; }
                page.drawText(part, { x: 56, y, font, size, color: rgb(.10, .09, .18) }); y -= size * 1.35;
            }
            y -= gap;
        };
        line('FASTBOOST', 13); line('Electronic signing completion record', 20, 15);
        line(`Agreement: ${snapshot.values.AgreementId}`); line(`Version: ${snapshot.version}`);
        line(`Accepted document SHA-256: ${snapshotHash(snapshot)}`, 8, 14);
        const signingOrder = snapshot.version === 'FB-BSA-2.1' ? ['COMPANY', 'BOOSTER'] : ['BOOSTER', 'COMPANY'];
        for (const [index, role] of signingOrder.entries()) {
            const item = signatures.find(signature => signature.role === role);
            line(`${index + 1}. ${role === 'COMPANY' ? 'FastBoost' : 'Booster'}`, 12);
            line(`Signed by: ${item.legalName}`); line(`Account email: ${item.actorEmail || item.email || (role === 'COMPANY' ? snapshot.company.email : snapshot.booster.email)}`);
            line(`Account reference: ${item.actorId}`); line(`Signed at (UTC): ${new Date(item.signedAt).toISOString()}`);
            line(`Schedule A initials: ${item.initials} | Signature: ${item.signature?.type === 'drawn' ? 'Drawn electronically' : 'Typed electronically'}`);
            line(`Signing request: ${item.requestId}`);
            line(`Electronic consent: ${item.consentText}`, 8, 13);
        }
        line('This record documents electronic signatures collected by FastBoost. It does not assert independent identity certification or an Adobe-trusted digital signature.', 8, 10);
        line('The completed PDF and its SHA-256 digest are retained with the agreement. Later downloads return the same stored file.', 8);
    }
    pdf.setTitle(`FastBoost Booster Service Agreement - ${snapshot.version}`);
    pdf.setAuthor('FastBoost');
    return Buffer.from(await pdf.save());
}

module.exports = { VERSION, commercialFields, validateValues, assertAssets, createSnapshot, snapshotHash, renderHtml, renderPdf };
