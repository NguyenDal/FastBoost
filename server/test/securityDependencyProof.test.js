// Bounded regression checks for the patched runtime transport/parser.
// No listener, network connection, application service or database is started.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Decoder } = require('socket.io-parser');
const { Polling } = require('../node_modules/engine.io/build/transports/polling');

test('engine.io rejects and closes an invalid binary polling response', t => {
    // GHSA-r635-g3xr-vw7x: default polling accepts Engine.IO protocol 4 before
    // the app's Socket.IO namespace JWT middleware executes. A malformed binary
    // POST emits an error without responding to that request. One mock request
    // demonstrates the missing response; this never exhausts real connections.
    const polling = new Polling({ _query: { EIO: '4' } });
    t.after(() => polling.removeAllListeners());
    const errors = [];
    polling.on('error', error => errors.push(error));
    const response = {
        headerWrites: 0, ended: false,
        writeHead() { this.headerWrites++; return this; },
        end() { this.ended = true; return this; },
    };

    polling.onDataRequest({ headers: { 'content-type': 'application/octet-stream' } }, response);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'invalid content');
    assert.equal(response.headerWrites, 1);
    assert.equal(response.ended, true, 'malformed request must be answered');
});

test('socket.io-parser releases zero-attachment state and rejects unsolicited binary data', t => {
    // GHSA-2m8v-j782-fhvr. Scope this app exposure to an authenticated namespace:
    // socket.io closes decoded events from clients without a joined namespace.
    // The isolated decoder below represents a connection already authorized.
    const decoder = new Decoder();
    t.after(() => { decoder.destroy(); decoder.off(); });
    let decoded = 0;
    decoder.on('decoded', () => decoded++);

    assert.throws(() => decoder.add('50-["synthetic-audit-event"]'), /attachments/i);
    const chunkSize = 1024;
    const chunkCount = 64;
    const maximumBytes = 64 * 1024;
    assert.equal(chunkCount * chunkSize, maximumBytes);
    for (let index = 0; index < chunkCount; index++) assert.throws(() => decoder.add(Buffer.alloc(chunkSize)));

    assert.equal(decoded, 0);
    assert.ok(!decoder.reconstructor, 'invalid zero-attachment packets must not allocate reconstruction state');

    decoder.destroy();
    assert.ok(!decoder.reconstructor, 'no reconstruction state is retained');
});
