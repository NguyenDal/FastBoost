import { buildNativeAgreementFrameHtml } from '../../src/utils/nativeAgreementFrame.js';

// Run in a real browser through the client dev server:
// await (await import('/test/browser/nativeAgreementFrame.js')).verifyNativeAgreementFrame()
// This intentionally triggers CSP violations; it makes no application API calls
// and creates no signature. The temporary frame is always removed.
export async function verifyNativeAgreementFrame() {
    let assertions = 0;
    const check = (condition, message) => {
        assertions++;
        if (!condition) throw new Error(`Agreement frame regression: ${message}`);
    };
    const probe = `__agreementFrameProbe${Date.now()}`;
    const attack = `window.parent[${JSON.stringify(probe)}] += 1`;
    const source = `<!doctype html><html lang="en"><head>
        <meta http-equiv="refresh" content="0;url=data:text/html,unwanted-navigation">
        <meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'">
        <base href="https://unwanted.invalid/">
        <link rel="stylesheet" href="/legal/legal-document.css">
        <link rel="stylesheet" href="/legal/provider-agreement.css">
        <link rel="stylesheet" href="data:text/css,body{}">
        <script>${attack}</script>
        <script src="data:text/javascript,${encodeURIComponent(attack)}"></script>
        </head><body onload='${attack}'>
        <section id="parties"><h2>Parties and documents</h2>
        <p id="terms">Keep every agreed term &amp; the Provider’s name: Nguyễn An.</p>
        <table><tbody><tr><td>Country and state/province</td><td><span data-native-field="WorkLocation"><span data-native-value>Canada / Manitoba</span></span></td></tr></tbody></table>
        </section><section id="schedule-a">Schedule A</section>
        <section id="signatures"><div class="fb-signature-card" data-native-signature-role="BOOSTER">
        <svg class="fb-signature-drawing" viewBox="0 0 600 180"><polyline points="20,80 60,40 100,80" fill="none" stroke="#241a40"/>
        <foreignObject><p onmouseover='${attack}'>Unexpected active content</p></foreignObject>
        <animate attributeName="href" values="javascript:alert(1)"/>
        </svg><time data-native-date-time="2026-10-30T12:00:00.000Z">Oct 30, 2026</time></div></section>
        <a id="fragment" href="#parties">Parties</a>
        <a id="application" href="/admin/management" target="_top">Management</a>
        <a id="external" href="https://www.riotgames.com/en/terms-of-service" ping="data:text/plain,ping">Publisher terms</a>
        <a id="javascript" href="java&#115;cript:alert(1)" onclick='${attack}'>Unsafe destination</a>
        <img src="data:image/gif;base64,invalid" onerror='${attack}'>
        <iframe srcdoc="<script>parent.alert(1)</script>"></iframe>
        <object data="data:text/html,unwanted"></object>
        <template><script>${attack}</script></template>
        <form action="data:text/html,unwanted"><button formaction="data:text/html,unwanted">Unused</button></form>
        </body></html>`;
    const html = buildNativeAgreementFrameHtml(source);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const policy = parsed.head.firstElementChild;
    check(policy?.tagName === 'META' && policy.httpEquiv === 'Content-Security-Policy', 'CSP must be the first head element');
    check(parsed.querySelectorAll('meta[http-equiv]').length === 1, 'no refresh or competing CSP may survive');
    for (const directive of ["default-src 'none'", "script-src 'none'", "script-src-attr 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'"]) {
        check(policy.content.includes(directive), `missing ${directive}`);
    }
    check(!parsed.querySelector('script,iframe,object,base,template,foreignObject,animate'), 'active document elements must be removed');
    check(![...parsed.querySelectorAll('*')].some(element => [...element.attributes].some(attribute => /^on/i.test(attribute.name))), 'inline event attributes must be removed');
    check(!parsed.querySelector('[href]:not(link),[xlink\\:href],[ping],[action],[formaction],[srcdoc]'), 'document navigation and active attributes must be removed');
    check(parsed.querySelectorAll('link').length === 2, 'only the two fixed legal stylesheets may survive');
    check(parsed.getElementById('fragment').getAttribute('data-native-agreement-link') === '#parties', 'safe fragment target is retained only as inert metadata');
    check(!parsed.getElementById('javascript').hasAttribute('data-native-agreement-link'), 'javascript destinations must not become link metadata');
    check(parsed.getElementById('terms').textContent === 'Keep every agreed term & the Provider’s name: Nguyễn An.', 'legal paragraph text must stay intact');
    check(parsed.querySelector('[data-native-field="WorkLocation"] [data-native-value]').textContent === 'Canada / Manitoba', 'field markers and saved values must stay intact');
    check(parsed.querySelector('[data-native-signature-role="BOOSTER"] polyline').getAttribute('points') === '20,80 60,40 100,80', 'recorded signature geometry must stay intact');
    check(parsed.querySelector('time').getAttribute('data-native-date-time') === '2026-10-30T12:00:00.000Z', 'recorded signature timestamp must stay intact');

    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');
    frame.style.cssText = 'position:absolute;left:-10000px;width:360px;height:500px;border:0';
    window[probe] = 0;
    let inputs = 0, clicks = 0, submits = 0;
    const violations = [];
    try {
        // Check the hostile markup structurally above. This mounted fixture has
        // no resource URLs, so the browser test cannot contact another service.
        const ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Agreement test iframe did not load')), 5000);
            frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        frame.srcdoc = buildNativeAgreementFrameHtml(`<html><head><script>${attack}</script></head><body><a id="inert-link" href="/admin/management">Management</a><div id="mount"></div></body></html>`);
        document.body.append(frame);
        await ready;
        const doc = frame.contentDocument;
        doc.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
        const form = doc.createElement('form');
        const input = doc.createElement('input');
        const button = doc.createElement('button');
        button.type = 'submit'; button.textContent = 'Submit local test';
        input.addEventListener('input', () => { inputs++; });
        button.addEventListener('click', () => { clicks++; });
        form.addEventListener('submit', event => { event.preventDefault(); submits++; });
        form.append(input, button); doc.getElementById('mount').append(form);
        input.value = 'Canada / Manitoba';
        input.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
        button.click();
        check(inputs === 1, 'parent-installed input listener must receive location edits');
        check(clicks === 1, 'parent-installed click listener must receive activation');
        check(submits === 1, 'parent-installed submit listener must receive explicit submission');

        // Defence in depth: CSP must block document-owned scripts/handlers even
        // if they are inserted after sanitizing the original saved HTML.
        const script = doc.createElement('script'); script.textContent = attack; doc.head.append(script);
        button.setAttribute('onclick', attack); button.click();
        doc.getElementById('inert-link').click();
        await new Promise(resolve => setTimeout(resolve, 30));
        check(window[probe] === 0, 'no document-owned script or inline handler may execute');
        check(clicks === 2 && submits === 2, 'CSP must still permit parent-installed event callbacks');
        check(frame.contentWindow.location.href === 'about:srcdoc', 'document link must not navigate away and lose CSP');
        return { assertions, inputs, clicks, submits, documentScripts: window[probe], violations };
    } finally {
        frame.remove();
        delete window[probe];
    }
}
