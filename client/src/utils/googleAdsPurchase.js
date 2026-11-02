const CONSENT_KEY = 'fastboost:ad-measurement:v1';
const SENT_KEY = 'fastboost:ads-purchases:v1';
const ATTEMPT_KEY = 'fastboost:checkout-attempts:v1';
const DAY = 24 * 60 * 60 * 1000;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

function readJson(storage, key, fallback) {
    try { return JSON.parse(storage?.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function writeJson(storage, key, value) {
    try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable in private browsing. */ }
}

export function createGoogleAdsPurchaseTracker({ win, doc, storage, sessionStorage, config = {}, now = Date.now }) {
    const tagId = String(config.tagId || '').trim();
    const label = String(config.label || '').trim();
    const enabled = /^AW-\d+$/.test(tagId) && /^[A-Za-z0-9_-]+$/.test(label);
    const destination = `${tagId}/${label}`;
    const listeners = new Set();
    const sent = new Set();
    const attempts = new Map();
    const pending = new Map();
    const inFlight = new Map();
    let consent = readJson(storage, CONSENT_KEY, null);
    if (!['granted', 'denied'].includes(consent)) consent = null;
    let loading;
    let started = false;

    const notify = () => listeners.forEach(listener => listener());
    const command = (...args) => win.gtag(...args);
    const consentValues = granted => ({ ad_storage: granted ? 'granted' : 'denied',
        ad_user_data: granted ? 'granted' : 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });

    function loadTag() {
        if (!enabled || consent !== 'granted' || !win || !doc) return Promise.resolve(false);
        if (loading) return loading;
        win.dataLayer = win.dataLayer || [];
        win.gtag = win.gtag || function () { win.dataLayer.push(arguments); };
        command('consent', 'default', consentValues(false));
        command('consent', 'update', consentValues(true));
        // Never forward checkout query strings, auth tokens, names or email.
        // Only Google's own click identifiers are retained for attribution.
        const location = new URL(win.location.href);
        const safeLocation = new URL(location.origin);
        for (const name of ['gclid', 'gbraid', 'wbraid']) {
            const value = location.searchParams.get(name);
            if (value && /^[A-Za-z0-9_-]{1,512}$/.test(value)) safeLocation.searchParams.set(name, value);
        }
        let referrer = '';
        try { referrer = new URL(doc.referrer).origin; } catch { /* No valid external referrer. */ }
        command('set', { page_location: safeLocation.href, page_referrer: referrer,
            page_title: 'FastBoost', allow_ad_personalization_signals: false, ads_data_redaction: true });
        command('js', new Date(now()));
        command('config', tagId, { send_page_view: false, allow_enhanced_conversions: false });
        loading = new Promise(resolve => {
            const script = doc.createElement('script');
            let settled = false;
            const finish = success => {
                if (settled) return;
                settled = true;
                win.clearTimeout(timer);
                if (!success) { loading = null; script.remove(); }
                // Cache script readiness, not the consent at load time. Every
                // dispatch rechecks consent, including after a later re-opt-in.
                resolve(success);
            };
            const timer = win.setTimeout(() => finish(false), 10000);
            script.async = true;
            script.referrerPolicy = 'origin';
            script.src = `https://www.googletagmanager.com/gtag/js?id=${tagId}`;
            script.dataset.fastboostAds = 'true';
            script.onload = () => finish(true);
            script.onerror = () => finish(false);
            doc.head.appendChild(script);
        });
        return loading;
    }

    function hasAttempt(orderId, paidAt) {
        const stored = readJson(sessionStorage, ATTEMPT_KEY, {});
        const attemptedAt = attempts.get(orderId) ?? stored?.[orderId];
        return Number.isFinite(attemptedAt) && now() - attemptedAt <= DAY &&
            attemptedAt <= now() && paidAt >= attemptedAt - 5000;
    }

    function beginCheckout(orderId) {
        if (!enabled || consent !== 'granted' || !validId(orderId)) return;
        attempts.set(orderId, now());
        const stored = readJson(sessionStorage, ATTEMPT_KEY, {});
        const fresh = Object.fromEntries(Object.entries(stored && typeof stored === 'object' ? stored : {})
            .filter(([, time]) => Number.isFinite(time) && now() - time <= DAY));
        writeJson(sessionStorage, ATTEMPT_KEY, { ...fresh, [orderId]: now() });
    }

    function wasSent(key) {
        const persisted = readJson(storage, SENT_KEY, {});
        return sent.has(key) || (persisted && typeof persisted === 'object' && Number.isFinite(persisted[key]));
    }

    function validate(response, recentReturn) {
        const item = response?.purchaseConversion;
        if (response?.paid !== true || !item || !validId(item.transaction_id) || item.transaction_id !== response.orderId ||
            typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0 ||
            !Number.isSafeInteger(Math.round(item.value * 100)) ||
            Math.abs(item.value * 100 - Math.round(item.value * 100)) > 0.000001 ||
            typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency) ||
            typeof item.paidAt !== 'string') return null;
        const paidAt = Date.parse(item.paidAt);
        if (!Number.isFinite(paidAt) || paidAt > now() + 300000 || now() - paidAt > DAY ||
            (!recentReturn && !hasAttempt(item.transaction_id, paidAt))) return null;
        return { transaction_id: item.transaction_id, value: item.value, currency: item.currency, paidAt: item.paidAt };
    }

    async function recordPurchase(response, { recentReturn = false } = {}) {
        if (!enabled || consent === 'denied') return false;
        const item = validate(response, recentReturn);
        if (!item) return false;
        const key = `${destination}:${item.transaction_id}`;
        if (wasSent(key) || inFlight.has(key)) return false;
        if (consent !== 'granted') {
            // Keep only this page's verified result in memory until the visitor
            // chooses; rejection clears it and nothing is sent before opt-in.
            pending.set(key, { response, recentReturn });
            return false;
        }
        inFlight.set(key, true);
        try {
            if (!await loadTag() || consent !== 'granted') return false;
            if (wasSent(key)) return false;
            return await new Promise(resolve => {
                let settled = false;
                const finish = processed => {
                    if (settled) return;
                    settled = true;
                    win.clearTimeout(timer);
                    if (processed && consent === 'granted') {
                        sent.add(key);
                        const persisted = readJson(storage, SENT_KEY, {});
                        const entries = Object.entries(persisted && typeof persisted === 'object' ? persisted : {})
                            .filter(([, timestamp]) => Number.isFinite(timestamp)).sort((a, b) => b[1] - a[1]).slice(0, 499);
                        writeJson(storage, SENT_KEY, { ...Object.fromEntries(entries), [key]: now() });
                    }
                    resolve(processed);
                };
                const timer = win.setTimeout(() => finish(false), 10000);
                command('event', 'conversion', { send_to: destination, transaction_id: item.transaction_id,
                    value: item.value, currency: item.currency, event_callback: () => finish(true) });
            });
        } catch { return false; }
        finally { inFlight.delete(key); }
    }

    function setConsent(value) {
        if (!enabled || !['granted', 'denied'].includes(value)) return;
        consent = value;
        writeJson(storage, CONSENT_KEY, value);
        if (typeof win?.gtag === 'function') command('consent', 'update', consentValues(value === 'granted'));
        if (value === 'denied') {
            pending.clear();
            // Stop this site's future events and remove its first-party ad cookies.
            for (const cookie of (doc?.cookie || '').split(';')) {
                const name = cookie.trim().split('=')[0];
                if (/^_gcl_/.test(name)) {
                    const host = win.location.hostname;
                    for (const domain of ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`])
                        doc.cookie = `${name}=; Max-Age=0; path=/;${domain ? ` domain=${domain};` : ''} SameSite=Lax`;
                }
            }
        } else {
            void loadTag();
            for (const item of pending.values()) void recordPurchase(item.response, { recentReturn: item.recentReturn });
            pending.clear();
        }
        notify();
    }

    function start() {
        if (!enabled || started || !win) return;
        started = true;
        void loadTag();
        win.addEventListener('storage', event => {
            if (event.key !== CONSENT_KEY) return;
            const changed = readJson(storage, CONSENT_KEY, null);
            if (changed === 'granted' || changed === 'denied') setConsent(changed);
        });
    }

    return { enabled, start, beginCheckout, recordPurchase, hasCheckoutAttempt: orderId => hasAttempt(orderId, now()),
        getConsent: () => consent, setConsent,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
}

const browser = typeof window === 'undefined' ? undefined : window;
let localStore, sessionStore;
try { localStore = browser?.localStorage; sessionStore = browser?.sessionStorage; } catch { /* Keep in-memory protection. */ }
export const googleAdsPurchase = createGoogleAdsPurchaseTracker({ win: browser,
    doc: typeof document === 'undefined' ? undefined : document, storage: localStore, sessionStorage: sessionStore,
    config: { tagId: import.meta.env?.VITE_GOOGLE_ADS_ID, label: import.meta.env?.VITE_GOOGLE_ADS_PURCHASE_LABEL } });
