require('dotenv').config({ quiet: true });
const { DOCUSIGN_INTEGRATION_KEY: clientId, DOCUSIGN_CONSENT_REDIRECT_URI: redirectUri } = process.env;
if (!clientId || !redirectUri) throw new Error('Set DOCUSIGN_INTEGRATION_KEY and DOCUSIGN_CONSENT_REDIRECT_URI first.');
const host = process.env.DOCUSIGN_ENVIRONMENT === 'production' ? 'account.docusign.com' : 'account-d.docusign.com';
const query = new URLSearchParams({ response_type: 'code', scope: 'signature impersonation', client_id: clientId, redirect_uri: redirectUri });
console.log(`https://${host}/oauth/auth?${query}`);
