const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const table = 'role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"';

function renderBoosterOrderEmail({ copy, orderNumber, rows, url, earningsNote }) {
    const details = rows.map(([label, value], index) => `<tr style="background:${index % 2 ? '#f8f9fd' : '#ffffff'}"><td style="padding:12px 10px;border-bottom:1px solid #eeeefa;font-size:14px;line-height:21px;color:#69658b">${escape(label)}</td><td align="right" style="padding:12px 10px;border-bottom:1px solid #eeeefa;font-size:14px;line-height:21px;font-weight:bold;color:#17123b">${escape(value)}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(copy.title)}</title><style>@media only screen and (max-width:620px){.email-pad{padding:22px!important}.email-title{font-size:25px!important}.email-outer{padding:12px 6px!important}.email-button{padding:16px 24px!important}}</style></head>
    <body style="margin:0;padding:0;background:#f2f5fb;font-family:Arial,Helvetica,sans-serif;color:#17123b">
    <div style="display:none;font-size:1px;color:#f2f5fb;max-height:0;overflow:hidden">${escape(copy.subject)} #${escape(orderNumber)}. Check your Booster Portal for details.</div>
    <table ${table} bgcolor="#f2f5fb"><tr><td class="email-outer" align="center" style="padding:32px 16px">
    <table ${table} style="max-width:640px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td class="email-pad" bgcolor="#20103d" style="padding:28px 32px;background:#20103d;background-image:linear-gradient(120deg,#111326,#351878 65%,#852dff)"><table ${table}><tr><td width="72"><img src="https://fastboost-assets.s3.ca-central-1.amazonaws.com/logos/fastboost-logo.png" width="60" height="60" alt="" style="display:block;border:0;object-fit:contain"></td><td><div style="font-size:30px;line-height:36px;font-weight:bold;font-style:italic;color:#ffffff">Fast<span style="color:#cc8aff">Boost</span></div><div style="margin-top:7px;font-size:10px;letter-spacing:3px;color:#dfceff">BOOSTER TEAM UPDATE</div></td></tr></table></td></tr>
    <tr><td class="email-pad" style="padding:32px">
    <p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;font-weight:bold;color:#7431ef">${escape(copy.badge)}</p>
    <h1 class="email-title" style="margin:0 0 14px;font-size:29px;line-height:1.3;overflow-wrap:anywhere">${escape(copy.title)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:25px;color:#69658b">${escape(copy.text)}</p>
    <table ${table} style="border:1px solid #e1dcfa;border-radius:10px"><tr><td style="padding:12px"><table ${table}>${details}</table></td></tr></table>
    ${earningsNote ? `<p style="margin:12px 0 0;font-size:13px;line-height:20px;color:#69658b">${escape(earningsNote)}</p>` : ''}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px"><tr><td bgcolor="#7929f4" style="border-radius:9px;background:#7929f4;background-image:linear-gradient(110deg,#992cf5,#6232ff)"><a class="email-button" href="${escape(url)}" style="display:inline-block;padding:17px 36px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border:1px solid #7929f4;border-radius:9px">${escape(copy.action)} &nbsp; &#8594;</a></td></tr></table>
    </td></tr></table></td></tr></table></body></html>`;
}

module.exports = { renderBoosterOrderEmail };
