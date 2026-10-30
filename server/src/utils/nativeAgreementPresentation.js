const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PDFDocument, PDFArray, PDFName, decodePDFRawStream, rgb, degrees } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const fontRoot = resolve(__dirname, '../../private/legal/fonts');
const fail = message => Object.assign(new Error(message), { status: 400 });
const near = (left, right) => Math.abs(left - right) < .01;
const ink = rgb(.12, .10, .20);
const muted = rgb(.40, .38, .47);
const accent = rgb(.40, .25, .69);

// Parse only token boundaries. Strings, names and comments must never be
// mistaken for q/Q graphics operators while locating the saved signature table.
function tokens(source) {
    const result = [];
    let cursor = 0;
    const delimiter = character => !character || /[\s\x00()[\]<>/%{}]/u.test(character);
    while (cursor < source.length) {
        if (/[\s\x00]/u.test(source[cursor])) { cursor++; continue; }
        if (source[cursor] === '%') { while (cursor < source.length && !/[\r\n]/u.test(source[cursor])) cursor++; continue; }
        const start = cursor;
        if (source[cursor] === '(') {
            let depth = 1; cursor++;
            while (cursor < source.length && depth) {
                if (source[cursor] === '\\') { cursor += 2; continue; }
                if (source[cursor] === '(') depth++;
                if (source[cursor] === ')') depth--;
                cursor++;
            }
            if (depth) throw fail('The saved agreement PDF contains an incomplete text value.');
        } else if (source[cursor] === '<' && source[cursor + 1] !== '<') {
            const end = source.indexOf('>', cursor + 1);
            if (end < 0) throw fail('The saved agreement PDF contains an incomplete text value.');
            cursor = end + 1;
        } else if (source[cursor] === '/') {
            cursor++; while (cursor < source.length && !delimiter(source[cursor])) cursor++;
        } else if (delimiter(source[cursor])) {
            cursor++;
        } else {
            while (cursor < source.length && !delimiter(source[cursor])) cursor++;
        }
        result.push({ value: source.slice(start, cursor), start, end: cursor });
    }
    return result;
}

function layoutFor(snapshot, pdf) {
    const anchors = snapshot.fields?.filter(field => field.type === 'signHereTabs') || [];
    if (anchors.length !== 2 || new Set(anchors.map(field => field.role)).size !== 2
        || anchors.some(field => !['COMPANY', 'BOOSTER'].includes(field.role))) {
        throw fail('The saved agreement signature layout is unavailable.');
    }
    const ordered = [...anchors].sort((left, right) => Number(left.xPosition) - Number(right.xPosition));
    const pageNumber = Number(ordered[0].pageNumber);
    const page = pdf.getPages()[pageNumber - 1];
    const left = Number(ordered[0].xPosition) - 16;
    const top = Number(ordered[0].yPosition) - 105;
    if (!Number.isInteger(pageNumber) || !page || ordered.some(field => Number(field.pageNumber) !== pageNumber)
        || !near(Number(ordered[1].xPosition) - Number(ordered[0].xPosition), 252)
        || !near(Number(ordered[1].yPosition), Number(ordered[0].yPosition))
        || !Number.isFinite(left) || !Number.isFinite(top) || left < 0 || top < 0
        || left + 504 > page.getWidth() || top + 287 > page.getHeight()) {
        throw fail('The saved agreement signature layout cannot be displayed safely.');
    }
    return { page, pageNumber, left, top, bottom: page.getHeight() - top - 287, width: 504, height: 287, ordered };
}

function removeSavedSignatureTable(pdf, layout) {
    const contents = layout.page.node.Contents();
    const references = contents instanceof PDFArray ? contents.asArray() : [contents];
    const matches = [];
    const decoded = references.map(reference => {
        const stream = pdf.context.lookup(reference);
        return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    });
    decoded.forEach((source, streamIndex) => {
        const list = tokens(source), stack = [];
        for (let index = 0; index < list.length; index++) {
            if (list[index].value === 'q') stack.push(index);
            if (list[index].value !== 'Q') continue;
            const first = stack.pop();
            if (first === undefined) throw fail('The saved agreement PDF graphics are unbalanced.');
            const matrix = list.slice(first + 1, first + 8).map(token => token.value);
            if (matrix.length !== 7 || matrix[6] !== 'cm'
                || ![1, 0, 0, 1, layout.left, layout.bottom].every((value, offset) => near(Number(matrix[offset]), value))) continue;
            const start = list[first].start, end = list[index].end;
            const group = source.slice(start, end);
            if (!['FASTBOOST', 'PROVIDER', 'Signature', 'Date', 'Schedule A approval / initials'].every(text => group.includes(`(${text})`))) continue;
            // The legacy table has two 252pt cells and a 287pt outside border.
            // Validate its extent before removing any saved PDF operators.
            if (!/n\s+0\s+287\s+m\s+504\s+287\s+l\s+S/u.test(group)
                || !/n\s+252\s+0\s+m\s+252\s+287\s+l\s+S/u.test(group)) continue;
            matches.push({ streamIndex, start, end });
        }
        if (stack.length) throw fail('The saved agreement PDF graphics are unbalanced.');
    });
    if (matches.length !== 1) throw fail('The saved agreement signature table cannot be identified safely.');
    const { streamIndex, start, end } = matches[0];
    const source = decoded[streamIndex];
    const replacement = pdf.context.register(pdf.context.flateStream(Buffer.from(source.slice(0, start) + source.slice(end), 'latin1')));
    const updated = references.map((reference, index) => index === streamIndex ? replacement : reference);
    layout.page.node.set(PDFName.of('Contents'), pdf.context.obj(updated));
}

function wrap(text, font, size, width) {
    const lines = []; let line = '';
    for (const character of Array.from(String(text))) {
        if (character === '\n') { lines.push(line); line = ''; continue; }
        if (font.widthOfTextAtSize(line + character, size) > width && line) {
            const space = line.lastIndexOf(' ');
            if (character !== ' ' && space > 0) { lines.push(line.slice(0, space).trimEnd()); line = line.slice(space + 1) + character; }
            else { lines.push(line.trimEnd()); line = character.trimStart(); }
        } else line += character;
    }
    lines.push(line);
    return lines;
}

function fit(text, font, { width, height, size, minimum = 6, leading = 1.2 }) {
    for (let current = size; current >= minimum; current -= .25) {
        const lines = wrap(text, font, current, width);
        const lineHeight = Math.max(font.heightAtSize(current), current) * leading;
        if (lines.every(line => font.widthOfTextAtSize(line, current) <= width + .01)
            && lines.length * lineHeight <= height) return { lines, size: current, lineHeight };
    }
    throw fail('An agreement value is too long for its PDF display. Contact support.');
}

// Commercial values retain the canonical renderer's fitting, baseline and
// leading. A presentation change must not reject a previously accepted field.
function drawSavedField(page, text, field, font) {
    const width = Number(field.width) || 212, height = Number(field.height) || 28;
    let size = 9, lines;
    do {
        lines = wrap(text, font, size, width - 8);
        if (lines.length * size * 1.22 <= height - 5) break;
        size -= .5;
    } while (size >= 6);
    if (size < 6) throw fail('An agreement value is too long for its saved PDF field. Contact support.');
    page.drawText(lines.join('\n'), { x: Number(field.xPosition) + 3, y: page.getHeight() - Number(field.yPosition) - size - 2,
        font, size, lineHeight: size * 1.22, color: rgb(.10, .09, .18) });
}

function textBox(page, text, font, { x, top, width, height, size = 9, minimum = 6, color = ink, center = false, italic = false }) {
    // Reserve both sides for slanted ascenders/descenders before fitting. In
    // pdf-lib, ySkew changes the horizontal glyph slant while keeping baselines level.
    const slant = italic ? font.heightAtSize(size) * Math.tan(10 * Math.PI / 180) : 0;
    const fitted = fit(text, font, { width: width - slant * 2, height, size, minimum });
    const total = fitted.lines.length * fitted.lineHeight;
    const firstTop = center ? top - (height - total) / 2 : top;
    fitted.lines.forEach((line, index) => page.drawText(line, {
        x: center ? x + (width - font.widthOfTextAtSize(line, fitted.size)) / 2 : x + slant,
        y: firstTop - font.heightAtSize(fitted.size, { descender: false }) - index * fitted.lineHeight,
        font, size: fitted.size, color, ySkew: degrees(italic ? 10 : 0),
    }));
}

function roundedBox(page, x, top, width, height, radius, color, borderColor, borderWidth = .6) {
    const r = Math.min(radius, width / 2, height / 2), w = width, h = height;
    page.drawSvgPath(`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`,
        { x, y: top, color, borderColor, borderWidth });
}

function dateLines(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw fail('The saved signature date is invalid.');
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)
        + '\n' + new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date) + ' UTC';
}

function drawCard(page, anchor, layout, signature, bodyFont, scriptFont) {
    const x = Number(anchor.xPosition) - 12, top = page.getHeight() - layout.top - 2;
    const width = 244, height = 283, padding = 14, inner = width - padding * 2;
    roundedBox(page, x, top, width, height, 10, rgb(.987, .982, 1), rgb(.80, .76, .87));
    textBox(page, anchor.role === 'COMPANY' ? 'FASTBOOST' : 'PROVIDER', bodyFont,
        { x: x + padding, top: top - 15, width: 112, height: 20, size: 10, color: accent });
    const status = signature ? 'Signed' : 'Awaiting signature';
    const badgeWidth = bodyFont.widthOfTextAtSize(status, 7.5) + (signature ? 24 : 16);
    const badgeLeft = x + width - padding - badgeWidth;
    roundedBox(page, badgeLeft, top - 11, badgeWidth, 20, 10, signature ? rgb(.92, .97, .94) : rgb(.96, .95, .98),
        signature ? rgb(.66, .82, .72) : rgb(.82, .80, .87));
    if (signature) {
        page.drawLine({ start: { x: badgeLeft + 7, y: top - 21 }, end: { x: badgeLeft + 10, y: top - 24 }, thickness: 1, color: rgb(.19, .45, .31) });
        page.drawLine({ start: { x: badgeLeft + 10, y: top - 24 }, end: { x: badgeLeft + 15, y: top - 18 }, thickness: 1, color: rgb(.19, .45, .31) });
    }
    textBox(page, status, bodyFont, { x: badgeLeft + (signature ? 19 : 8), top: top - 16, width: badgeWidth - (signature ? 24 : 16), height: 12, size: 7.5,
        color: signature ? rgb(.19, .40, .29) : muted });
    const markX = x + padding, markTop = top - 46, markHeight = 112;
    roundedBox(page, markX, markTop, inner, markHeight, 7, rgb(1, 1, 1), rgb(.83, .80, .89));
    page.drawLine({ start: { x: markX + 14, y: markTop - markHeight + 15 }, end: { x: markX + inner - 14, y: markTop - markHeight + 15 },
        thickness: .5, color: rgb(.86, .84, .91) });
    if (!signature) {
        textBox(page, 'Signature pending', bodyFont, { x: markX + 12, top: markTop - 12, width: inner - 24, height: 80, size: 10, color: muted, center: true });
    } else if (signature.signature?.type === 'drawn') {
        const scale = Math.min((inner - 28) / 600, 76 / 180);
        const left = markX + (inner - 600 * scale) / 2, drawingTop = markTop - 10 - (76 - 180 * scale) / 2;
        let points = 0;
        for (const stroke of signature.signature.strokes || []) {
            if (!Array.isArray(stroke)) throw fail('The saved drawn signature is invalid.');
            for (const point of stroke) {
                if (++points > 6000 || !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value))
                    || point[0] < 0 || point[0] > 600 || point[1] < 0 || point[1] > 180) throw fail('The saved drawn signature is invalid.');
            }
            for (let index = 1; index < stroke.length; index++) page.drawLine({
                start: { x: left + stroke[index - 1][0] * scale, y: drawingTop - stroke[index - 1][1] * scale },
                end: { x: left + stroke[index][0] * scale, y: drawingTop - stroke[index][1] * scale }, thickness: 1, color: ink,
            });
        }
        if (!points) throw fail('The saved drawn signature is empty.');
    } else {
        textBox(page, signature.legalName, scriptFont, { x: markX + 12, top: markTop - 10, width: inner - 24, height: 80, size: 26, minimum: 8, center: true,
            italic: (signature.signature?.style ?? 1) === 1 });
    }
    const detailTop = top - 174, nameWidth = 121, dateX = x + padding + 133;
    textBox(page, 'Signed by', bodyFont, { x: x + padding, top: detailTop, width: nameWidth, height: 12, size: 7.5, color: muted });
    textBox(page, 'Date', bodyFont, { x: dateX, top: detailTop, width: 83, height: 12, size: 7.5, color: muted });
    const signer = signature ? signature.legalName + (anchor.role === 'COMPANY' ? ', trading as FastBoost' : '') : '—';
    textBox(page, signer, bodyFont, { x: x + padding, top: detailTop - 16, width: nameWidth, height: 61, size: 8.5, minimum: 6.5 });
    textBox(page, signature ? dateLines(signature.signedAt) : '—', bodyFont, { x: dateX, top: detailTop - 16, width: 83, height: 40, size: 8.2 });
    if (signature?.initials) textBox(page, `Schedule A initials: ${signature.initials}`, bodyFont,
        { x: x + padding, top: top - height + 22, width: inner, height: 17, size: 7.5, color: muted });
}

function displayValue(snapshot, key) {
    const value = snapshot.values[key] || '';
    if (!['FB-BSA-2.3', 'FB-BSA-2.4'].includes(snapshot.version) || key !== 'EffectiveDate' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

async function renderPresentationPdf(snapshot, signatures = [], { completed = false } = {}) {
    if (signatures.some(item => !['COMPANY', 'BOOSTER'].includes(item.role)) || new Set(signatures.map(item => item.role)).size !== signatures.length) {
        throw fail('The saved agreement signatures are invalid.');
    }
    if (completed && !['COMPANY', 'BOOSTER'].every(role => signatures.some(item => item.role === role))) throw fail('Both signatures are required for a completed agreement.');
    const pdf = await PDFDocument.load(Buffer.from(snapshot.documentBase64, 'base64'), { updateMetadata: false });
    const layout = layoutFor(snapshot, pdf);
    removeSavedSignatureTable(pdf, layout);
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(readFileSync(resolve(fontRoot, 'NotoSans-Regular.ttf')), { subset: true });
    const supports = (text, selectedFont) => {
        const characters = new Set(selectedFont.getCharacterSet());
        return Array.from(String(text)).every(character => character === '\n' || characters.has(character.codePointAt(0)));
    };
    const check = (text, selectedFont) => {
        if (!supports(text, selectedFont)) throw fail('An agreement value contains a character the PDF font cannot render. Contact support.');
    };
    for (const value of Object.values(snapshot.values)) check(value, font);
    const scripts = new Map(), signatureFonts = new Map();
    for (const signature of signatures) {
        if (typeof signature.legalName !== 'string' || !signature.legalName.trim()) throw fail('The saved signature name is missing.');
        check(signature.legalName, font); check(signature.initials || '', font);
        if (signature.signature?.type === 'drawn') continue;
        const style = signature.signature?.style ?? 1;
        if (![1, 2, 3].includes(style)) throw fail('The saved signature style is invalid.');
        const filename = style === 3 ? 'GreatVibes-Regular.ttf' : 'DancingScript.ttf';
        if (!scripts.has(filename)) scripts.set(filename, await pdf.embedFont(readFileSync(resolve(fontRoot, filename)), { subset: true }));
        // Original typed signatures were accepted with Noto Sans, including
        // alphabets outside Dancing Script. Their new display must remain
        // deliverable without changing the recorded name or signature style.
        const selectedFont = style === 1 && !supports(signature.legalName, scripts.get(filename)) ? font : scripts.get(filename);
        check(signature.legalName, selectedFont);
        signatureFonts.set(signature.role, selectedFont);
    }
    for (const field of snapshot.fields) {
        if (field.type !== 'textTabs') continue;
        const page = pdf.getPages()[Number(field.pageNumber) - 1];
        if (!page) throw fail('The saved agreement PDF field layout is invalid.');
        drawSavedField(page, displayValue(snapshot, field.tabLabel), field, font);
    }
    for (const anchor of layout.ordered) {
        const signature = signatures.find(item => item.role === anchor.role);
        drawCard(layout.page, anchor, layout, signature, font, signatureFonts.get(anchor.role));
    }
    pdf.setTitle(`FastBoost Booster Service Agreement - ${snapshot.version}`);
    pdf.setAuthor('FastBoost');
    return Buffer.from(await pdf.save());
}

module.exports = { renderPresentationPdf };
