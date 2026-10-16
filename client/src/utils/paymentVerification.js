// Retry only verification of the existing payment. A delayed confirmation must
// never create another checkout or send the customer back to place a new order.
export async function pollPaymentVerification({ verify, sessionId, orderId, isCancelled = () => false,
    wait = () => new Promise(resolve => setTimeout(resolve, 1200)) }) {
    let lastData = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (isCancelled()) return null;
        lastData = await verify({ sessionId, orderId });
        if (isCancelled()) return null;
        if (lastData.paid) return lastData;
        if (attempt < 7) await wait();
    }
    return { ...lastData, paid: false, orderId: lastData?.orderId || orderId || '' };
}
