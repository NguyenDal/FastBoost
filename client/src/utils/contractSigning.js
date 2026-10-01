export const CONTRACT_SIGNING_CHANNEL = 'fastboost:contract-signing';

export async function openContractSigning(createView, browserWindow = window) {
    // Open during the click without window features so the browser uses a new tab.
    const popup = browserWindow.open('about:blank', '_blank');
    if (!popup) throw new Error('Allow pop-ups for FastBoost, then try signing again.');
    try {
        // The signing provider does not need access to the original app window.
        popup.opener = null;
        popup.document.title = 'Opening DocuSign…';
        popup.document.body.textContent = 'Opening DocuSign…';
        const result = await createView();
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || !['docusign.net', 'docusign.com'].some(host => url.hostname.endsWith(`.${host}`))) {
            throw new Error('Could not open the DocuSign signing tab. Please try again.');
        }
        if (popup.closed) throw new Error('The signing tab was closed. Please try again.');
        popup.location.replace(url.href);
    } catch (error) {
        if (!popup.closed) popup.close();
        throw error;
    }
}
