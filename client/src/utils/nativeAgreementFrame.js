const STYLESHEETS = ['/legal/legal-document.css', '/legal/provider-agreement.css'];
const FONTS = ['/legal/fonts/DancingScript.ttf', '/legal/fonts/GreatVibes-Regular.ttf'];
const ACTIVE_ELEMENTS = 'script,base,iframe,frame,frameset,object,embed,applet,template,noscript,foreignObject,animate,animateMotion,animateTransform,set,use,math,audio,video,source,track';
const NETWORK_ATTRIBUTES = new Set(['srcset', 'imagesrcset', 'ping', 'action', 'formaction', 'poster', 'background', 'srcdoc', 'manifest']);

function safeLink(value, origin) {
    try { return ['http:', 'https:', 'mailto:'].includes(new URL(value, origin).protocol); }
    catch { return false; }
}

// Safari blocks even parent-installed React event listeners when the iframe's
// sandbox disallows scripts (WebKit 218086). The frame therefore permits those
// listeners, while this CSP blocks all scripts supplied by the document itself.
// This is a presentation copy only: saved agreement HTML and hashes stay intact.
export function buildNativeAgreementFrameHtml(html, origin = window.location.origin) {
    if (!html) return '';
    const location = new URL(origin);
    if (!['http:', 'https:'].includes(location.protocol)) throw new Error('The agreement requires a website origin.');
    const site = location.origin;
    const stylesheetUrls = new Set(STYLESHEETS.map(path => `${site}${path}`));
    const doc = new DOMParser().parseFromString(html, 'text/html');

    for (const element of doc.querySelectorAll(ACTIVE_ELEMENTS)) element.remove();
    // Remove refresh and any competing document policy before adding our own.
    for (const element of doc.querySelectorAll('meta[http-equiv]')) element.remove();
    for (const link of doc.querySelectorAll('link')) {
        let url;
        try { url = new URL(link.getAttribute('href') || '', site).href; } catch { /* Removed below. */ }
        if (link.getAttribute('rel')?.toLowerCase() !== 'stylesheet' || !stylesheetUrls.has(url)) link.remove();
    }
    for (const element of doc.querySelectorAll('*')) {
        element.removeAttribute('data-native-agreement-link');
        for (const attribute of [...element.attributes]) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value;
            if (name === 'href' || name === 'xlink:href') {
                if (element.localName === 'link' && name === 'href') continue;
                // A navigation would replace this srcdoc and its CSP. Keep the
                // visible link text, but leave navigation to trusted parent UI.
                if (element.localName === 'a' && safeLink(value, site)) element.setAttribute('data-native-agreement-link', value);
                element.removeAttribute(attribute.name);
                continue;
            }
            if (name.startsWith('on') || NETWORK_ATTRIBUTES.has(name)
                || (name === 'src' && !(element.localName === 'img' && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)))) {
                element.removeAttribute(attribute.name);
            }
        }
    }

    const policy = doc.createElement('meta');
    policy.setAttribute('http-equiv', 'Content-Security-Policy');
    policy.setAttribute('content', [
        "default-src 'none'",
        "script-src 'none'",
        "script-src-elem 'none'",
        "script-src-attr 'none'",
        `style-src 'unsafe-inline' ${[...stylesheetUrls].join(' ')}`,
        `font-src ${FONTS.map(path => `${site}${path}`).join(' ')}`,
        'img-src data:',
        "connect-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join('; '));
    // The policy must precede every stylesheet/style and any other document node.
    doc.head.prepend(policy);
    return '<!doctype html>' + doc.documentElement.outerHTML;
}
