// Keep order/accounting amounts in their original currency. These values are
// display-only and come from the current, session-bound Stripe checkout quote.
export function checkoutPriceDisplay(summary, sessionId, displaySession) {
    if (!summary || !sessionId || displaySession?.sessionId !== sessionId || displaySession.state?.type !== 'success') return null;
    const checkout = displaySession.state.checkout;
    if (checkout?.id !== sessionId) return null;
    const currency = checkout.currency?.toUpperCase();
    const sourceCurrency = summary.currency?.toUpperCase();
    const totalMinor = checkout.total?.total?.minorUnitsAmount;
    const divisor = checkout.minorUnitsAmountDivisor;
    if (!/^[A-Z]{3}$/.test(currency || '') || !sourceCurrency || !Number.isSafeInteger(totalMinor) || totalMinor < 0 || !Number.isSafeInteger(divisor) || divisor <= 0 || !Number.isSafeInteger(summary.totalCents) || summary.totalCents <= 0) return null;
    const option = checkout.currencyOptions?.find(item => item.currency?.toUpperCase() === currency);
    const conversion = option?.currencyConversion;
    // Prefer Stripe's quoted rate. Older SDK responses can still be displayed
    // using the exact quoted payment total, never a separately fetched FX rate.
    const quotedRate = conversion?.sourceCurrency?.toUpperCase() === sourceCurrency && Number.isFinite(conversion.fxRate) && conversion.fxRate > 0
        ? conversion.fxRate * divisor / 100 : null;
    const multiplier = currency === sourceCurrency ? divisor / 100 : quotedRate ?? totalMinor / summary.totalCents;
    const convert = cents => Math.round(cents * multiplier);
    const discounts = [summary.promotionCents, summary.coupon?.amountCents, summary.referralCents, summary.goldDiscountCents].filter(value => Number.isSafeInteger(value) && value > 0);
    // Assign any fractional-unit rounding to the subtotal, so the visible
    // discounts reconcile exactly to Stripe's authoritative charge amount.
    const subtotalMinor = totalMinor + discounts.reduce((sum, cents) => sum + convert(cents), 0);
    const formatter = new Intl.NumberFormat(currency === 'USD' ? 'en-CA' : 'en-US', { style: 'currency', currency, currencyDisplay: 'symbol' });
    const formatPrice = (cents, role) => formatter.format((role === 'total' ? totalMinor : role === 'subtotal' ? subtotalMinor : convert(cents)) / divisor);
    return { currency, localized: currency !== sourceCurrency, formatPrice };
}
