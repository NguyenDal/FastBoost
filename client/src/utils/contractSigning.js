export const CONTRACT_SIGNING_CHANNEL = 'fastboost:contract-signing';

export function nativeContractBoosterFirst(contract) {
    if (contract?.signingOrder) return contract.signingOrder === 'BOOSTER_FIRST';
    // Only partially signed 2.2 agreements retain the earlier signing order.
    // Unsigned drafts are prepared using the current, company-first agreement.
    return contract?.templateId === 'FB-BSA-2.2' && Boolean(contract.boosterSignedAt || contract.companySignedAt);
}

export function nativeContractPendingStatus(contract) {
    if (!contract?.documentAvailable) return 'Complete agreement';
    const boosterFirst = nativeContractBoosterFirst(contract);
    if (boosterFirst && !contract.boosterSignedAt) return 'Awaiting booster';
    if (!contract.companySignedAt) return 'Awaiting FastBoost';
    return contract.boosterSignedAt ? 'Confirming signatures' : 'Awaiting booster';
}

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
