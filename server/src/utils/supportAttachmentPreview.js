const path = require('node:path');
const { Worker } = require('node:worker_threads');

const imageTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const extensionOf = name => String(name || '').split('.').pop().toLowerCase();
const contentTypeOf = name => imageTypes[extensionOf(name)] || (extensionOf(name) === 'pdf' ? 'application/pdf' : 'application/octet-stream');
let activeConversions = 0;

async function extractDocxText(buffer) {
    if (activeConversions >= 2) throw Object.assign(new Error('Document previews are busy. Please try again shortly.'), { status: 429 });
    activeConversions++;
    let worker;
    let timer;
    try {
        return await new Promise((resolve, reject) => {
            const invalid = () => reject(Object.assign(new Error('This Word document could not be previewed.'), { status: 422 }));
            worker = new Worker(path.join(__dirname, 'docxPreviewWorker.js'), {
                workerData: buffer,
                resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
            });
            timer = setTimeout(invalid, 8000);
            worker.once('message', result => result.error ? invalid() : resolve(result));
            worker.once('error', invalid);
            worker.once('exit', invalid);
        });
    } finally {
        clearTimeout(timer);
        await worker?.terminate();
        activeConversions--;
    }
}

async function buildAttachmentPreview(message, { signUrl, readFile, extractWord = extractDocxText }) {
    const extension = extensionOf(message.attachmentName);
    if (extension === 'pdf') return { kind: 'pdf' };
    if (imageTypes[extension]) {
        const url = await signUrl({ key: message.attachmentKey, filename: message.attachmentName, contentType: contentTypeOf(message.attachmentName) });
        return { kind: 'image', url };
    }
    if (extension === 'txt' || extension === 'docx') {
        const buffer = await readFile(message.attachmentKey);
        if (buffer.length > 10 * 1024 * 1024) throw Object.assign(new Error('This file is too large to preview.'), { status: 413 });
        const result = extension === 'docx' ? await extractWord(buffer) : { text: buffer.toString('utf8').slice(0, 500000), truncated: buffer.toString('utf8').length > 500000 };
        return { kind: 'text', ...result, document: extension === 'docx' };
    }
    return { kind: 'unsupported' };
}

module.exports = { buildAttachmentPreview, contentTypeOf, extractDocxText };
