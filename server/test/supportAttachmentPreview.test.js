const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildAttachmentPreview, extractDocxText } = require('../src/utils/supportAttachmentPreview');

test('image previews use inline URLs with safe types, not the uploaded MIME', async () => {
    for (const [name, kind, type] of [['proof.PNG', 'image', 'image/png'], ['photo.jpg', 'image', 'image/jpeg']]) {
        const result = await buildAttachmentPreview({ attachmentName: name, attachmentKey: 'private/key', attachmentMimeType: 'text/html' }, {
            readFile: async () => assert.fail('Native previews do not fetch files into the API'),
            signUrl: async args => { assert.equal(args.download, undefined); assert.equal(args.contentType, type); assert.equal(args.key, 'private/key'); return 'https://example.test/inline'; },
        });
        assert.deepEqual(result, { kind, url: 'https://example.test/inline' });
    }
    assert.deepEqual(await buildAttachmentPreview({ attachmentName: 'terms.pdf' }, {}), { kind: 'pdf' });
});

test('text previews return text, limit output and leave unsupported files unopened', async () => {
    const message = { attachmentName: 'notes.txt', attachmentKey: 'private/key' };
    const deps = { signUrl: async () => assert.fail('No URL needed'), readFile: async () => Buffer.from('<script>alert(1)</script>\nHello') };
    const result = await buildAttachmentPreview(message, deps);
    assert.equal(result.kind, 'text'); assert.equal(result.text, '<script>alert(1)</script>\nHello'); assert.equal(result.url, undefined);
    assert.equal((await buildAttachmentPreview(message, { ...deps, readFile: async () => Buffer.alloc(500001, 'a') })).truncated, true);
    await assert.rejects(buildAttachmentPreview(message, { ...deps, readFile: async () => Buffer.alloc(10 * 1024 * 1024 + 1) }), { status: 413 });
    assert.deepEqual(await buildAttachmentPreview({ ...message, attachmentName: 'archive.zip' }, { ...deps, readFile: async () => assert.fail('Do not open unsupported archives') }), { kind: 'unsupported' });
});

test('Word document text is extracted in an isolated worker and invalid files fail cleanly', async () => {
    // Use Mammoth's own ZIP dependency to construct a synthetic Office fixture.
    const JSZip = require(require.resolve('jszip', { paths: [path.dirname(require.resolve('mammoth'))] }));
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Readable Word document</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt; stays text</w:t></w:r></w:p></w:body></w:document>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await buildAttachmentPreview({ attachmentName: 'terms.docx', attachmentKey: 'private/key' }, { readFile: async () => buffer });
    assert.equal(result.kind, 'text'); assert.equal(result.document, true);
    assert.match(result.text, /Readable Word document\n\n<script> stays text/);
    assert.equal(result.truncated, false);
    await assert.rejects(extractDocxText(Buffer.from('Not a Word document')), { status: 422 });
});
