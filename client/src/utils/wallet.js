export const walletMoney = cents => new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'USD', currencyDisplay: 'symbol',
}).format(cents / 100);

// Only a checkout path may survive the external payment redirect.
export function walletReturnPath(value) {
    return typeof value === 'string' && /^\/checkout\/[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : '';
}

export function walletPaymentState(wallet, totalCents, currency) {
    if (!wallet || !Number.isSafeInteger(wallet.balanceCents) || wallet.balanceCents < 0) return 'unavailable';
    if (wallet.frozen) return 'frozen';
    if (String(currency).toLowerCase() !== 'usd' || String(wallet.currency).toLowerCase() !== 'usd') return 'currency';
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return 'unavailable';
    return wallet.balanceCents >= totalCents ? 'ready' : 'insufficient';
}

// Confirmation retries only inspect the same session; they never create credit.
export async function pollWalletTopUp({ verify, sessionId, isCancelled = () => false,
    wait = () => new Promise(resolve => setTimeout(resolve, 1200)) }) {
    let result;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        if (isCancelled()) return null;
        try {
            result = await verify({ sessionId });
        } catch (error) {
            if (isCancelled()) return null;
            if (attempt === 5 || (error?.status >= 400 && error.status < 500)) throw error;
            await wait();
            continue;
        }
        if (isCancelled()) return null;
        if (result?.paid === true && result.status === 'paid') return result;
        if (['expired', 'reversed'].includes(result?.status)) return result;
        if (attempt < 5) await wait();
    }
    return { ...result, paid: false };
}

export function walletCheckoutUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password && !url.port ? url.href : '';
    } catch { return ''; }
}
