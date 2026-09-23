const TERMS_VERSION = 'fastboost-terms-2026-09-22-v1.0-review';
function registrationConsent(body) {
  if (body.termsAccepted !== true) throw new Error('Please agree to the Terms and Conditions to create an account.');
  return { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date(),
    promotionalEmails: body.promotionalEmails === true,
    promotionalConsentAt: body.promotionalEmails === true ? new Date() : null };
}
module.exports = { registrationConsent };
