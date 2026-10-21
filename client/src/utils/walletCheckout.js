const cents = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

// Decimal input is converted without floating-point rounding or accepting
// exponent/negative values. Only the server's returned quote is ever applied.
export function walletInputCents(value) {
    const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(String(value).trim());
    if (!match) return null;
    const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
    return Number.isSafeInteger(amount) ? amount : null;
}

export function walletCheckoutAmounts(wallet, summary) {
    const applied = cents(summary?.walletAppliedCents) ?? 0;
    const order = cents(summary?.orderTotalCents) ?? ((cents(summary?.totalCents) ?? 0) + applied);
    const quotedAvailable = cents(summary?.walletAvailableCents);
    const spendable = cents(wallet?.availableBalanceCents);
    const balance = cents(wallet?.balanceCents);
    // A checkout quote includes its own hold so the amount can still be edited.
    // A wallet snapshot's available balance has already excluded every hold.
    const unreservedAvailable = quotedAvailable !== null ? Math.max(0, quotedAvailable - applied)
        : spendable ?? (balance !== null ? Math.max(0, balance - applied) : null);
    const available = quotedAvailable ?? (spendable !== null && Number.isSafeInteger(spendable + applied) ? spendable + applied : balance);
    const usable = available !== null && !wallet?.frozen && String(wallet?.currency).toLowerCase() === 'usd'
        && String(summary?.currency).toLowerCase() === 'usd' && order > 0;
    return { applied, order, available, unreservedAvailable, maximum: usable ? Math.min(available, order) : 0,
        full: applied > 0 && applied === order, usable };
}

export function walletQuoteMatches(summary, sessionId, displaySession) {
    if (!(summary?.walletAppliedCents > 0)) return true;
    const checkout = displaySession?.state?.checkout;
    return Number.isSafeInteger(summary.walletAppliedCents) && Number.isSafeInteger(summary.totalCents)
        && summary.totalCents > 0 && summary.orderTotalCents === summary.totalCents + summary.walletAppliedCents
        && summary.cardAmountCents === summary.totalCents && String(summary.currency).toLowerCase() === 'usd'
        && displaySession?.sessionId === sessionId && displaySession.state.type === 'success' && checkout?.id === sessionId
        && checkout.currency?.toLowerCase() === 'usd' && checkout.minorUnitsAmountDivisor === 100
        && checkout.total?.total?.minorUnitsAmount === summary.totalCents;
}

export function walletCardQuote(result) {
    const summary = result?.summary;
    return typeof result?.sessionId === 'string' && result.sessionId.length > 0
        && typeof result.clientSecret === 'string' && result.clientSecret.length > 0
        && String(summary?.currency).toLowerCase() === 'usd' && Number.isSafeInteger(summary.totalCents) && summary.totalCents >= 50
        && Number.isSafeInteger(summary.walletAppliedCents) && summary.walletAppliedCents >= 0
        && summary.cardAmountCents === summary.totalCents && summary.orderTotalCents === summary.totalCents + summary.walletAppliedCents;
}
