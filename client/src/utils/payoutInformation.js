export const PAYOUT_COUNTRIES = { US: 'United States', VN: 'Vietnam' };
export const PAYOUT_STATUSES = {
    REQUESTED: 'Details requested', SUBMITTED: 'Ready for review', VERIFIED: 'Verified by FastBoost', CHANGES_REQUESTED: 'Changes requested',
};
export const PAYOUT_CORRECTIONS = {
    ACCOUNT_DETAILS: 'Please check your bank details and submit them again.',
    NAME_MISMATCH: 'Please use the full account holder name shown by your bank.',
    OTHER: 'Please contact FastBoost to confirm which details need updating.',
};
export const payoutPath = id => `/provider/payout-information/${encodeURIComponent(id)}`;
export const payoutStatus = status => PAYOUT_STATUSES[status] || 'Unavailable';

export function payoutSubmission(values, country) {
    if (!Object.hasOwn(PAYOUT_COUNTRIES, country)) throw new Error('Choose a supported bank country.');
    const trimmed = key => String(values[key] || '').trim();
    const details = { country, legalName: trimmed('legalName'), accountNumber: trimmed('accountNumber'),
        currency: country === 'US' ? 'USD' : trimmed('currency') };
    if (details.legalName.length < 2 || details.legalName.length > 100) throw new Error('Enter the account holder’s full legal name.');
    if (!(country === 'US' ? /^\d{4,17}$/ : /^\d{4,30}$/).test(details.accountNumber)) throw new Error(`Enter your bank account number using 4–${country === 'US' ? 17 : 30} digits.`);
    if (!['USD', 'VND'].includes(details.currency)) throw new Error('Choose the currency of your bank account.');
    if (country === 'US') {
        details.routingNumber = trimmed('routingNumber');
        if (!/^\d{9}$/.test(details.routingNumber)) throw new Error('Enter a 9-digit routing number.');
    } else {
        details.bankName = trimmed('bankName');
        if (details.bankName.length < 2 || details.bankName.length > 120) throw new Error('Enter your bank’s name.');
    }
    return details;
}

// Payout responses are private and must never return to a different session.
// Dependencies are injected so the same transport can be tested without storage.
export function createPayoutRequest({ baseUrl, getToken, fetchImpl = fetch }) {
    return async (path, body, { signal, expectedToken = getToken() } = {}) => {
        const cancelled = () => !expectedToken || expectedToken !== getToken() || signal?.aborted;
        const abort = () => Object.assign(new Error('Your session changed. Reload this page.'), { name: 'AbortError' });
        if (cancelled()) throw abort();
        const response = await fetchImpl(`${baseUrl}/operations${path}`, {
            method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
            headers: { Authorization: `Bearer ${expectedToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const result = await response.json();
        if (cancelled()) throw abort();
        if (!response.ok) throw Object.assign(new Error(result.message || 'Could not load payout information. Please try again.'), { status: response.status });
        return result;
    };
}
