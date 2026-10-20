// Render synthetic previews only. This script never loads .env, creates a
// database client, queues an email or opens an SMTP connection.
const fs = require('node:fs');
const path = require('node:path');
const { buildConfirmation } = require('../src/utils/orderConfirmationEmail');
const { buildBoosterOrderEmail } = require('../src/utils/boosterOrderEmail');

process.env.CLIENT_URL = 'https://fastboost.example';
process.env.NODE_ENV = 'test';
const directory = path.resolve(__dirname, '../../.agent-handoff/previews/email');
fs.mkdirSync(directory, { recursive: true });

const order = {
    id: 'synthetic-preview', orderNumber: 'LOL-RNK-PREVIEW',
    status: 'IN_PROGRESS', paymentStatus: 'PAID', boostType: 'Rank Boost',
    currentRank: 'Silver I', desiredRank: 'Gold IV', queueType: 'Solo/Duo', region: 'North America',
    currency: 'usd', basePrice: 50, addonPrice: 10, amountCents: 5250,
    totalPrice: 52.5, cashAmountCents: 5250, referralDiscount: 0, goldRedeemed: 0, goldDiscountCents: 0,
    promotionTitle: 'Fall promotion', promotionPercent: 15, promotionAppliesTo: 'BASE_PRICE',
};
const examples = [];
function save(slug, title, message) {
    fs.writeFileSync(path.join(directory, `${slug}.html`), message.html);
    fs.writeFileSync(path.join(directory, `${slug}.txt`), message.text);
    examples.push({ slug, title });
}
save('customer-card', 'Customer · card and promotion', buildConfirmation(order, 'preview@example.test', { type: 'card', brand: 'visa', last4: '4242' }));
save('customer-coupon', 'Customer · saved coupon', buildConfirmation({ ...order, couponSaleId: 'synthetic-coupon',
    couponCode: 'FALL15', couponTitle: 'Fall promotion', couponDiscountCents: 750 }, 'preview@example.test', { type: 'link' }));
save('customer-gold', 'Customer · card and Gold', buildConfirmation({ ...order, goldRedeemed: 100, goldDiscountCents: 1000,
    cashAmountCents: 4250 }, 'preview@example.test', { type: 'card', brand: 'mastercard', last4: '4444' }));
save('customer-wallet', 'Customer · wallet payment', buildConfirmation({ ...order, walletAmountCents: 5250 }, 'preview@example.test'));
save('customer-no-discount', 'Customer · full price', buildConfirmation({ ...order, amountCents: 6000, totalPrice: 60,
    cashAmountCents: 6000 }, 'preview@example.test', { type: 'card', brand: 'visa', last4: '4242' }));
const events = {
    ASSIGNMENT_REQUEST: 'Booster · assignment request',
    ASSIGNMENT_REQUEST_CANCELLED: 'Booster · request cancelled',
    ASSIGNED: 'Booster · assigned', UNASSIGNED: 'Booster · unassigned',
    PAYMENT_CONFIRMED: 'Booster · payment confirmed', COMPLETED: 'Booster · completed', CANCELLED: 'Booster · cancelled',
};
for (const [event, title] of Object.entries(events)) save(`booster-${event.toLowerCase().replaceAll('_', '-')}`, title, buildBoosterOrderEmail(order, event));

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const options = examples.map(({ slug, title }) => `<option value="${slug}">${escape(title)}</option>`).join('');
const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FastBoost email preview</title><style>
*{box-sizing:border-box}body{margin:0;background:#e8edf6;color:#17123b;font-family:Arial,Helvetica,sans-serif}header{padding:16px 24px;background:#17132c;color:white;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:1}h1{font-size:18px;margin:0 12px 0 0}header p{width:100%;margin:0;font-size:12px;color:#c6bfd9}select,button,a{font:inherit}select{max-width:100%;padding:9px;border:1px solid #6d5f92;border-radius:8px;color:white;background:#302342}button,a{padding:9px 12px;border:1px solid #6d5f92;border-radius:8px;background:#302342;color:white;cursor:pointer;text-decoration:none;font-size:13px}button[aria-pressed=true]{background:#7938e0;border-color:#b794ef}main{padding:20px;display:flex;justify-content:center}iframe{width:100%;max-width:1000px;min-height:1350px;border:0;border-radius:12px;background:white;box-shadow:0 8px 30px #17203614}iframe.mobile{max-width:390px}@media(max-width:600px){header{padding:14px}main{padding:10px}iframe{min-height:1900px}}
</style></head><body><header><h1>FastBoost email preview</h1><select id="preview" aria-label="Email example">${options}</select><button id="desktop" aria-pressed="true">Desktop</button><button id="mobile" aria-pressed="false">Mobile</button><a id="standalone" href="customer-card.html" target="_blank" rel="noopener">Open email</a><a id="plain" href="customer-card.txt" target="_blank" rel="noopener">Plain text</a><p>Synthetic examples · no email sent · customer receipts and every booster notification</p></header><main><iframe id="email" title="Rendered email preview" src="customer-card.html" sandbox="allow-same-origin"></iframe></main><script>
const select=document.querySelector('#preview'),frame=document.querySelector('#email');select.addEventListener('change',()=>{frame.src=select.value+'.html';document.querySelector('#standalone').href=select.value+'.html';document.querySelector('#plain').href=select.value+'.txt'});for(const mode of ['desktop','mobile'])document.querySelector('#'+mode).addEventListener('click',()=>{frame.classList.toggle('mobile',mode==='mobile');for(const item of ['desktop','mobile'])document.querySelector('#'+item).setAttribute('aria-pressed',String(item===mode))});
</script></body></html>`;
fs.writeFileSync(path.join(directory, 'index.html'), gallery);
console.log(`Rendered ${examples.length} synthetic email examples: ${path.join(directory, 'index.html')}`);
