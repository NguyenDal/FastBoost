import { frontHalfTranslations } from './viAgreementFrontHalf.js';
import { backHalfTranslations } from './viAgreementBackHalf.js';

// FB-BSA-2.1/2.2 are signed in English. This function only changes the reading view;
// it does not change the server snapshot, its digest, the PDF, or submitted values.
const translations = new Map([...frontHalfTranslations, ...backHalfTranslations]);
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function translateText(text, stack) {
    if (stack.some(entry => entry.blocked)) return text;
    const key = text.trim();
    if (stack.some(entry => entry.classes.includes('fb-signature-card')) && key.endsWith(', trading as FastBoost')) {
        return text.replace(/, trading as FastBoost(?=\s*$)/u, ', kinh doanh dưới tên FastBoost');
    }
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
        const blocked = ['script', 'style', 'textarea', 'template'].includes(tag)
            || /\bdata-native-(?:field|value)\s*=/u.test(token)
            || classes.includes('fb-template')
            || (tag === 'strong' && stack.some(entry => entry.classes.includes('fb-signline')));
        stack.push({ tag, classes, blocked });
    }
    return result;
}

export function translateAgreementHtml(html, language) {
    if (language !== 'vi' || !html) return html;
    const version = /FB-BSA-2\.\d+/u.exec(html)?.[0] || 'FB-BSA-2.2';
    const notice = `Bản tiếng Việt này giúp bạn đọc và hiểu thỏa thuận. Các điều khoản được ký vẫn là bản tiếng Anh ${version}; đổi ngôn ngữ hiển thị không thay đổi tài liệu ký hoặc PDF. Nếu bạn cần bản dịch được hai bên chấp thuận, hãy liên hệ FastBoost trước khi ký.`;
    let view = translateNodes(html);
    view = view.replace(/<html\b([^>]*)\blang="en"/iu, '<html$1lang="vi"');
    view = view.replace(/(<span data-native-field="ReferenceLanguage"><span data-native-value>)(English\s*\/\s*Vietnamese|English)(<\/span>)/gu,
        (_, before, value, after) => `${before}${value === 'English' ? 'Tiếng Anh' : 'Tiếng Anh/Tiếng Việt'}${after}`);
    view = view.replace('<div class="fb-hero"><div class="fb-container">',
        `<div class="fb-hero"><div class="fb-container"><div class="fb-translation-notice" role="note">${notice}</div>`);
    view = view.replace('</head>', '<style>.fb-translation-notice{margin:0 0 18px;padding:12px 16px;border:1px solid #a989df88;border-left:3px solid #ae80f3;border-radius:8px;background:#a989df1a;color:#eadfff;font-size:13px;line-height:1.6}</style></head>');
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
