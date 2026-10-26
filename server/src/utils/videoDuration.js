const { open, stat } = require('node:fs/promises');

// The upload limit is 100 MB. Reading only container headers keeps probing a
// newly uploaded video cheap, even when MP4 metadata follows the media data.
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MAX_PROBE_READS = 1024;
const MAX_PROBE_BYTES = 256 * 1024;
const MAX_PROBE_MS = 1000;
const probeBudgets = new WeakMap();

async function readAt(file, offset, length, fileSize) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > fileSize) return null;
    const budget = probeBudgets.get(file);
    if (!budget || ++budget.reads > MAX_PROBE_READS ||
        (budget.bytes += length) > MAX_PROBE_BYTES || Date.now() > budget.deadline) return null;
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await file.read(bytes, 0, length, offset);
    return bytesRead === length ? bytes : null;
}

function validDuration(value) {
    return Number.isFinite(value) && value > 0 && value <= MAX_DURATION_SECONDS ? value : null;
}

async function mp4Box(file, offset, end, fileSize) {
    const header = await readAt(file, offset, 8, fileSize);
    if (!header) return null;
    let size = header.readUInt32BE(0);
    let headerSize = 8;
    if (size === 1) {
        const extended = await readAt(file, offset + 8, 8, fileSize);
        if (!extended) return null;
        size = Number(extended.readBigUInt64BE());
        headerSize = 16;
    } else if (size === 0) size = end - offset;
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) return null;
    return { type: header.toString('ascii', 4, 8), content: offset + headerSize, end: offset + size };
}

async function mp4Duration(file, fileSize) {
    let position = 0;
    while (position + 8 <= fileSize) {
        const box = await mp4Box(file, position, fileSize, fileSize);
        if (!box) return null;
        if (box.type === 'moov') {
            let childPosition = box.content;
            while (childPosition + 8 <= box.end) {
                const child = await mp4Box(file, childPosition, box.end, fileSize);
                if (!child) return null;
                if (child.type === 'mvhd') {
                    const version = await readAt(file, child.content, 1, fileSize);
                    if (!version) return null;
                    const one = version[0] === 1;
                    if (!one && version[0] !== 0) return null;
                    const fields = await readAt(file, child.content + (one ? 20 : 12), one ? 12 : 8, fileSize);
                    if (!fields || child.content + (one ? 32 : 20) > child.end) return null;
                    const scale = fields.readUInt32BE(0);
                    const ticks = one ? Number(fields.readBigUInt64BE(4)) : fields.readUInt32BE(4);
                    return scale ? validDuration(ticks / scale) : null;
                }
                childPosition = child.end;
            }
            return null;
        }
        position = box.end;
    }
    return null;
}

function ebmlVint(bytes, offset, preserveMarker) {
    const first = bytes[offset];
    if (!first) return null;
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 8 || offset + length > bytes.length) return null;
    let value = BigInt(preserveMarker ? first : first & ((1 << (8 - length)) - 1));
    for (let index = 1; index < length; index++) value = (value << 8n) | BigInt(bytes[offset + index]);
    const unknown = !preserveMarker && value === (1n << BigInt(7 * length)) - 1n;
    return { length, value, unknown };
}

async function ebmlElement(file, offset, end, fileSize) {
    const header = await readAt(file, offset, Math.min(12, end - offset), fileSize);
    if (!header) return null;
    const id = ebmlVint(header, 0, true);
    if (!id || id.length > 4) return null;
    const size = ebmlVint(header, id.length, false);
    if (!size) return null;
    const content = offset + id.length + size.length;
    const contentEnd = size.unknown ? end : content + Number(size.value);
    if (!Number.isSafeInteger(contentEnd) || contentEnd > end || contentEnd < content) return null;
    return { id: Number(id.value), content, end: contentEnd, unknown: size.unknown };
}

async function webmInfoDuration(file, start, end, fileSize) {
    let position = start;
    let scale = 1000000;
    let ticks = null;
    while (position + 2 <= end) {
        const element = await ebmlElement(file, position, end, fileSize);
        if (!element || element.unknown) return null;
        const size = element.end - element.content;
        if (element.id === 0x2ad7b1 && size > 0 && size <= 8) {
            const bytes = await readAt(file, element.content, size, fileSize);
            if (!bytes) return null;
            scale = Number(bytes.readUIntBE(0, Math.min(size, 6)));
            if (size > 6) {
                scale = 0;
                for (const byte of bytes) scale = scale * 256 + byte;
            }
        } else if (element.id === 0x4489 && (size === 4 || size === 8)) {
            const bytes = await readAt(file, element.content, size, fileSize);
            if (!bytes) return null;
            ticks = size === 4 ? bytes.readFloatBE(0) : bytes.readDoubleBE(0);
        }
        position = element.end;
    }
    return ticks === null ? null : validDuration(ticks * scale / 1000000000);
}

async function webmDuration(file, fileSize) {
    let position = 0;
    while (position + 2 <= fileSize) {
        const element = await ebmlElement(file, position, fileSize, fileSize);
        if (!element) return null;
        if (element.id === 0x18538067) {
            let childPosition = element.content;
            while (childPosition + 2 <= element.end) {
                const child = await ebmlElement(file, childPosition, element.end, fileSize);
                if (!child || child.unknown) return null;
                if (child.id === 0x1549a966) return webmInfoDuration(file, child.content, child.end, fileSize);
                childPosition = child.end;
            }
            return null;
        }
        if (element.unknown) return null;
        position = element.end;
    }
    return null;
}

async function readVideoDurationSeconds(path, mimeType) {
    const fileSize = (await stat(path)).size;
    if (!Number.isSafeInteger(fileSize) || fileSize < 12 || fileSize > MAX_VIDEO_BYTES) return null;
    const file = await open(path, 'r');
    probeBudgets.set(file, { reads: 0, bytes: 0, deadline: Date.now() + MAX_PROBE_MS });
    try {
        const duration = mimeType === 'video/mp4' ? await mp4Duration(file, fileSize)
            : mimeType === 'video/webm' ? await webmDuration(file, fileSize) : null;
        return duration === null ? null : Math.round(duration * 1000) / 1000;
    } finally { probeBudgets.delete(file); await file.close(); }
}

module.exports = { readVideoDurationSeconds, MAX_VIDEO_BYTES };
