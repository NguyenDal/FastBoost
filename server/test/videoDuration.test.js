const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readVideoDurationSeconds } = require('../src/utils/videoDuration');

const mp4Box = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length + 8);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, data]);
};

const ebmlElement = (id, data) => {
    assert.ok(data.length < 127);
    return Buffer.concat([Buffer.from(id), Buffer.from([0x80 | data.length]), data]);
};

test('MP4 movie header after media data yields duration without scanning the media', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'fastboost-video-duration-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'clip.mp4');
    const movieHeader = Buffer.alloc(20);
    movieHeader.writeUInt32BE(1000, 12);
    movieHeader.writeUInt32BE(4500, 16);
    await writeFile(path, Buffer.concat([
        mp4Box('ftyp', Buffer.from('isom0000')),
        mp4Box('mdat', Buffer.alloc(32 * 1024)),
        mp4Box('moov', mp4Box('mvhd', movieHeader)),
    ]));
    assert.equal(await readVideoDurationSeconds(path, 'video/mp4'), 4.5);
});

test('WebM segment Info timecode scale and duration yield seconds', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'fastboost-video-duration-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'clip.webm');
    const duration = Buffer.alloc(8);
    duration.writeDoubleBE(6250);
    const info = ebmlElement([0x15, 0x49, 0xa9, 0x66], Buffer.concat([
        ebmlElement([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])),
        ebmlElement([0x44, 0x89], duration),
    ]));
    const ebml = ebmlElement([0x1a, 0x45, 0xdf, 0xa3], ebmlElement([0x42, 0x82], Buffer.from('webm')));
    await writeFile(path, Buffer.concat([ebml, ebmlElement([0x18, 0x53, 0x80, 0x67], info)]));
    assert.equal(await readVideoDurationSeconds(path, 'video/webm'), 6.25);
});

test('truncated and unsupported video metadata never invents a duration', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'fastboost-video-duration-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'broken.mp4');
    await writeFile(path, Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
    assert.equal(await readVideoDurationSeconds(path, 'video/mp4'), null);
    assert.equal(await readVideoDurationSeconds(path, 'video/other'), null);
});

test('metadata probe stops before scanning thousands of tiny MP4 boxes', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'fastboost-video-duration-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'many-boxes.mp4');
    const movieHeader = Buffer.alloc(20);
    movieHeader.writeUInt32BE(1000, 12);
    movieHeader.writeUInt32BE(4500, 16);
    await writeFile(path, Buffer.concat([
        mp4Box('ftyp', Buffer.from('isom0000')),
        ...Array.from({ length: 1500 }, () => mp4Box('free', Buffer.alloc(0))),
        mp4Box('moov', mp4Box('mvhd', movieHeader)),
    ]));
    assert.equal(await readVideoDurationSeconds(path, 'video/mp4'), null);
});

test('metadata probe stops before scanning thousands of tiny WebM elements', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'fastboost-video-duration-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'many-elements.webm');
    const ebml = ebmlElement([0x1a, 0x45, 0xdf, 0xa3], ebmlElement([0x42, 0x82], Buffer.from('webm')));
    const duration = Buffer.alloc(8);
    duration.writeDoubleBE(4500);
    const info = ebmlElement([0x15, 0x49, 0xa9, 0x66], ebmlElement([0x44, 0x89], duration));
    await writeFile(path, Buffer.concat([
        ebml,
        Buffer.from([0x18, 0x53, 0x80, 0x67, 0xff]), // Segment with unknown size
        ...Array.from({ length: 1500 }, () => Buffer.from([0xec, 0x80])), // empty Void elements
        info,
    ]));
    assert.equal(await readVideoDurationSeconds(path, 'video/webm'), null);
});
