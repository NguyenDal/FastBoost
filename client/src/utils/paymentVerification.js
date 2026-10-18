// Retry only verification of the existing payment. A delayed confirmation must
// never create another checkout or send the customer back to place a new order.
export async function pollPaymentVerification({ verify, sessionId, orderId, isCancelled = () => false,
    wait = () => new Promise(resolve => setTimeout(resolve, 1200)) }) {
    let lastData = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (isCancelled()) return null;
        try {
            lastData = await verify({ sessionId, orderId });
        } catch (error) {
            if (isCancelled()) return null;
            // Brief Wi-Fi/API interruptions retry reads of the same payment.
            // Authentication/ownership errors require user action instead.
            if (attempt === 7 || (error?.status >= 400 && error.status < 500)) throw error;
            await wait();
            continue;
        }
        if (isCancelled()) return null;
        if (lastData?.paid === true) return { ...lastData, orderId: lastData.orderId || orderId || '' };
        if (attempt < 7) await wait();
    }
    return { ...lastData, paid: false, orderId: lastData?.orderId || orderId || '' };
}
