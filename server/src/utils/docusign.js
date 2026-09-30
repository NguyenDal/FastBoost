const jwt = require('jsonwebtoken');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
let cached, pendingToken;
const failure = (message, status = 503) => Object.assign(new Error(message), { status });

function configuration() {
    const environment = process.env.DOCUSIGN_ENVIRONMENT || 'demo';
    if (!['demo', 'production'].includes(environment)) throw failure('Invalid DocuSign environment.');
    const config = {
        environment, authHost: environment === 'production' ? 'account.docusign.com' : 'account-d.docusign.com',
        integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY, userId: process.env.DOCUSIGN_USER_ID,
        accountId: process.env.DOCUSIGN_ACCOUNT_ID, templateId: process.env.DOCUSIGN_TEMPLATE_ID,
        privateKey: process.env.DOCUSIGN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        origin: process.env.DOCUSIGN_RETURN_ORIGIN,
    };
    if (!config.privateKey && process.env.DOCUSIGN_PRIVATE_KEY_PATH) config.privateKey = readFileSync(process.env.DOCUSIGN_PRIVATE_KEY_PATH, 'utf8');
    if (Object.values(config).some(value => !value)) throw failure('DocuSign setup is incomplete. Configure the server integration first.');
    const origin = new URL(config.origin);
    if (origin.protocol !== 'https:' && !(environment === 'demo' && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw failure('DocuSign return origin must use HTTPS.');
    config.origin = origin.origin;
    return config;
}
function readiness() {
    try { const config = configuration(); companySigner(); return { configured: true, environment: config.environment }; }
    catch { return { configured: false, environment: process.env.DOCUSIGN_ENVIRONMENT || 'demo' }; }
}
function companySigner() {
    const name = String(process.env.DOCUSIGN_COMPANY_SIGNER_NAME || '').trim();
    const email = String(process.env.DOCUSIGN_COMPANY_SIGNER_EMAIL || '').trim().toLowerCase();
    if (name.length < 2 || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('Configure the FastBoost countersigner name and admin login email before sending agreements.');
    return { name, email };
}
const companyClientId = contract => `fastboost:${contract.id}`;
async function checkedFetch(url, options = {}) {
    let response;
    try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
    catch { throw failure('DocuSign is temporarily unavailable. Retry from the existing contract.'); }
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw failure(body.error === 'consent_required' ? 'DocuSign sender consent is required. Follow the setup guide.' : 'DocuSign could not complete the request. Check the account configuration and retry.');
    }
    return response;
}
async function session() {
    const config = configuration();
    const key = `${config.environment}:${config.accountId}:${config.integrationKey}:${config.userId}`;
    if (cached?.key === key && cached.expiresAt > Date.now()) return cached;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
        const assertion = jwt.sign({ scope: 'signature impersonation' }, config.privateKey, {
            algorithm: 'RS256', issuer: config.integrationKey, subject: config.userId, audience: config.authHost, expiresIn: 3600,
        });
        const token = await (await checkedFetch(`https://${config.authHost}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() })).json();
        const info = await (await checkedFetch(`https://${config.authHost}/oauth/userinfo`, { headers: { Authorization: `Bearer ${token.access_token}` } })).json();
        const account = info.accounts?.find(a => a.account_id === config.accountId);
        if (!account) throw failure('Configured DocuSign account is unavailable to the integration user.');
        const base = new URL(account.base_uri);
        if (base.protocol !== 'https:' || !base.hostname.endsWith('.docusign.net')) throw failure('Unexpected DocuSign API host.');
        cached = { key, config, token: token.access_token, base: `${base.origin}/restapi/v2.1/accounts/${encodeURIComponent(config.accountId)}`, expiresAt: Date.now() + (Number(token.expires_in) - 120) * 1000 };
        return cached;
    })();
    try { return await pendingToken; } finally { pendingToken = null; }
}
async function api(path, { method = 'GET', body, pdf = false } = {}, contract) {
    const auth = await session();
    if (contract && (contract.accountId !== auth.config.accountId || contract.environment !== auth.config.environment)) throw failure('This contract belongs to another DocuSign environment or account.');
    const response = await checkedFetch(`${auth.base}${path}`, { method, headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json', Accept: pdf ? 'application/pdf' : 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return pdf ? Buffer.from(await response.arrayBuffer()) : response.json();
}
async function sendContract(contract) {
    // A transaction ID prevents a network retry from creating a second envelope.
    if (contract.sendAttemptAt) {
        if (Date.now() - new Date(contract.sendAttemptAt).getTime() > 6 * 86400000) throw failure('The recovery window has expired. Reconcile this contract in DocuSign before sending another.', 409);
        const found = await api(`/envelopes/status?transaction_ids=${encodeURIComponent(contract.id)}`, {}, contract);
        if (found.envelopes?.length) return found.envelopes[0].envelopeId;
    }
    if (!contract.companySignerName || !contract.companySignerEmail) throw failure('This unsent agreement has no FastBoost countersigner. Create a new two-party agreement.', 409);
    const template = await api(`/templates/${encodeURIComponent(contract.templateId)}/recipients?include_tabs=true`, {}, contract);
    const roles = template.signers || [];
    const required = [['FastBoost', '1'], ['Booster', '2']];
    const otherRecipients = Object.entries(template).some(([key, value]) => key !== 'signers' && Array.isArray(value) && value.length);
    if (roles.length !== 2 || otherRecipients || required.some(([role, order]) => {
        const signer = roles.find(s => s.roleName === role);
        return !signer || String(signer.routingOrder) !== order || !signer.tabs?.signHereTabs?.some(t => t.optional !== 'true' && t.optional !== true) || !signer.tabs?.dateSignedTabs?.length;
    })) throw failure('Use a two-signer template: FastBoost first, Booster second, each with a required signature and signed-date field.');
    const providerFields = ['ProviderLegalName', 'ProviderEmail', 'ProviderAccountId', 'AgreementId', 'EffectiveDate'];
    // Prefilled fields belong to the first signer so both parties see them before signing.
    const textTabs = roles.find(s => s.roleName === 'FastBoost').tabs.textTabs || [];
    if (providerFields.some(label => !textTabs.some(t => t.tabLabel === label))) throw failure('The template is missing required provider identity or agreement fields. Follow the DocuSign setup guide.');
    const result = await api('/envelopes', { method: 'POST', body: {
        templateId: contract.templateId, transactionId: contract.id, status: 'sent', emailSubject: contract.title,
        // FastBoost completes the commercial fields and signs first (template order 1).
        // The booster then reviews those completed terms and signs (template order 2).
        templateRoles: [
            { roleName: 'Booster', name: contract.signerName, email: contract.signerEmail, clientUserId: contract.boosterId },
            { roleName: 'FastBoost', name: contract.companySignerName, email: contract.companySignerEmail, clientUserId: companyClientId(contract),
                tabs: { textTabs: [
                    { tabLabel: 'ProviderLegalName', value: contract.signerName, locked: 'true' },
                    { tabLabel: 'ProviderEmail', value: contract.signerEmail, locked: 'true' },
                    { tabLabel: 'ProviderAccountId', value: contract.boosterId, locked: 'true' },
                    { tabLabel: 'AgreementId', value: contract.id, locked: 'true' },
                    { tabLabel: 'EffectiveDate', value: new Date(contract.startsAt).toISOString().slice(0, 10), locked: 'true' },
                ] } },
        ],
    } }, contract);
    if (!result.envelopeId) throw failure('DocuSign has not returned an envelope ID. Retry this contract.');
    return result.envelopeId;
}
async function signingView(contract, company = false) {
    const config = configuration();
    return api(`/envelopes/${encodeURIComponent(contract.envelopeId)}/views/recipient`, { method: 'POST', body: {
        returnUrl: `${config.origin}/provider/contracts/${encodeURIComponent(contract.id)}?signingReturn=1`,
        authenticationMethod: 'none',
        email: company ? contract.companySignerEmail : contract.signerEmail,
        userName: company ? contract.companySignerName : contract.signerName,
        clientUserId: company ? companyClientId(contract) : contract.boosterId,
    } }, contract);
}
async function getStatus(contract) {
    const envelope = await api(`/envelopes/${encodeURIComponent(contract.envelopeId)}`, {}, contract);
    if (envelope.status !== 'completed' && !contract.companySignerEmail) return { status: envelope.status };
    const recipients = await api(`/envelopes/${encodeURIComponent(contract.envelopeId)}/recipients`, {}, contract);
    const signer = recipients.signers?.find(s => s.clientUserId === contract.boosterId && s.email?.toLowerCase() === contract.signerEmail.toLowerCase());
    const signed = s => s?.status === 'completed' && Number.isFinite(Date.parse(s.signedDateTime));
    const company = contract.companySignerEmail ? recipients.signers?.find(s => s.clientUserId === companyClientId(contract) && s.email?.toLowerCase() === contract.companySignerEmail.toLowerCase()) : null;
    if (envelope.status === 'completed' && (!signed(signer) || (contract.companySignerEmail && !signed(company)))) throw failure('DocuSign completion could not be verified for every required signer.');
    const progress = {
        status: envelope.status,
        ...(signed(signer) && { boosterSignedAt: new Date(signer.signedDateTime) }),
        ...(signed(company) && { companySignedAt: new Date(company.signedDateTime) }),
    };
    if (envelope.status !== 'completed') return progress;
    return { ...progress, signedAt: new Date(Math.max(Date.parse(signer.signedDateTime), signed(company) ? Date.parse(company.signedDateTime) : 0)), signedName: signer.name };
}
function validWebhook(body, headers) {
    const secrets = String(process.env.DOCUSIGN_CONNECT_HMAC_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
    if (!Buffer.isBuffer(body) || !secrets.length) return false;
    return secrets.some(secret => {
        const expected = createHmac('sha256', secret).update(body).digest();
        return Object.entries(headers).some(([key, value]) => {
            if (!/^x-docusign-signature-\d+$/i.test(key) || typeof value !== 'string') return false;
            const actual = Buffer.from(value, 'base64');
            return actual.length === expected.length && timingSafeEqual(actual, expected);
        });
    });
}
const document = contract => api(`/envelopes/${encodeURIComponent(contract.envelopeId)}/documents/combined?certificate=true`, { pdf: true }, contract);
module.exports = { configuration, companySigner, readiness, sendContract, signingView, getStatus, validWebhook, document };
