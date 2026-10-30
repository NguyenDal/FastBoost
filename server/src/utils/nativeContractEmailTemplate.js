const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const table = 'role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"';
const { publicAssetUrl } = require('./publicAssetUrl');
// Mail clients fetch images outside the sender's browser. Keep the public brand
// asset reachable even when the agreement link points to local development.
const logoUrl = publicAssetUrl('https://www.fastboost.gg', 'logos/fastboost-logo.png');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

const nativeContractEmailEvents = Object.freeze({
    BOOSTER_SIGNED: Object.freeze({ badge: 'BOOSTER SIGNED', subject: 'The booster signed the agreement', title: 'The booster signed',
        text: 'The booster signed the agreement. Open it to review the saved terms and see the latest status. If FastBoost still needs to sign, you can do that there.',
        action: 'Open agreement' }),
    COMPANY_SIGNED: Object.freeze({ subject: 'Your agreement is ready to sign', title: 'Your agreement is ready to sign',
        text: 'Your Booster Service Agreement is ready for your signature. Review the finalized terms and sign in your FastBoost account.',
        action: 'Review & sign' }),
    COMPLETED: Object.freeze({ badge: 'SIGNED BY BOTH SIDES', subject: 'Your signed Booster Service Agreement', title: 'Your agreement is signed',
        text: 'Both parties have signed. The signed PDF is attached, and you can also sign in to view or download it.',
        action: 'View or download PDF' }),
});

function safeOrigin(clientUrl, nodeEnv) {
    let origin;
    try { origin = new URL(clientUrl); } catch { throw new Error('CLIENT_URL is invalid'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.username || origin.password || (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:' && nodeEnv !== 'production'))
        || (local && nodeEnv === 'production')) throw new Error('CLIENT_URL must use HTTPS outside local development');
    return origin.origin;
}

function singleLine(value, label) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error(`${label} is invalid`);
    return value.trim().normalize('NFC');
}

function renderHtml(copy, rows, url) {
    const details = rows.map(([label, value], index) => `<tr style="background:${index % 2 ? '#f8f9fd' : '#ffffff'}"><td style="padding:12px 10px;border-bottom:1px solid #eeeefa;font-size:14px;line-height:21px;color:#69658b">${escape(label)}</td><td align="right" style="padding:12px 10px;border-bottom:1px solid #eeeefa;font-size:14px;line-height:21px;font-weight:bold;color:#17123b;overflow-wrap:anywhere">${escape(value)}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(copy.subject)}</title><style>@media only screen and (max-width:620px){.email-pad{padding:22px!important}.email-title{font-size:25px!important}.email-outer{padding:12px 6px!important}.email-button{padding:16px 24px!important}}</style></head>
    <body style="margin:0;padding:0;background:#f2f5fb;font-family:Arial,Helvetica,sans-serif;color:#17123b">
    <div style="display:none;font-size:1px;color:#f2f5fb;max-height:0;overflow:hidden">${escape(copy.subject)}. Open your FastBoost account for the latest status.</div>
    <table ${table} bgcolor="#f2f5fb"><tr><td class="email-outer" align="center" style="padding:32px 16px">
    <table ${table} style="max-width:640px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td class="email-pad" bgcolor="#20103d" style="padding:28px 32px;background:#20103d;background-image:linear-gradient(120deg,#111326,#351878 65%,#852dff)"><table ${table}><tr><td width="72"><img src="${escape(logoUrl)}" width="60" height="60" alt="FastBoost logo" style="display:block;border:0;object-fit:contain"></td><td><div style="font-size:30px;line-height:36px;font-weight:bold;font-style:italic;color:#ffffff">Fast<span style="color:#cc8aff">Boost</span></div><div style="margin-top:7px;font-size:10px;letter-spacing:3px;color:#dfceff">AGREEMENT UPDATE</div></td></tr></table></td></tr>
    <tr><td class="email-pad" style="padding:32px">
    ${copy.badge ? `<p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;font-weight:bold;color:#7431ef">${escape(copy.badge)}</p>` : ''}
    <h1 class="email-title" style="margin:0 0 14px;font-size:29px;line-height:1.3;overflow-wrap:anywhere">${escape(copy.title)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:25px;color:#69658b">${escape(copy.text)}</p>
    <table ${table} style="border:1px solid #e1dcfa;border-radius:10px"><tr><td style="padding:12px"><table ${table}>${details}</table></td></tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px"><tr><td bgcolor="#7929f4" style="border-radius:9px;background:#7929f4;background-image:linear-gradient(110deg,#992cf5,#6232ff)"><a class="email-button" href="${escape(url)}" style="display:inline-block;padding:17px 36px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border:1px solid #7929f4;border-radius:9px">${escape(copy.action)} &nbsp; &#8594;</a></td></tr></table>
    <p style="margin:24px 0 0;font-size:12px;line-height:20px;color:#69658b">Sign in to FastBoost to see the latest agreement and download the signed PDF after both parties sign.</p>
    </td></tr></table></td></tr></table></body></html>`;
}

function buildNativeContractEmail(contract, event, { clientUrl = process.env.CLIENT_URL, nodeEnv = process.env.NODE_ENV } = {}) {
    if (!Object.hasOwn(nativeContractEmailEvents, event)) throw new Error('Unknown native contract email event');
    const id = singleLine(contract?.id, 'Agreement ID');
    if (!uuid.test(id)) throw new Error('Agreement ID is invalid');
    const boosterName = singleLine(contract?.signerName, 'Booster legal name');
    const url = new URL(`/provider/contracts/${encodeURIComponent(id)}${event === 'COMPANY_SIGNED' ? '/sign' : ''}`, safeOrigin(clientUrl, nodeEnv)).href;
    const copy = nativeContractEmailEvents[event];
    const rows = [['Agreement reference', id], ['Booster', boosterName]];
    return {
        subject: `FastBoost · ${copy.subject}`,
        text: [`FastBoost · ${copy.subject}`, '', copy.text, '', ...rows.map(([label, value]) => `${label}: ${value}`),
            '', `Open your agreement: ${url}`].join('\n'),
        html: renderHtml(copy, rows, url),
    };
}

module.exports = { buildNativeContractEmail, nativeContractEmailEvents };
