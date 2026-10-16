const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PDFDocument } = require('pdfkit');
const { renderEarningsStatement } = require('../src/utils/earningsStatementPdf');
const base = { period:{month:'2026-09',label:'September 2026',startsAt:'2026-09-01T05:00:00Z',endsAt:'2026-10-01T05:00:00Z',closed:true},activatedAt:'2026-09-01T05:00:00Z',timeZone:'America/Winnipeg',booster:{displayName:'Nguyễn Sample'},totals:[],entries:[] };
test('closed empty periods produce a complete PDF without a current snapshot timestamp', async () => {
    const pdf = await renderEarningsStatement(base);
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    assert.match(pdf.subarray(-40).toString(),/%%EOF/);
});

test('current-period PDFs are explicitly in progress on every page and use the report snapshot time', async t => {
    const labels = [];
    const originalText = PDFDocument.prototype.text;
    t.mock.method(PDFDocument.prototype, 'text', function (...args) { labels.push(args[0]); return originalText.apply(this, args); });
    const entries = Array.from({ length: 30 }, (_, id) => ({ id, orderNumber: `CURRENT-${id}`, serviceTitle: 'Win Boost', currency: 'USD', amountCents: 700,
        kind: 'EARNED', recognizedAt: '2026-09-16T17:00:00Z' }));
    const report = { ...base, period: { ...base.period, closed: false }, asOf: '2026-09-16T18:14:25.906Z', totals: [{ currency: 'USD', amountCents: 21000 }], entries };
    const pdf = await renderEarningsStatement(report);
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.ok(pages >= 2);
    assert.equal(labels.filter(label => label === 'IN PROGRESS').length, pages);
    const expectedTime = new Intl.DateTimeFormat('en-CA', { timeZone: report.timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(report.asOf));
    assert.equal(labels.filter(label => label === `As of ${expectedTime}`).length, pages);
    assert.ok(labels.includes('Confirmed earnings to date'));
    assert.ok(labels.some(label => String(label).includes('Amounts may change')));
    assert.match(pdf.subarray(-40).toString(), /%%EOF/);
});

test('current statements reject missing or out-of-period snapshot times', () => {
    for (const asOf of [undefined, null, 'invalid', '2026-09-01T04:59:59Z', '2026-10-01T05:00:00Z']) {
        assert.throws(() => renderEarningsStatement({ ...base, period: { ...base.period, closed: false }, asOf }), /valid snapshot time/);
    }
});
test('long statements repeat the logo on every page without removed captions or standalone currency labels', async t => {
    const labels = [], images = [];
    const originalText = PDFDocument.prototype.text;
    const originalImage = PDFDocument.prototype.image;
    t.mock.method(PDFDocument.prototype, 'text', function (...args) { labels.push(args[0]); return originalText.apply(this, args); });
    t.mock.method(PDFDocument.prototype, 'image', function (...args) { images.push({ source: args[0], page: this.page }); return originalImage.apply(this, args); });
    const entries = Array.from({length:80},(_,id)=>({id,orderNumber:`TEST-${id}`,serviceTitle:'Rank Boost - a long service description that needs to wrap without clipping',currency:id%2?'CAD':'USD',amountCents:id===79?-7000:7000,kind:id===79?'ADJUSTMENT':'EARNED',recognizedAt:'2026-09-16T18:00:00Z'}));
    const pdf = await renderEarningsStatement({...base,totals:[{currency:'USD',amountCents:280000},{currency:'CAD',amountCents:266000}],entries});
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length;
    assert.ok(pages >= 3);
    const logo = path.resolve(__dirname, '../assets/branding/fastboost-logo.png');
    assert.equal(images.filter(image => image.source === logo).length, pages);
    assert.equal(new Set(images.filter(image => image.source === logo).map(image => image.page)).size, pages, 'every distinct PDF page has its logo');
    assert.equal(labels.filter(label => label === 'MONTHLY EARNINGS STATEMENT').length, pages);
    assert.ok(!labels.includes('USD') && !labels.includes('CAD'));
    assert.doesNotMatch(labels.join('\n'), /Order activity continued|Statement continued|Earnings include approved shares|This statement records earnings, not payment or payout status/i);
    assert.ok(labels.includes('Adjustment'));
    assert.match(pdf.subarray(-40).toString(),/%%EOF/);
});

test('payout labels allow only supported methods and four-character masked references', async t => {
    const labels = [];
    const originalText = PDFDocument.prototype.text;
    t.mock.method(PDFDocument.prototype, 'text', function (...args) { labels.push(args[0]); return originalText.apply(this, args); });
    for (const [method, last4, expected] of [
        ['PAYPAL', '4821', 'PayPal - •••• 4821'],
        ['CHEQUING', 'Ab19', 'Chequing - •••• Ab19'],
        ['SAVINGS', '0042', 'Savings - •••• 0042'],
    ]) {
        labels.length = 0;
        const pdf = await renderEarningsStatement({ ...base, totals: [{ currency: 'USD', amountCents: 12500 }],
            booster: { ...base.booster, payoutAccount: { method, last4,
                email: 'private-account@example.test', accountNumber: 'FULL-ACCOUNT-9876543210' } } });
        assert.equal(labels.filter(label => label === expected).length, 1);
        const total = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'USD', currencyDisplay: 'code' }).format(125);
        assert.ok(labels.includes(total), 'the right-hand total still identifies its currency');
        assert.ok(!labels.includes('USD'), 'the old standalone currency label is removed');
        assert.doesNotMatch(labels.join('\n'), /private-account|FULL-ACCOUNT|9876543210/);
        assert.match(pdf.subarray(-40).toString(), /%%EOF/);
    }
});

test('missing, malformed and inherited payout fields print only the safe fallback', async t => {
    const labels = [];
    const originalText = PDFDocument.prototype.text;
    t.mock.method(PDFDocument.prototype, 'text', function (...args) { labels.push(args[0]); return originalText.apply(this, args); });
    for (const payoutAccount of [undefined, null, {},
        { method: 'OTHER-PRIVATE-DESTINATION', last4: '1234' },
        { method: 'paypal', last4: '1234' },
        ...['constructor', 'toString', '__proto__'].map(method => ({ method, last4: '1234' })),
        ...['private-account@example.test', '9876543210123456', '123', '12345', ' 1234', '12\n34', '１２３４', 1234, ['1234']]
            .map(last4 => ({ method: 'PAYPAL', last4 })),
    ]) {
        labels.length = 0;
        await renderEarningsStatement({ ...base, totals: [{ currency: 'USD', amountCents: 100 }], booster: { ...base.booster, payoutAccount } });
        assert.equal(labels.filter(label => label === 'Payout account not set').length, 1, `Fallback for ${JSON.stringify(payoutAccount)}`);
        assert.doesNotMatch(labels.join('\n'), /PayPal -|Chequing -|Savings -|PRIVATE-DESTINATION|private-account|9876543210123456|function Object|\[object Object\]/);
    }
});
