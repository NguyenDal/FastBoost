const test = require('node:test');
const assert = require('node:assert/strict');
const { renderConfirmation } = require('../src/utils/orderConfirmationTemplate');
const { renderCompletion } = require('../src/utils/orderCompletionTemplate');
const { renderBoosterOrderEmail } = require('../src/utils/boosterOrderEmailTemplate');
const { buildNativeContractEmail } = require('../src/utils/nativeContractEmailTemplate');
const { publicAssetUrl } = require('../src/utils/publicAssetUrl');

test('email images use the site asset origin instead of public S3', () => {
    const url = 'https://fastboost.gg/match/order-1';
    const pages = [
        renderConfirmation({ orderNumber: 'ORDER-1', summary: { serviceType: 'Rank Boost', currentRank: 'Gold IV', targetRank: 'Platinum IV' }, rows: [], url }),
        renderCompletion({ orderNumber: 'ORDER-1', rows: [], ratingUrl: url, orderUrl: url }),
        renderBoosterOrderEmail({ copy: { title: 'Assigned', subject: 'Assigned', badge: 'ASSIGNED', text: 'Order assigned', action: 'Open order' }, orderNumber: 'ORDER-1', rows: [], url }),
        buildNativeContractEmail({ id: '3b41a71d-36ec-4a90-a311-f436a50de6bd', signerName: 'Example Booster' }, 'ISSUED', { clientUrl: 'https://fastboost.gg', nodeEnv: 'production' }).html,
    ];
    for (const html of pages) {
        assert.match(html, /https:\/\/(?:www\.)?fastboost\.gg\/assets\/logos\/fastboost-logo\.png/);
        assert.doesNotMatch(html, /fastboost-assets\.s3/);
    }
    assert.match(pages[0], /https:\/\/fastboost\.gg\/assets\/services\/ranks\/gold\.png/);
    assert.match(pages[0], /https:\/\/fastboost\.gg\/assets\/services\/ranks\/platinum\.png/);
});

test('email asset URL builder accepts only known static paths', () => {
    assert.equal(publicAssetUrl('https://fastboost.gg/order/1', 'logos/fastboost-logo.png'), 'https://fastboost.gg/assets/logos/fastboost-logo.png');
    assert.throws(() => publicAssetUrl('https://fastboost.gg/', '../profiles/user.png'), /path is invalid/);
});
