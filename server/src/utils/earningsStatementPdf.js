const path = require('node:path');
const { PDFDocument } = require('pdfkit');

function renderEarningsStatement(report) {
    if (typeof report?.period?.closed !== 'boolean') throw new Error('Monthly statements require a valid period');
    const inProgress = !report.period.closed;
    const asOf = new Date(report.asOf);
    if (inProgress && !(asOf >= new Date(report.period.startsAt) && asOf < new Date(report.period.endsAt))) {
        throw new Error('Current-period statements require a valid snapshot time within the period');
    }
    const timeZone = report.timeZone || 'America/Winnipeg';
    const payoutMethods = { PAYPAL: 'PayPal', CHEQUING: 'Chequing', SAVINGS: 'Savings' };
    const payoutAccount = report.booster?.payoutAccount;
    const payoutMethod = typeof payoutAccount?.method === 'string' && Object.hasOwn(payoutMethods, payoutAccount.method) ? payoutMethods[payoutAccount.method] : null;
    const payoutReference = payoutMethod && typeof payoutAccount?.last4 === 'string' && /^[A-Za-z0-9]{4}$/.test(payoutAccount.last4)
        ? `${payoutMethod} - •••• ${payoutAccount.last4}` : 'Payout account not set';
    const date = value => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
    const snapshotLabel = inProgress ? `As of ${new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(asOf)}` : '';
    const amount = (cents, currency) => {
        if (!Number.isSafeInteger(cents)) throw new Error('Invalid statement amount');
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'code' }).format(cents / 100);
    };
    const document = new PDFDocument({ size: 'LETTER', margin: 38, bufferPages: true,
        info: { Title: `FastBoost earnings - ${report.period.label}`, Author: 'FastBoost', Subject: 'Monthly booster earnings statement' } });
    document.registerFont('Body', path.resolve(__dirname, '../../assets/fonts/NotoSans-Regular.ttf'));
    document.registerFont('Bold', path.resolve(__dirname, '../../assets/fonts/NotoSans-Bold.ttf'));
    const chunks = [];
    const result = new Promise((resolve, reject) => {
        document.on('data', chunk => chunks.push(chunk));
        document.on('end', () => resolve(Buffer.concat(chunks)));
        document.on('error', reject);
    });
    const left = 38, right = 574, width = right - left, bottom = 720;
    let y;
    const text = (value, x, top, options = {}) => document.text(String(value ?? ''), x, top, options);
    function header() {
        document.rect(0, 0, 612, 94).fill('#17132c');
        document.rect(0, 94, 612, 4).fill('#8750dd');
        document.image(path.resolve(__dirname, '../../assets/branding/fastboost-logo.png'), left, 25, { fit: [60, 44], align: 'center', valign: 'center' });
        document.font('Bold').fontSize(22).fillColor('#ffffff'); text('FastBoost', left + 72, 23);
        document.font('Body').fontSize(9).fillColor('#d6c9ef'); text('MONTHLY EARNINGS STATEMENT', left + 72, 57);
        document.font('Bold').fontSize(11); text(report.period.label, 350, 35, { width: 224, align: 'right' });
        if (inProgress) {
            document.font('Bold').fontSize(8).fillColor('#f5d39c'); text('IN PROGRESS', 350, 54, { width: 224, align: 'right' });
            document.font('Body').fontSize(7.5).fillColor('#d6c9ef'); text(snapshotLabel, 320, 70, { width: 254, align: 'right' });
        }
        y = 120;
    }
    function tableHeader() {
        document.roundedRect(left, y, width, 28, 4).fill('#eee9f7');
        document.font('Bold').fontSize(8).fillColor('#46325f');
        text('DATE', left + 9, y + 8); text('ORDER / SERVICE', left + 81, y + 8);
        text('TYPE', left + 311, y + 8); text('EARNINGS', left + 387, y + 8, { width: 140, align: 'right' });
        y += 34;
    }
    header();
    document.font('Bold').fontSize(18).fillColor('#241a3c');
    const displayName = String(report.booster?.displayName || 'Booster').slice(0, 160);
    const nameHeight = document.heightOfString(displayName, { width });
    text(displayName, left, y, { width }); y += nameHeight + 10;
    document.font('Body').fontSize(9).fillColor('#686177');
    text(`${date(report.period.startsAt)} - ${date(new Date(report.period.endsAt).getTime() - 1)}`, left, y, { width }); y += 24;
    if (inProgress) {
        text('Current period - in progress. Amounts may change as more earnings are approved or adjusted.', left, y, { width, lineGap: 3 });
        y = document.y + 18;
    }
    if (new Date(report.activatedAt) > new Date(report.period.startsAt)) {
        text(`Tracking began ${date(report.activatedAt)}. Earlier earnings are held separately as an opening balance.`, left, y, { width, lineGap: 3 });
        y = document.y + 18;
    }
    document.font('Bold').fontSize(11).fillColor('#241a3c'); text(inProgress ? 'Confirmed earnings to date' : 'Confirmed earnings', left, y); y += 23;
    const totals = report.totals || [];
    if (!totals.length) {
        document.font('Body').fontSize(11).fillColor('#686177'); text('No earnings recorded in this period.', left, y); y += 32;
    }
    for (const total of totals) {
        if (y + 46 > bottom) { document.addPage(); header(); }
        document.roundedRect(left, y, width, 38, 5).fill('#f6f3fb');
        document.font('Bold').fontSize(10.5).fillColor('#686177'); text(payoutReference, left + 13, y + 11, { width: 260, lineBreak: false, ellipsis: true });
        document.font('Bold').fontSize(15).fillColor('#47246f'); text(amount(total.amountCents, total.currency), right - 233, y + 8, { width: 220, align: 'right' });
        y += 46;
    }
    y += 16;
    if (y + 90 > bottom) { document.addPage(); header(); }
    tableHeader();
    const entries = report.entries || [];
    if (!entries.length) {
        document.font('Body').fontSize(10).fillColor('#686177'); text('No order activity in this period.', left + 9, y + 8); y += 35;
    }
    for (const entry of entries) {
        const orderLabel = `#${entry.orderNumber || entry.orderId}`;
        const service = String(entry.serviceTitle || 'Order service').slice(0, 300);
        document.font('Body').fontSize(8);
        const detailHeight = document.heightOfString(service, { width: 215, lineGap: 2 });
        const rowHeight = Math.max(47, 29 + detailHeight);
        if (y + rowHeight > bottom) { document.addPage(); header(); tableHeader(); }
        document.font('Body').fontSize(7.5).fillColor('#686177'); text(date(entry.recognizedAt), left + 9, y + 9, { width: 65 });
        document.font('Bold').fontSize(8.5).fillColor('#241a3c'); text(orderLabel, left + 81, y + 7, { width: 215, lineBreak: false, ellipsis: true });
        document.font('Body').fontSize(8).fillColor('#686177'); text(service, left + 81, y + 22, { width: 215, lineGap: 2 });
        text(entry.kind === 'ADJUSTMENT' ? 'Adjustment' : 'Earned', left + 311, y + 9, { width: 70 });
        document.font('Bold').fontSize(9).fillColor(entry.amountCents < 0 ? '#9e3e4a' : '#47246f');
        text(amount(entry.amountCents, entry.currency), left + 387, y + 8, { width: 140, align: 'right' });
        y += rowHeight;
        document.moveTo(left, y - 3).lineTo(right, y - 3).lineWidth(0.5).strokeColor('#e9e4f0').stroke();
    }
    const pages = document.bufferedPageRange();
    for (let index = 0; index < pages.count; index++) {
        document.switchToPage(index);
        document.font('Body').fontSize(8).fillColor('#888092');
        text(`FastBoost | ${report.period.month}`, left, 732, { width: 350, lineBreak: false });
        text(`${index + 1} / ${pages.count}`, 480, 732, { width: 94, align: 'right', lineBreak: false });
    }
    document.end();
    return result;
}

module.exports = { renderEarningsStatement };
