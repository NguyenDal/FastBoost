function publicAssetUrl(referenceUrl, key) {
    const origin = new URL(referenceUrl);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
        throw new Error('Public asset origin is invalid');
    }
    if (!/^(?:logos|services|roles|updates)\/[a-z0-9/_-]+\.(?:png|jpe?g|webp|svg)$/i.test(key)) {
        throw new Error('Public asset path is invalid');
    }
    return new URL(`/assets/${key}`, origin).href;
}

module.exports = { publicAssetUrl };
