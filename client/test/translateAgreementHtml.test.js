import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { translateAgreementHtml, agreementVietnameseTranslations } from '../src/utils/translateAgreementHtml.js';

const require = createRequire(import.meta.url);
const agreement = require('../../server/src/utils/nativeAgreement.js');
const asset = readFileSync(new URL('../../server/private/legal/provider-agreement-native.html', import.meta.url), 'utf8');
const contract = {
    id: '00000000-0000-4000-8000-000000000001', signerName: 'Jordan Example', signerEmail: 'booster@example.test',
    providerUsername: 'PreviewBooster', startsAt: '2026-10-22', companySignerName: 'Alex Example', companySignerEmail: 'owner@example.test',
};

test('Vietnamese reading view covers the static agreement without changing legal placeholders', () => {
    const staticNodes = [...asset.matchAll(/>([^<>]+)</gu)].map(match => match[1].trim()).filter(Boolean);
    const untranslated = [...new Set(staticNodes.filter(value => !agreementVietnameseTranslations.has(value)
        && !/^(?:\d\d|A|#|\/|·|\[[^\]]+\]|support@fastboost\.gg|FastBoost|\.)$/u.test(value)))];
    assert.deepEqual(untranslated, [], `untranslated source text: ${untranslated.join(' | ')}`);
    assert.doesNotMatch(asset, /Permitted service scope — required|Jurisdiction addendum \/ variations — required|Authorized signatory, if a business|Approved data-access countries/u);
    assert.doesNotMatch(asset, /class="fb-summary"|class="fb-agreement-note"|class="fb-permalink"/u);
    assert.match(asset, /FastBoost completes the commercial settings before the Provider signs/u);
    assert.match(asset, /The Provider signs the saved agreement first, and FastBoost countersigns that same version/u);
    const locationRow = asset.match(/<tr><td>Work location \/ local time zone — required<\/td><td>[\s\S]*?<\/td><\/tr>/u)?.[0];
    assert.ok(locationRow);
    assert.match(locationRow, /Work location: .*Local time zone:/u);
    assert.doesNotMatch(locationRow, /<\/span> \/ <span/u);
    assert.doesNotMatch(asset, /FastBoost completes and signs first/u);
    assert.ok(agreementVietnameseTranslations.has('Permitted service scope — required'), 'historical 2.1 snapshots can still be translated');
    assert.ok(agreementVietnameseTranslations.has('Jurisdiction addendum / variations — required'));
    assert.ok(agreementVietnameseTranslations.has('Authorized signatory, if a business'));
    assert.ok(agreementVietnameseTranslations.has('. Approved data-access countries:'));
});

test('Vietnamese view preserves dynamic terms and signatures while explaining the signed language', () => {
    const values = Object.fromEntries(agreement.commercialFields().map(field => [field.key, field.defaultValue || 'Example']));
    Object.assign(values, { WorkLocation: 'Home', PayeeLegalName: 'Paid' });
    const snapshot = agreement.createSnapshot(contract, values);
    const html = agreement.renderHtml(snapshot, [{ role: 'COMPANY', legalName: 'Home', initials: 'EN', signedAt: '2026-10-22T12:00:00Z', signature: { type: 'typed' } }]);
    assert.equal(translateAgreementHtml(html, 'en'), html, 'English is the exact server-rendered agreement');
    const vi = translateAgreementHtml(html, 'vi');
    assert.match(vi, /<html lang="vi"/u);
    assert.match(vi, /Bản tiếng Việt này giúp bạn đọc và hiểu thỏa thuận/u);
    assert.match(vi, /Các điều khoản được ký vẫn là bản tiếng Anh FB-BSA-2\.2/u);
    assert.match(vi, /Các bên, ngày bắt đầu và tài liệu hợp đồng/u);
    assert.match(vi, /FastBoost hoàn tất các thông tin thương mại trước khi Bên Cung cấp ký/u);
    assert.match(vi, /Bên Cung cấp ký bản thỏa thuận đã lưu trước, sau đó FastBoost ký sau trên chính phiên bản đó/u);
    assert.doesNotMatch(vi, /class="fb-summary"|class="fb-agreement-note"|class="fb-permalink"/u);
    assert.match(vi, /Nơi làm việc: <span class="fb-template">/u);
    assert.match(vi, /Múi giờ địa phương: <span class="fb-template">/u);
    assert.ok(vi.indexOf('<h3>BÊN CUNG CẤP</h3>') < vi.indexOf('<h3>FASTBOOST</h3>'), 'provider signature appears first');
    assert.doesNotMatch(vi, />Parties, start date and contract documents</u);
    assert.match(vi, /data-native-field="WorkLocation"><span data-native-value>Home<\/span>/u);
    assert.match(vi, /data-native-field="PayeeLegalName"><span data-native-value>Paid<\/span>/u);
    assert.match(html, /data-native-field="ReferenceLanguage"><span data-native-value>English\/Vietnamese<\/span>/u);
    assert.match(vi, /data-native-field="ReferenceLanguage"><span data-native-value>Tiếng Anh\/Tiếng Việt<\/span>/u);
    assert.doesNotMatch(vi, /data-native-field="(?:AuthorizedSignatory|ServiceScope|JurisdictionAddendum|DataAccessCountries)"/u);
    assert.match(vi, /Chữ ký: <strong>Home<\/strong>/u, 'saved signer name remains unchanged');
    assert.match(vi, /Alex Example, kinh doanh dưới tên FastBoost/u, 'the company identity is kept while its fixed descriptor is translated');
    assert.equal((vi.match(/data-native-field="WorkLocation"/gu) || []).length, 2);
    assert.match(vi, /href="mailto:support@fastboost\.gg"/u);
});

test('historical 2.1 snapshots keep their own version notice and removed-row translations', () => {
    const clause = [...agreementVietnameseTranslations.keys()].find(text => text.startsWith('This is the English-language Booster Service Agreement, version FB-BSA-2.1.'));
    assert.ok(clause);
    const oldHtml = `<!doctype html><html lang="en"><head></head><body><div class="fb-hero"><div class="fb-container"><p>Agreement version · FB-BSA-2.1</p></div></div><p>${clause}</p><table><tr><td>Permitted service scope — required</td><td><span class="fb-template"><span data-native-field="ServiceScope"><span data-native-value>Historical accepted scope</span></span></span></td></tr><tr><td>Jurisdiction addendum / variations — required</td><td><span class="fb-template"><span data-native-field="JurisdictionAddendum"><span data-native-value>Historical signed addendum</span></span></span></td></tr></table></body></html>`;
    const vi = translateAgreementHtml(oldHtml, 'vi');
    assert.match(vi, /Các điều khoản được ký vẫn là bản tiếng Anh FB-BSA-2\.1/u);
    assert.match(vi, /Không có phiên bản tiếng Việt nào được dẫn chiếu/u);
    assert.match(vi, /Phạm vi dịch vụ được phép — bắt buộc/u);
    assert.match(vi, /Phụ lục theo khu vực pháp lý \/ thay đổi — bắt buộc/u);
    assert.match(vi, /data-native-value>Historical accepted scope<\/span>/u);
    assert.match(vi, /data-native-value>Historical signed addendum<\/span>/u);
});
