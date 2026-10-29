import { frontHalfTranslations } from './viAgreementFrontHalf.js';
import { backHalfTranslations } from './viAgreementBackHalf.js';

// Native agreements are signed in English. This function only changes the reading view;
// it does not change the server snapshot, its digest, the PDF, or submitted values.
const translations = new Map([...frontHalfTranslations, ...backHalfTranslations]);
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function vietnameseDisplayDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value || '')) return null;
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return `${date.getUTCDate()} tháng ${date.getUTCMonth() + 1} năm ${date.getUTCFullYear()}`;
}

function vietnameseSignatureDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value || '')) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) return null;
    const pad = number => String(number).padStart(2, '0');
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} · ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

function translateText(text, stack) {
    // Only marked display dates are localized. Stored terms and exact signature
    // timestamps in datetime/title attributes remain unchanged.
    const displayDate = stack.at(-1)?.displayDate;
    if (displayDate && !stack.some(entry => entry.literalContent)) {
        return `${text.match(/^\s*/u)?.[0] || ''}${displayDate}${text.match(/\s*$/u)?.[0] || ''}`;
    }
    const key = text.trim();
    if (!stack.some(entry => entry.literalContent) && stack.at(-1)?.tag === 'strong'
        && stack.some(entry => entry.classes.includes('fb-signline'))
        && stack.some(entry => entry.classes.includes('fb-signature-card')) && key.endsWith(', trading as FastBoost')) {
        return text.replace(/, trading as FastBoost(?=\s*$)/u, ', kinh doanh dưới tên FastBoost');
    }
    if (stack.some(entry => entry.blocked)) return text;
    const translated = translations.get(key);
    if (!translated) return text;
    return `${text.match(/^\s*/u)?.[0] || ''}${translated}${text.match(/\s*$/u)?.[0] || ''}`;
}

function translateNodes(html) {
    const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+|</g) || [];
    const stack = [];
    let result = '';
    for (const token of tokens) {
        if (!token.startsWith('<')) {
            result += translateText(token, stack);
            continue;
        }
        result += token;
        const closing = /^<\/([A-Za-z][\w:-]*)/u.exec(token);
        if (closing) {
            const tag = closing[1].toLowerCase();
            const index = stack.findLastIndex(entry => entry.tag === tag);
            if (index !== -1) stack.length = index;
            continue;
        }
        const opening = /^<([A-Za-z][\w:-]*)\b/u.exec(token);
        if (!opening) continue;
        const tag = opening[1].toLowerCase();
        if (voidTags.has(tag) || /\/>$/u.test(token)) continue;
        const classes = /\bclass\s*=\s*["']([^"']*)["']/u.exec(token)?.[1]?.split(/\s+/u) || [];
        const literalContent = ['script', 'style', 'textarea', 'template'].includes(tag);
        const displayDate = tag === 'span' ? vietnameseDisplayDate(/\bdata-native-date\s*=\s*["']([^"']*)["']/u.exec(token)?.[1])
            : tag === 'time' ? vietnameseSignatureDate(/\bdata-native-date-time\s*=\s*["']([^"']*)["']/u.exec(token)?.[1]) : null;
        const blocked = literalContent
            || /\bdata-native-(?:field|value)(?:\s*=|\s|>)/u.test(token)
            || classes.includes('fb-template')
            || (tag === 'strong' && stack.some(entry => entry.classes.includes('fb-signline')));
        stack.push({ tag, classes, blocked, literalContent, displayDate });
    }
    return result;
}

export function translateAgreementHtml(html, language) {
    if (language !== 'vi' || !html) return html;
    let view = translateNodes(html);
    view = view.replace(/<html\b([^>]*)\blang="en"/iu, '<html$1lang="vi"');
    view = view.replace(/(<span data-native-field="ReferenceLanguage"><span data-native-value>)(English\s*\/\s*Vietnamese|English)(<\/span>)/gu,
        (_, before, value, after) => `${before}${value === 'English' ? 'Tiếng Anh' : 'Tiếng Anh/Tiếng Việt'}${after}`);
    view = view.replaceAll('aria-label="Agreement sections"', 'aria-label="Các mục của thỏa thuận"')
        .replaceAll('aria-label="Agreement sections on mobile"', 'aria-label="Các mục của thỏa thuận trên điện thoại"')
        .replaceAll('aria-label="Footer navigation"', 'aria-label="Điều hướng cuối trang"')
        .replaceAll('aria-label="Drawn signature"', 'aria-label="Chữ ký vẽ tay"')
        .replace(/aria-label="Link to ([^"]+)"/gu, (full, label) => {
            const destination = label === 'Schedule A — Commercial settings'
                ? 'Phụ lục A — Các điều khoản thương mại' : translations.get(label);
            return destination ? `aria-label="Liên kết đến ${destination}"` : full;
        });
    return view;
}

export { translations as agreementVietnameseTranslations };
