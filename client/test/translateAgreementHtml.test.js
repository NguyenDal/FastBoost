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
    providerUsername: 'PreviewBooster', startsAt: '2026-11-01', companySignerName: 'Alex Example', companySignerEmail: 'owner@example.test',
};

test('Vietnamese reading view covers the static agreement without changing legal placeholders', () => {
    const staticNodes = [...asset.matchAll(/>([^<>]+)</gu)].map(match => match[1].trim()).filter(Boolean);
    const untranslated = [...new Set(staticNodes.filter(value => !agreementVietnameseTranslations.has(value)
        && !/^(?:\d\d|A|#|\/|·|\[[^\]]+\]|support@fastboost\.gg|FastBoost|\.)$/u.test(value)))];
    assert.deepEqual(untranslated, [], `untranslated source text: ${untranslated.join(' | ')}`);
    assert.doesNotMatch(asset, /Permitted service scope — required|Jurisdiction addendum \/ variations — required|Authorized signatory, if a business|Approved data-access countries/u);
    assert.doesNotMatch(asset, /class="fb-summary"|class="fb-agreement-note"|class="fb-permalink"/u);
    assert.match(asset, /FastBoost completes all required details and signs the saved agreement first/u);
    assert.match(asset, /The Provider then reviews the completed document and signs that same version/u);
    assert.match(asset, /<tr><td>Start date<\/td><td><span class="fb-template">\[EFFECTIVE_DATE\]<\/span><\/td><\/tr>/u);
    assert.doesNotMatch(asset, /Work location \/ local time zone|\[EndDate\]|\[ProviderTimeZone\]|\[PaymentMethod\]|\[FeeRule\]|\[PayeeLegalName\]/u);
    assert.deepEqual(agreement.commercialFields().map(field => field.key), ['WorkLocation', 'ReferenceLanguage']);
    assert.match(asset, /<tr><td>Payment method<\/td><td>Manual transfer via <strong>Remitly<\/strong>\. Recipient and banking details are collected and verified separately through an approved secure process before payment\.<\/td><\/tr>/u);
    assert.match(asset, /FastBoost pays all fees for the agreed transfer/u);
    assert.ok(agreementVietnameseTranslations.has('Permitted service scope — required'), 'historical 2.1 snapshots can still be translated');
    assert.ok(agreementVietnameseTranslations.has('Jurisdiction addendum / variations — required'));
    assert.ok(agreementVietnameseTranslations.has('Authorized signatory, if a business'));
    assert.ok(agreementVietnameseTranslations.has('. Approved data-access countries:'));
});

test('Vietnamese view preserves completed terms and company-first signatures without a notice banner', () => {
    const values = Object.fromEntries(agreement.commercialFields().map(field => [field.key, field.defaultValue || 'Example']));
    Object.assign(values, { WorkLocation: 'Home' });
    const snapshot = agreement.createSnapshot(contract, values);
    const html = agreement.renderHtml(snapshot, [{ role: 'COMPANY', legalName: 'Home', initials: 'EN', signedAt: '2026-10-22T12:00:00Z', signature: { type: 'typed' } }]);
    assert.equal(translateAgreementHtml(html, 'en'), html, 'English is the exact server-rendered agreement');
    const vi = translateAgreementHtml(html, 'vi');
    assert.match(vi, /<html lang="vi"/u);
    assert.doesNotMatch(vi, /fb-translation-notice/u);
    assert.match(vi, /FB-BSA-2\.4/u);
    assert.match(vi, /Các bên, ngày bắt đầu và tài liệu hợp đồng/u);
    const companyFirstClause = [...agreementVietnameseTranslations.keys()].find(text => text.includes('FastBoost completes all required details and signs the saved agreement first.'));
    assert.ok(companyFirstClause);
    assert.ok(vi.includes(agreementVietnameseTranslations.get(companyFirstClause)));
    assert.doesNotMatch(vi, /class="fb-summary"|class="fb-agreement-note"|class="fb-permalink"/u);
    assert.equal(snapshot.values.EffectiveDate, '2026-11-01', 'the stored effective date stays ISO');
    assert.match(html, /data-native-date="2026-11-01">November 1, 2026<\/span>/u);
    assert.match(vi, /data-native-date="2026-11-01">1 tháng 11 năm 2026<\/span>/u);
    assert.doesNotMatch(vi, /<input\b|<textarea\b|data-native-field="(?:EndDate|ProviderTimeZone|PaymentMethod|FeeRule|PayeeLegalName)"/u);
    assert.ok(vi.indexOf('<h3>FASTBOOST</h3>') < vi.indexOf('<h3>BÊN CUNG CẤP</h3>'), 'FastBoost signature appears first');
    assert.doesNotMatch(vi, />Parties, start date and contract documents</u);
    assert.match(vi, /data-native-field="WorkLocation"><span data-native-value>Home<\/span>/u);
    assert.match(vi, /<td>Phương thức thanh toán<\/td><td>Chuyển tiền thủ công qua <strong>Remitly<\/strong>\. Thông tin người nhận và thông tin ngân hàng được thu thập và xác minh riêng thông qua quy trình bảo mật đã được phê duyệt trước khi thanh toán\.<\/td>/u);
    assert.match(vi, /FastBoost thanh toán cho Bên Cung cấp qua Remitly bằng thông tin người nhận được xác minh riêng trước khi thanh toán\./u);
    assert.match(html, /data-native-field="ReferenceLanguage"><span data-native-value>English\/Vietnamese<\/span>/u);
    assert.match(vi, /data-native-field="ReferenceLanguage"><span data-native-value>Tiếng Anh\/Tiếng Việt<\/span>/u);
    assert.doesNotMatch(vi, /data-native-field="(?:AuthorizedSignatory|ServiceScope|JurisdictionAddendum|DataAccessCountries)"/u);
    assert.match(vi, /Người ký<\/span>\s*<strong>Home, kinh doanh dưới tên FastBoost<\/strong>/u, 'saved signer name remains unchanged');
    assert.match(vi, /class="fb-signature-script" data-native-value>Home<\/span>/u, 'typed signature is never translated');
    assert.match(vi, /datetime="2026-10-22T12:00:00.000Z"/u, 'exact signing timestamp is retained');
    assert.match(vi, />22\/10\/2026 · 12:00 UTC<\/time>/u);
    assert.match(vi, /Người ký|Chữ viết tắt · Phụ lục A/u);
    assert.match(vi, /Chưa có chữ ký/u);
    assert.match(vi, /Home, kinh doanh dưới tên FastBoost/u, 'the recorded signer is kept while its fixed descriptor is translated');
    assert.equal((vi.match(/data-native-field="WorkLocation"/gu) || []).length, 1);
    assert.match(vi, /href="mailto:support@fastboost\.gg"/u);
});

test('Vietnamese dates localize only validated display markers, never saved values or signature dates', () => {
    const html = `<html lang="en"><body><span class="fb-template"><span data-native-date="2028-02-29">February 29, 2028</span></span><span data-native-date="2026-02-30">Invalid date stays</span><span class="fb-template">2026-11-01</span><span data-native-field="PayeeLegalName"><span data-native-value>November 1, 2026</span></span><p class="fb-signline">Date: <strong>2026-11-01</strong></p><textarea><span data-native-date="2026-11-01">Keep literal text</span></textarea></body></html>`;
    assert.equal(translateAgreementHtml(html, 'en'), html);
    const vi = translateAgreementHtml(html, 'vi');
    assert.match(vi, /data-native-date="2028-02-29">29 tháng 2 năm 2028<\/span>/u);
    assert.match(vi, /data-native-date="2026-02-30">Invalid date stays<\/span>/u);
    assert.match(vi, /class="fb-template">2026-11-01<\/span>/u, 'historical unmarked date remains unchanged');
    assert.match(vi, /data-native-value>November 1, 2026<\/span>/u, 'saved field values are not translated');
    assert.match(vi, /<strong>2026-11-01<\/strong>/u, 'signature date remains unchanged');
    assert.match(vi, /data-native-date="2026-11-01">Keep literal text<\/span>/u);
});

test('historical 2.3 retains its agreed payee and payment wording in the Vietnamese view', () => {
    const payment = [...agreementVietnameseTranslations.keys()].find(text => text.startsWith('FastBoost pays by Remitly to the verified payee in Schedule A.'));
    const language = [...agreementVietnameseTranslations.keys()].find(text => text.startsWith('The signed agreement is the English Booster Service Agreement, version FB-BSA-2.3.'));
    assert.ok(payment);
    assert.ok(language);
    const html = `<html lang="en"><body><p>Agreement version · FB-BSA-2.3</p><p>${payment}</p><p>${language}</p><table><tr><td>Method / payee — required</td><td>Manual transfer via <strong>Remitly</strong>; verified payee <span class="fb-template"><span data-native-field="PayeeLegalName"><span data-native-value>Historical Recipient</span></span></span>. Banking details collected separately and securely.</td></tr></table></body></html>`;
    const vi = translateAgreementHtml(html, 'vi');
    assert.equal(translateAgreementHtml(html, 'en'), html);
    assert.match(vi, /Phiên bản thỏa thuận · FB-BSA-2\.3/u);
    assert.doesNotMatch(vi, /FB-BSA-2\.4/u);
    assert.ok(vi.includes(agreementVietnameseTranslations.get(payment)));
    assert.ok(vi.includes(agreementVietnameseTranslations.get(language)));
    assert.match(vi, /Phương thức \/ người nhận — bắt buộc/u);
    assert.match(vi, /data-native-field="PayeeLegalName"><span data-native-value>Historical Recipient<\/span>/u);
    assert.match(vi, /Thông tin ngân hàng được thu thập riêng và an toàn/u);
});

test('historical 2.1 snapshots retain their version and removed-row translations without a notice banner', () => {
    const clause = [...agreementVietnameseTranslations.keys()].find(text => text.startsWith('This is the English-language Booster Service Agreement, version FB-BSA-2.1.'));
    assert.ok(clause);
    const oldHtml = `<!doctype html><html lang="en"><head></head><body><div class="fb-hero"><div class="fb-container"><p>Agreement version · FB-BSA-2.1</p></div></div><p>${clause}</p><table><tr><td>Permitted service scope — required</td><td><span class="fb-template"><span data-native-field="ServiceScope"><span data-native-value>Historical accepted scope</span></span></span></td></tr><tr><td>Jurisdiction addendum / variations — required</td><td><span class="fb-template"><span data-native-field="JurisdictionAddendum"><span data-native-value>Historical signed addendum</span></span></span></td></tr></table></body></html>`;
    const vi = translateAgreementHtml(oldHtml, 'vi');
    assert.doesNotMatch(vi, /fb-translation-notice/u);
    assert.match(vi, /FB-BSA-2\.1/u);
    assert.match(vi, /Không có phiên bản tiếng Việt nào được dẫn chiếu/u);
    assert.match(vi, /Phạm vi dịch vụ được phép — bắt buộc/u);
    assert.match(vi, /Phụ lục theo khu vực pháp lý \/ thay đổi — bắt buộc/u);
    assert.match(vi, /data-native-value>Historical accepted scope<\/span>/u);
    assert.match(vi, /data-native-value>Historical signed addendum<\/span>/u);
});
