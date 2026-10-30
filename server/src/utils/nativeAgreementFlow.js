const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const PDFDocument = require('pdfkit');
const { parseDocument } = require('htmlparser2');
const fontkit = require('@pdf-lib/fontkit');

// Presentation only: use the HTML and values accepted with this agreement,
// never today's template, and never replace its original signed PDF/hash.
const fontBytes = readFileSync(resolve(__dirname, '../../private/legal/fonts/NotoSans-Regular.ttf'));
const supportedFont = fontkit.create(fontBytes);
const fail = message => Object.assign(new Error(message), { status: 400 });
const placeholders = Object.freeze({
    AGREEMENT_ID: 'AgreementId', PROVIDER_LEGAL_NAME: 'ProviderLegalName', PROVIDER_EMAIL: 'ProviderEmail',
    PROVIDER_USERNAME: 'ProviderUsername', EFFECTIVE_DATE: 'EffectiveDate',
    'SIGNATORY_NAME_AND_TITLE / NOT APPLICABLE': 'AuthorizedSignatory',
    WORK_COUNTRY_AND_STATE_OR_PROVINCE: 'WorkLocation', END_DATE_OR_ONGOING: 'EndDate',
    PAYMENT_METHOD: 'PaymentMethod', PAYEE_LEGAL_NAME: 'PayeeLegalName', PAYOUT_CURRENCY_CODE: 'PayoutCurrency',
    'NO CONVERSION / AGREED RATE SOURCE AND QUOTE TIMING': 'ConversionRule',
    'NONE / WRITTEN REPLACEMENT RULE': 'TransferFeeVariation',
    'GAMES / SERVICES / REGIONS / PERMITTED METHODS': 'ServiceScope', PROVIDER_TIME_ZONE: 'ProviderTimeZone',
    COUNTRIES: 'DataAccessCountries', 'ENGLISH / IDENTIFY REVIEWED TRANSLATION AND AGREED CONFLICT RULE': 'ReferenceLanguage',
    'ENGLISH / VIETNAMESE': 'ReferenceLanguage',
    'NONE REQUIRED / IDENTIFIED SIGNED ADDENDUM': 'JurisdictionAddendum',
    'PROVIDER_LEGAL_NAME / AUTHORIZED SIGNATORY': 'ProviderLegalName',
});
const hasClass = (node, name) => (node.attribs?.class || '').split(/\s+/u).includes(name);
const elements = node => (node.children || []).filter(child => child.type === 'tag');
const children = node => (node.children || []).filter(child => child.type !== 'comment'
    && !(child.type === 'text' && !child.data.trim()));
function findAll(node, predicate) {
    return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => findAll(child, predicate))];
}
function exactlyOne(nodes, description) {
    if (nodes.length !== 1) throw fail(`The saved agreement ${description} is unsupported.`);
    return nodes[0];
}
function checkText(value) {
    if (Array.from(value).some(character => !/\s/u.test(character) && !supportedFont.hasGlyphForCodePoint(character.codePointAt(0)))) {
        throw fail('An agreement value contains a character the PDF font cannot render. Contact support.');
    }
    return value;
}
function displayValue(snapshot, key) {
    const value = snapshot.values[key];
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') throw fail('The saved agreement contains an invalid value.');
    if (key !== 'EffectiveDate' || !['FB-BSA-2.3', 'FB-BSA-2.4'].includes(snapshot.version) || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function readSavedContent(snapshot) {
    if (!snapshot || !['FB-BSA-2.1', 'FB-BSA-2.2', 'FB-BSA-2.3', 'FB-BSA-2.4'].includes(snapshot.version)
        || typeof snapshot.htmlSource !== 'string' || !snapshot.values || !Array.isArray(snapshot.fields)) {
        throw fail('The saved agreement HTML is unavailable or unsupported.');
    }
    const replace = text => checkText(text.replace(/\[([^\[\]]+)\]/gu, (full, marker) => {
        const key = placeholders[marker];
        if (!key) throw fail('The saved agreement contains an unsupported field marker.');
        // A draft may still contain an unfilled field. Keep its known marker,
        // matching the saved HTML view, rather than silently dropping the field.
        return displayValue(snapshot, key) || (marker === 'ENGLISH / VIETNAMESE' ? 'English/Vietnamese' : full);
    }));
    function inline(node, style = {}, root = true) {
        if (node.type === 'text') return [{ text: replace(node.data).replace(/\s+/gu, ' '), ...style }];
        if (node.type === 'comment') return [];
        if (!['p', 'h1', 'h2', 'h3', 'span', 'strong', 'b', 'em', 'i', 'a', 'br', 'td', 'th', 'li', 'div'].includes(node.name)) {
            throw fail('The saved agreement contains an unsupported inline element.');
        }
        if (!root && ['p', 'h1', 'h2', 'h3', 'td', 'th', 'li', 'div'].includes(node.name)) {
            throw fail('The saved agreement contains an unsupported nested content block.');
        }
        if (node.name === 'br') return [{ text: '\n', ...style }];
        const next = { ...style };
        if (['strong', 'b'].includes(node.name)) next.bold = true;
        if (['em', 'i'].includes(node.name)) next.italic = true;
        if (node.name === 'a') {
            const href = node.attribs?.href || '';
            if (/^(?:https?:\/\/|mailto:)/iu.test(href)) next.link = href;
            else if (!href.startsWith('#')) throw fail('The saved agreement contains an unsupported link.');
        }
        return (node.children || []).flatMap(child => inline(child, next, false));
    }
    const plain = node => inline(node).map(run => run.text).join('').trim();
    const tree = parseDocument(snapshot.htmlSource, { decodeEntities: true });
    const main = exactlyOne(findAll(tree, node => node.name === 'main' && node.attribs?.id === 'agreement-content'), 'content');
    const hero = exactlyOne(findAll(tree, node => hasClass(node, 'fb-hero')), 'introduction');
    const title = exactlyOne(findAll(hero, node => node.name === 'h1'), 'title');
    const intro = exactlyOne(findAll(hero, node => hasClass(node, 'fb-intro')), 'introduction');
    const metadata = exactlyOne(findAll(hero, node => hasClass(node, 'fb-meta')), 'metadata');
    if (children(metadata).some(node => node.name !== 'span')) throw fail('The saved agreement metadata is unsupported.');
    if (!plain(metadata).includes(snapshot.version)) throw fail('The saved agreement HTML version does not match.');
    const notes = findAll(tree, node => hasClass(node, 'fb-agreement-note'));
    if (notes.length > 1) throw fail('The saved agreement introduction is unsupported.');
    const blocks = [
        { type: 'title', runs: inline(title) },
        { type: 'meta', runs: elements(metadata).flatMap((node, index) => [...(index ? [{ text: '  |  ' }] : []), ...inline(node)]) },
        { type: 'paragraph', runs: inline(intro) },
        ...notes.map(node => ({ type: 'small', runs: inline(node) })),
    ];

    function table(node) {
        const content = children(node);
        if (content.length !== 1 || content[0].name !== 'table') throw fail('The saved agreement table wrapper is unsupported.');
        const tableNode = content[0], rows = [];
        for (const part of children(tableNode)) {
            if (!['thead', 'tbody', 'tr'].includes(part.name)) throw fail('The saved agreement table structure is unsupported.');
            const rowNodes = part.name === 'tr' ? [part] : children(part);
            for (const row of rowNodes) {
                if (row.name !== 'tr') throw fail('The saved agreement table row is unsupported.');
                const cells = children(row);
                if (cells.length !== 2 || cells.some(cell => !['th', 'td'].includes(cell.name)
                    || (cell.attribs?.colspan && cell.attribs.colspan !== '1') || (cell.attribs?.rowspan && cell.attribs.rowspan !== '1'))) {
                    throw fail('The saved agreement table columns are unsupported.');
                }
                rows.push({ header: cells.every(cell => cell.name === 'th'), cells: cells.map(cell => inline(cell)) });
            }
        }
        if (rows.length < 2 || !rows[0].header || rows.slice(1).some(row => row.header)) throw fail('The saved agreement table header is unsupported.');
        return { type: 'table', rows };
    }
    function list(node, depth = 0) {
        if (depth > 4) throw fail('The saved agreement list nesting is unsupported.');
        const result = [];
        for (const [index, item] of children(node).entries()) {
            if (item.name !== 'li') throw fail('The saved agreement list is unsupported.');
            let runs = [], started = false;
            const flush = () => {
                if (!runs.length) return;
                result.push({ type: 'paragraph', runs, indent: 14 * (depth + 1), bullet: started ? '' : node.name === 'ol' ? `${index + 1}.` : '•' });
                started = true; runs = [];
            };
            for (const child of item.children || []) {
                if (['ul', 'ol'].includes(child.name)) { flush(); result.push(...list(child, depth + 1)); }
                else if (child.name === 'p') { flush(); runs = inline(child); flush(); }
                else runs.push(...inline(child));
            }
            flush();
        }
        return result;
    }
    const anchors = snapshot.fields.filter(field => field.type === 'signHereTabs').slice().sort((a, b) => Number(a.xPosition) - Number(b.xPosition));
    if (anchors.length !== 2 || new Set(anchors.map(anchor => anchor.role)).size !== 2
        || anchors.some(anchor => !['COMPANY', 'BOOSTER'].includes(anchor.role) || !Number.isFinite(Number(anchor.xPosition)))) {
        throw fail('The saved agreement signature layout is unsupported.');
    }
    function signatures(node) {
        const cards = children(node);
        if (cards.length !== 2) throw fail('The saved agreement signature cards are unsupported.');
        cards.forEach((card, index) => {
            if (!hasClass(card, 'fb-signature-card')) throw fail('The saved agreement signature cards are unsupported.');
            const parts = children(card), heading = parts[0];
            if (parts.length !== 5 || heading.name !== 'h3' || plain(heading) !== (anchors[index].role === 'COMPANY' ? 'FASTBOOST' : 'PROVIDER')
                || parts.slice(1).some(part => part.name !== 'p') || hasClass(parts[1], 'fb-signline')) {
                throw fail('The saved agreement signature content is unsupported.');
            }
            inline(parts[1]);
            ['Signature', 'Date', 'Schedule A approval / initials'].forEach((label, position) => {
                const part = parts[position + 2];
                if (!hasClass(part, 'fb-signline') || !plain(part).startsWith(`${label}:`) || !/^_+$/u.test(plain(part).slice(label.length + 1).trim())) {
                    throw fail('The saved agreement signature fields are unsupported.');
                }
            });
        });
        return { type: 'signatures', notes: [] };
    }
    let signatureBlock, sectionCount = 0;
    const seen = new Set();
    for (const section of children(main)) {
        if (notes.includes(section)) continue; // Already retained below the introduction.
        // These are website navigation/overview, not accepted clauses. They
        // were also omitted by the original PDF export of these versions.
        if (hasClass(section, 'fb-mobile-contents') || hasClass(section, 'fb-summary') || hasClass(section, 'fb-end')) continue;
        if (section.name !== 'section' || !hasClass(section, 'fb-section') || !section.attribs?.id || seen.has(section.attribs.id)) {
            throw fail('The saved agreement contains an unsupported content block.');
        }
        if (signatureBlock) throw fail('The saved agreement contains content after its signatures.');
        seen.add(section.attribs.id); sectionCount++;
        const parts = children(section), heading = parts.shift();
        if (!heading || !hasClass(heading, 'fb-section-heading')) throw fail('The saved agreement section heading is unsupported.');
        const headingParts = children(heading);
        if (headingParts.some(part => !(part.name === 'span' && hasClass(part, 'fb-section-number')) && part.name !== 'h2'
            && !(part.name === 'a' && hasClass(part, 'fb-permalink')))) throw fail('The saved agreement section heading is unsupported.');
        const number = plain(exactlyOne(headingParts.filter(part => hasClass(part, 'fb-section-number')), 'section number'));
        const headingText = plain(exactlyOne(headingParts.filter(part => part.name === 'h2'), 'section title'));
        if (section.attribs.id === 'schedule-a') blocks.push({ type: 'pageBreak' });
        blocks.push({ type: 'heading', runs: [{ text: number === 'A' && headingText.startsWith('Schedule A') ? headingText : `${number}  ${headingText}` }] });
        for (const part of parts) {
            if (part.name === 'p') {
                const paragraph = { type: hasClass(part, 'fb-sources') ? 'small' : 'paragraph', runs: inline(part) };
                if (signatureBlock) signatureBlock.notes.push(paragraph);
                else blocks.push(paragraph);
            } else if (hasClass(part, 'fb-table-wrap')) {
                if (signatureBlock) throw fail('The saved agreement signature note is unsupported.');
                blocks.push(table(part));
            } else if (['ul', 'ol'].includes(part.name)) {
                if (signatureBlock) throw fail('The saved agreement signature note is unsupported.');
                blocks.push(...list(part));
            } else if (hasClass(part, 'fb-signatures') && section.attribs.id === 'signatures' && !signatureBlock) {
                signatureBlock = signatures(part); blocks.push(signatureBlock);
            } else throw fail('The saved agreement contains an unsupported section block.');
        }
    }
    if (sectionCount !== 19 || !seen.has('parties') || !seen.has('schedule-a') || !seen.has('signatures') || !signatureBlock) {
        throw fail('The saved agreement sections are incomplete.');
    }
    return { blocks, anchors };
}

async function renderAgreementFlow(snapshot, { signatureHeight = 190 } = {}) {
    if (!Number.isFinite(signatureHeight) || signatureHeight < 100 || signatureHeight > 350) throw fail('The signature presentation height is invalid.');
    const { blocks, anchors } = readSavedContent(snapshot);
    const doc = new PDFDocument({ autoFirstPage: false, size: 'LETTER', margins: { top: 0, left: 0, right: 0, bottom: 0 },
        info: { Title: `FastBoost Booster Service Agreement - ${snapshot.version}`, Author: 'FastBoost' } });
    const chunks = [];
    const output = new Promise((resolveOutput, reject) => {
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolveOutput(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
    doc.registerFont('body', fontBytes).font('body');
    const left = 54, width = 504, pageTop = 64, pageBottom = 726;
    const colors = { ink: '#1a1730', muted: '#59566c', accent: '#6740c8', border: '#dcd7e8' };
    let y = pageTop, pageNumber = 0, signatureLayout;
    function text(textValue, x, top, size, color = colors.ink, extra = {}) {
        doc.save().lineWidth(.18).strokeColor(color).font('body').fontSize(size).fillColor(color)
            .text(textValue, x, top, { lineBreak: false, ...extra }).restore();
    }
    function newPage() {
        doc.addPage(); pageNumber++; y = pageTop;
        doc.save().lineWidth(.5).strokeColor(colors.border).moveTo(left, 46).lineTo(left + width, 46).stroke();
        doc.moveTo(left, 746).lineTo(left + width, 746).stroke().restore();
        text('FASTBOOST  /  BOOSTER SERVICE AGREEMENT', left, 27, 8, colors.accent);
        doc.fontSize(8); text(snapshot.version, left + width - doc.widthOfString(snapshot.version), 27, 8, colors.muted);
        text('Complete required details before signing. Retain the completed agreement.', left, 755, 7, colors.muted);
        const page = `Page ${pageNumber}`; doc.fontSize(7);
        text(page, left + width - doc.widthOfString(page), 755, 7, colors.muted);
    }
    function ensure(height) {
        if (height > pageBottom - pageTop) throw fail('The saved agreement content cannot fit on a PDF page.');
        if (y + height > pageBottom) newPage();
    }
    function linesFor(runs, availableWidth, size) {
        doc.font('body').fontSize(size);
        const lines = []; let line = [], used = 0, space;
        const flush = () => { lines.push(line); line = []; used = 0; space = undefined; };
        const append = (run, value) => {
            const measured = doc.widthOfString(value);
            if (line.length && used + measured > availableWidth + .01) flush();
            line.push({ ...run, text: value, width: measured }); used += measured;
        };
        for (const run of runs) {
            for (const token of run.text.match(/\n|[^\S\n]+|[^\s]+/gu) || []) {
                if (token === '\n') { flush(); continue; }
                if (/^\s+$/u.test(token)) { if (line.length) space = { ...run, text: ' ' }; continue; }
                const tokenWidth = doc.widthOfString(token), spaceWidth = space && line.length ? doc.widthOfString(' ') : 0;
                if (line.length && used + spaceWidth + tokenWidth > availableWidth + .01) flush();
                if (space && line.length) append(space, ' ');
                space = undefined;
                if (tokenWidth <= availableWidth) append(run, token);
                else {
                    let fragment = '';
                    for (const character of token) {
                        if (fragment && doc.widthOfString(fragment + character) > availableWidth) { append(run, fragment); flush(); fragment = ''; }
                        fragment += character;
                    }
                    if (fragment) append(run, fragment);
                }
            }
        }
        if (line.length) lines.push(line);
        return lines;
    }
    function drawLines(lines, x, top, size, lineHeight, color = colors.ink, bold = false) {
        for (const [index, line] of lines.entries()) {
            let cursor = x;
            for (const run of line) {
                text(run.text, cursor, top + index * lineHeight, size, run.link ? colors.accent : color,
                    { fill: true, stroke: Boolean(bold || run.bold), ...(run.italic ? { oblique: 12 } : {}),
                        ...(run.link ? { link: run.link, underline: true } : {}) });
                cursor += run.width;
            }
        }
    }
    const styleFor = type => type === 'title' ? { size: 25, leading: 31, after: 12, bold: true }
        : type === 'heading' ? { size: 13, leading: 18, before: 15, after: 9, color: colors.accent, bold: true }
            : ['small', 'meta'].includes(type) ? { size: 8, leading: 12, after: 9, color: colors.muted }
                : { size: 9.5, leading: 14, after: 9 };
    function paragraph(block) {
        const style = styleFor(block.type), indent = block.indent || 0;
        const lines = linesFor(block.runs, width - indent, style.size);
        const before = y > pageTop ? style.before || 0 : 0;
        // Keep headings with at least two lines of following content.
        ensure(before + Math.min(lines.length, block.type === 'heading' ? lines.length : 2) * style.leading + (block.type === 'heading' ? style.after + 28 : 0));
        if (y > pageTop) y += style.before || 0;
        for (let index = 0; index < lines.length;) {
            const room = Math.floor((pageBottom - y) / style.leading);
            if (!room) { newPage(); continue; }
            const count = Math.min(room, lines.length - index);
            if (index === 0 && block.bullet) text(block.bullet, left + indent - 13, y, style.size);
            drawLines(lines.slice(index, index + count), left + indent, y, style.size, style.leading, style.color, style.bold);
            y += count * style.leading; index += count;
            if (index < lines.length) newPage();
        }
        y += style.after;
    }
    function table(block) {
        const columnWidths = [170, 334], padding = 10, size = 9, leading = 13;
        const rows = block.rows.map(row => ({ ...row, lines: row.cells.map((runs, index) => linesFor(runs, columnWidths[index] - padding * 2, size)) }));
        rows.forEach(row => { row.height = Math.max(...row.lines.map(lines => lines.length), 1) * leading + padding * 2; });
        const header = rows[0];
        const paint = (row, index) => {
            doc.save().fillColor(row.header ? '#eee9fa' : index % 2 === 0 ? '#f8f7fc' : '#ffffff')
                .rect(left, y, width, row.height).fill().lineWidth(.5).strokeColor(colors.border).rect(left, y, width, row.height).stroke().restore();
            row.lines.forEach((lines, column) => drawLines(lines, left + (column ? columnWidths[0] : 0) + padding, y + padding, size, leading, colors.ink, row.header));
            y += row.height;
        };
        ensure(header.height + rows[1].height); paint(header, 0);
        for (let index = 1; index < rows.length; index++) {
            const row = rows[index];
            if (row.height + header.height > pageBottom - pageTop) throw fail('A saved agreement table row cannot fit on a PDF page.');
            if (y + row.height > pageBottom) { newPage(); paint(header, 0); }
            paint(row, index);
        }
        y += 12;
    }
    try {
        newPage();
        for (const block of blocks) {
            if (block.type === 'pageBreak') { if (y > pageTop) newPage(); }
            else if (block.type === 'table') table(block);
            else if (block.type === 'signatures') {
                const noteHeight = block.notes.reduce((total, note) => {
                    const style = styleFor(note.type);
                    return total + linesFor(note.runs, width, style.size).length * style.leading + style.after;
                }, 0);
                ensure(signatureHeight + 8 + noteHeight);
                signatureLayout = { pageNumber, left, top: y, width, height: signatureHeight,
                    ordered: anchors.map((anchor, index) => ({ role: anchor.role, xPosition: left + index * 252 })) };
                y += signatureHeight + 8;
                for (const note of block.notes) paragraph(note);
            } else paragraph(block);
        }
        doc.end();
        return { pdf: await output, signatureLayout };
    } catch (error) {
        doc.destroy();
        // Consume any stream rejection before propagating the layout error.
        output.catch(() => {});
        throw error;
    }
}

module.exports = { renderAgreementFlow };
