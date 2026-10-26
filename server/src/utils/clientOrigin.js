const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalOrigin(value) {
    try {
        const url = new URL(value);
        return LOCAL_HOSTS.has(url.hostname) && ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

function unavailable() {
    return Object.assign(new Error('Checkout is temporarily unavailable. Please try again later.'), {
        status: 503,
        code: 'CHECKOUT_URL_UNAVAILABLE',
    });
}

function clientOrigin(req, { configured = process.env.CLIENT_URL, nodeEnv = process.env.NODE_ENV } = {}) {
    const value = typeof configured === 'string' ? configured.trim() : '';
    if (value) {
        let url;
        try { url = new URL(value); } catch { throw unavailable(); }
        const local = LOCAL_HOSTS.has(url.hostname);
        const validProtocol = url.protocol === 'https:' ||
            (nodeEnv !== 'production' && local && url.protocol === 'http:');
        if (!validProtocol || (nodeEnv === 'production' && local) || url.username || url.password ||
            url.pathname !== '/' || url.search || url.hash) throw unavailable();
        return url.origin;
    }

    // Development has a fixed local fallback. Never derive a payment return
    // destination from a request's arbitrary Origin or Host in production.
    const requestOrigin = req?.get?.('origin');
    if (nodeEnv !== 'production' &&
        (isLocalOrigin(requestOrigin) || LOCAL_HOSTS.has(req?.hostname))) return 'http://localhost:5173';
    throw unavailable();
}

module.exports = { clientOrigin };
