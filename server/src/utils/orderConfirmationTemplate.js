const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const table = 'role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"';
const heading = title => `<h3 style="margin:0 0 20px;font-size:18px;line-height:24px;color:#17123b">${title}</h3>`;

function rankImage(rank) {
    const tier = String(rank || "").trim().split(/\s+/)[0].toLowerCase();
    if (!["unranked", "iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"].includes(tier)) return "";
    return `<img src="https://fastboost-assets.s3.amazonaws.com/services/ranks/${tier}.${tier === "unranked" ? "webp" : "png"}" width="86" height="86" alt="" style="display:block;margin:0 auto 8px;object-fit:contain;border:0">`;
}

function renderConfirmation({ orderNumber, summary, rows, url }) {
    const rankBoost = summary.serviceType === "Rank Boost";
    const leftLabel = summary.serviceType === "Placement Boost" ? "Peak rank" : "Current rank";
    const rightLabel = rankBoost ? "Target rank" : summary.quantity?.label || "Service";
    const rightValue = rankBoost ? summary.targetRank : summary.quantity?.value ?? summary.serviceType;
    const overview = `<table ${table}><tr>
        <td width="42%" align="center" valign="middle">${rankImage(summary.currentRank)}<strong style="font-size:18px;color:#17123b">${escape(summary.currentRank || "Not specified")}</strong><p style="margin:8px 0 0;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#76719b">${escape(leftLabel)}</p></td>
        <td width="16%" align="center" style="font-size:32px;color:#9146ff">&#8594;</td>
        <td width="42%" align="center" valign="middle">${rankBoost ? rankImage(summary.targetRank) : '<div style="font-size:34px;line-height:86px;color:#7c3aed;background:#f2ecff;border-radius:16px;margin:0 auto 8px;width:86px">' + escape(summary.quantity?.value ?? "★") + '</div>'}<strong style="font-size:18px;color:#17123b">${escape(rankBoost ? rightValue || "Not specified" : summary.quantity ? rightLabel : rightValue)}</strong><p style="margin:8px 0 0;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#76719b">${escape(rankBoost ? rightLabel : "Ordered")}</p></td>
    </tr></table>`;
    // Rank/quantity belong in the visual overview, not duplicated in the details table.
    const detailRows = rows.filter(([label]) => !["Peak Rank", "Current Rank", "Target Rank", "Placement Matches", "Ranked Wins", "Games"].includes(label));
    const details = detailRows.map(([label, value], index) => `<tr style="background:${index % 2 ? "#f8f9fd" : "#ffffff"}"><td style="padding:11px 8px;border-bottom:1px solid #eeeefa;font-size:13px;line-height:20px;color:#69658b">${escape(label)}</td><td align="right" style="padding:11px 8px;border-bottom:1px solid #eeeefa;font-size:13px;line-height:20px;font-weight:bold;color:#17123b">${escape(value)}</td></tr>`).join("");
    const next = ["We’ll review your order and assign a booster.", "Open your order to chat with our team.", "Track updates as your order progresses."].map((text, index) => `<tr><td width="36" valign="top" style="padding:0 0 14px"><span style="display:inline-block;width:26px;line-height:26px;text-align:center;border-radius:50%;background:#ede4ff;color:#7435db;font-weight:bold">${index + 1}</span></td><td style="padding:2px 0 14px;font-size:13px;line-height:21px;color:#69658b">${text}</td></tr>`).join("");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FastBoost order confirmed</title><style>@media only screen and (max-width:620px){.email-pad{padding:20px!important}.email-column{display:block!important;width:100%!important;padding:0 0 16px!important}.email-title{font-size:23px!important}.email-brand{font-size:26px!important}.email-shell{width:100%!important}.email-outer{padding:12px 6px!important}}</style></head>
    <body style="margin:0;padding:0;background:#f2f5fb;font-family:Arial,Helvetica,sans-serif;color:#17123b">
    <div style="display:none;font-size:1px;color:#f2f5fb;max-height:0;overflow:hidden">Payment confirmed. View your order, track progress, and chat with our team.</div>
    <table ${table} bgcolor="#f2f5fb"><tr><td class="email-outer" align="center" style="padding:32px 16px">
    <table ${table} class="email-shell" style="max-width:880px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td class="email-pad" bgcolor="#20103d" style="padding:30px;background:#20103d;background-image:linear-gradient(120deg,#111326,#351878 65%,#852dff)"><table ${table}><tr><td width="78"><img src="https://fastboost-assets.s3.ca-central-1.amazonaws.com/logos/fastboost-logo.png" width="66" height="66" alt="" style="display:block;border:0;object-fit:contain"></td><td><div class="email-brand" style="font-size:34px;line-height:40px;font-weight:bold;font-style:italic;color:#ffffff">Fast<span style="color:#cc8aff">Boost</span></div><div style="margin-top:7px;font-size:10px;letter-spacing:3px;color:#dfceff">PLAY MORE, WORRY LESS</div></td></tr></table></td></tr>
    <tr><td class="email-pad" style="padding:30px">
    <p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;font-weight:bold;color:#7431ef"><span style="color:#159957;font-size:20px;letter-spacing:0">&#10003;</span>&nbsp; PAYMENT CONFIRMED</p>
    <h1 class="email-title" style="margin:0 0 12px;font-size:29px;line-height:1.3;overflow-wrap:anywhere">Order #${escape(orderNumber)} Confirmed</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:24px;color:#69658b">Your payment is confirmed. Open your order to view details, track progress, and chat with our team.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#7929f4" style="border-radius:9px;background:#7929f4;background-image:linear-gradient(110deg,#992cf5,#6232ff)"><a href="${escape(url)}" style="display:inline-block;padding:17px 48px;font-size:17px;font-weight:bold;color:#ffffff;text-decoration:none;border:1px solid #7929f4;border-radius:9px">Go to Order &nbsp; &#8594;</a></td></tr></table>
    </td></tr><tr><td class="email-pad" style="padding:0 22px 28px">
    <table ${table}><tr><td class="email-column" width="50%" valign="top" style="padding:0 8px"><table ${table} style="border:1px solid #e1dcfa;border-radius:10px"><tr><td style="padding:20px 14px">${heading('Order Details')}<table ${table}>${details}</table></td></tr></table></td>
    <td class="email-column" width="50%" valign="top" style="padding:0 8px"><table ${table} style="border:1px solid #e1dcfa;border-radius:10px"><tr><td style="padding:20px 14px">${heading('Order Overview')}${overview}</td></tr></table><table ${table}><tr><td height="14" style="font-size:0">&nbsp;</td></tr></table><table ${table} style="border:1px solid #e1dcfa;border-radius:10px"><tr><td style="padding:20px 14px 6px">${heading('What happens next?')}<table ${table}>${next}</table></td></tr></table></td></tr></table>
    </td></tr>
    </table></td></tr></table></body></html>`;
}

module.exports = { renderConfirmation };
