const lostCodes = new Set(['WALLET_VIEW_CLOSED', 'WALLET_VIEW_EXPIRED', 'WALLET_VIEW_MISSING']);
export const checkoutPresenceLost = failure => lostCodes.has(failure?.code);

// One controller belongs to one mounted checkout view. Lifecycle signals only
// release that view; the server decides whether another view or payment owns it.
export function checkoutPresenceController({ orderId, checkoutViewId, renew, leave, onLost, onPaid,
    events = window, timers = window, defer = queueMicrotask }) {
    let mounted = false, ready = false, left = false, lost = false, generation = 0;
    let paymentInProgress = false, heartbeat = null, pending = null, protectionVersion = 0, clearing = false;
    let callbacks = { onLost, onPaid };
    const clearHeartbeat = () => { if (heartbeat !== null) timers.clearInterval(heartbeat); heartbeat = null; };
    const lose = failure => {
        if (!mounted || lost) return;
        lost = true; clearHeartbeat(); callbacks.onLost(failure);
    };
    const beat = (requestedProgress = paymentInProgress) => {
        const requestedGeneration = generation;
        const task = (pending || Promise.resolve()).catch(() => {}).then(async () => {
            if (!mounted || left || lost || !ready || requestedGeneration !== generation) throw new DOMException('Checkout changed.', 'AbortError');
            try {
                const result = await renew(orderId, checkoutViewId, { paymentInProgress: requestedProgress });
                if (!mounted || left || !ready || requestedGeneration !== generation) throw new DOMException('Checkout changed.', 'AbortError');
                if (result?.paid === true) { callbacks.onPaid(result); return false; }
                if (result?.released === true) {
                    const failure = Object.assign(new Error('Your checkout view expired.'), { code: 'WALLET_VIEW_EXPIRED' });
                    lose(failure); throw failure;
                }
                return true;
            } catch (failure) {
                if (mounted && !left && requestedGeneration === generation && checkoutPresenceLost(failure)) lose(failure);
                throw failure;
            }
        });
        pending = task;
        const clear = () => { if (pending === task) pending = null; };
        task.then(clear, clear);
        return task;
    };
    const startHeartbeat = () => {
        clearHeartbeat();
        if (mounted && ready && !left && !lost) {
            if (!clearing) beat().catch(() => {});
            heartbeat = timers.setInterval(() => { if (!clearing) beat().catch(() => {}); }, 30000);
        }
    };
    const sendLeave = () => {
        if (left) return;
        left = true; clearHeartbeat();
        try { Promise.resolve(leave(orderId, checkoutViewId, { paymentInProgress })).catch(() => {}); } catch { /* Lease expiry covers unavailable unload transport. */ }
    };
    const pageHide = () => sendLeave();
    const pageShow = event => { if (event.persisted && left) lose({ code: 'WALLET_VIEW_CLOSED' }); };
    return {
        setCallbacks(value) { callbacks = value; },
        mount() {
            mounted = true; const current = ++generation;
            events.addEventListener('pagehide', pageHide); events.addEventListener('pageshow', pageShow);
            if (left) lose({ code: 'WALLET_VIEW_CLOSED' });
            startHeartbeat();
            return () => {
                mounted = false; clearHeartbeat();
                events.removeEventListener('pagehide', pageHide); events.removeEventListener('pageshow', pageShow);
                // React Strict Mode immediately sets the same view up again.
                defer(() => { if (!mounted && generation === current) sendLeave(); });
            };
        },
        setReady(value) { if (ready === value) return; ready = value; startHeartbeat(); },
        recover: lose,
        async protect() { ++protectionVersion; clearing = false; paymentInProgress = true; return beat(true); },
        clearProtection() {
            if (!mounted || !ready || left || lost) return Promise.resolve();
            const current = ++protectionVersion; clearing = true;
            return beat(false).then(() => { if (current === protectionVersion) paymentInProgress = false; })
                .catch(() => { /* Keep the protected lease when acknowledgement is lost. */ })
                .finally(() => { if (current === protectionVersion) clearing = false; });
        },
    };
}
