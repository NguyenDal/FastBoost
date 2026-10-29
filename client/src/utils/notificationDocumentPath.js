export function notificationDocumentPath(notification) {
    const path = notification?.data?.targetPath;
    if (typeof path !== 'string') return null;
    const patterns = {
        BOOSTER_CONTRACT: /^\/provider\/contracts\/[a-zA-Z0-9-]+$/,
        BOOSTER_PAYOUT_INFORMATION: /^\/provider\/payout-information\/[a-zA-Z0-9-]+$/,
    };
    return patterns[notification.type]?.test(path) ? path : null;
}
