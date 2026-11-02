import { canonicalOrderPathForTitle } from './productRoutes.js';

const CONSENT_KEY = 'fastboost:ad-measurement:v1';

function readConsent(storage) {
    try {
        const value = JSON.parse(storage?.getItem(CONSENT_KEY) || 'null');
        return ['granted', 'denied'].includes(value) ? value : null;
    } catch { return null; }
}

// Resolve only known, rendered services. Legacy service-ID links may resolve to
// a canonical public path, but their IDs are never sent to Google.
export function servicePriceViewPath(pathname, service) {
    if (!service?.id || service.active === false || typeof pathname !== 'string') return null;
    const canonical = canonicalOrderPathForTitle(service.title);
    if (!canonical) return null;
    return pathname === canonical || pathname === `/order/${encodeURIComponent(String(service.id))}` ? canonical : null;
}

export function createGoogleAdsMeasurement({ win, doc, storage, config = {}, now = Date.now }) {
    const tagId = String(config.tagId || '').trim();
    const label = String(config.label || '').trim();
    const enabled = /^AW-\d+$/.test(tagId) && /^[A-Za-z0-9_-]+$/.test(label);
    const destination = `${tagId}/${label}`;
    const listeners = new Set();
    let consent = readConsent(storage);
    let loading;
    let started = false;
    let page;

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
        // Global context must never disclose private paths, auth/payment query
        // strings or user-supplied data. Retain only Google's attribution IDs.
        const location = new URL(win.location.href);
        const safeLocation = new URL(location.origin);
        for (const name of ['gclid', 'gbraid', 'wbraid']) {
            const value = location.searchParams.get(name);
            if (value && /^[A-Za-z0-9_-]{1,512}$/.test(value)) safeLocation.searchParams.set(name, value);
        }
        let referrer = '';
        try { referrer = new URL(doc.referrer).origin; } catch { /* No valid referrer. */ }
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

    // Called by the router before page effects. Leaving the page invalidates
    // async work. Query/hash changes and rerenders are not new price checks.
    function setPage({ pathname } = {}) {
        if (page?.pathname === pathname) return;
        page = typeof pathname === 'string' ? { pathname, path: null, blocked: consent === 'denied', sent: false, pending: null } : null;
    }

    function dispatch(entry) {
        if (!enabled || !entry?.path || entry !== page || entry.blocked || entry.sent || consent !== 'granted') return Promise.resolve(false);
        if (entry.pending) return entry.pending;
        entry.pending = (async () => {
            try {
                if (!await loadTag() || page !== entry || !entry.path || entry.blocked || entry.sent || consent !== 'granted') return false;
                // Mark at dispatch, not callback: an unavailable callback must
                // never turn rerenders or repeated permission changes into views.
                entry.sent = true;
                command('event', 'conversion', {
                    send_to: destination,
                    page_location: new URL(entry.path, win.location.origin).href,
                    page_title: 'FastBoost service pricing',
                });
                return true;
            } catch { return false; }
            finally { entry.pending = null; }
        })();
        return entry.pending;
    }

    function recordServiceView({ pathname, service } = {}) {
        const path = servicePriceViewPath(pathname, service);
        if (!enabled || page?.pathname !== pathname) return Promise.resolve(false);
        page.path = path;
        return dispatch(page);
    }

    function setConsent(value) {
        if (!enabled || !['granted', 'denied'].includes(value)) return;
        consent = value;
        try { storage?.setItem(CONSENT_KEY, JSON.stringify(value)); } catch { /* Private browsing. */ }
        if (typeof win?.gtag === 'function') command('consent', 'update', consentValues(value === 'granted'));
        if (value === 'denied') {
            if (page) page.blocked = true;
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
            // First opt-in may measure the currently rendered page. A previous
            // denial or a departed page never becomes a queued conversion.
            void dispatch(page);
        }
        listeners.forEach(listener => listener());
    }

    function start() {
        // Retire identifiers retained by the removed purchase integration.
        try { storage?.removeItem('fastboost:ads-purchases:v1'); win?.sessionStorage?.removeItem('fastboost:checkout-attempts:v1'); } catch { /* Storage unavailable. */ }
        if (!enabled || started || !win) return;
        started = true;
        void loadTag();
        win.addEventListener('storage', event => {
            if (event.key !== CONSENT_KEY && event.key !== null) return;
            setConsent(readConsent(storage) || 'denied');
        });
    }

    return { enabled, start, setPage, recordServiceView, getConsent: () => consent, setConsent,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
}

const browser = typeof window === 'undefined' ? undefined : window;
let localStore;
try { localStore = browser?.localStorage; } catch { /* Keep in-memory consent. */ }
export const googleAdsMeasurement = createGoogleAdsMeasurement({ win: browser,
    doc: typeof document === 'undefined' ? undefined : document, storage: localStore,
    config: { tagId: import.meta.env?.VITE_GOOGLE_ADS_ID, label: import.meta.env?.VITE_GOOGLE_ADS_SERVICE_PRICE_VIEW_LABEL } });
