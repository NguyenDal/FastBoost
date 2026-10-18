const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { configureTrustedProxy } = require('../src/config/trustedProxy');

test('proxy trust defaults closed and accepts only explicit address/range policies', () => {
    const app = express();
    configureTrustedProxy(app, '');
    assert.equal(app.get('trust proxy'), false);
    for (const value of ['true', '*', '1', '0.0.0.0/0', '::/0', '10.0.0.1/999', 'invalid']) {
        assert.throws(() => configureTrustedProxy(app, value), /TRUSTED_PROXY_CIDRS/);
    }
    configureTrustedProxy(app, '127.0.0.1, 10.2.0.0/16, ::1');
    const trust = app.get('trust proxy fn');
    assert.equal(trust('127.0.0.1'), true);
    assert.equal(trust('10.2.4.5'), true);
    assert.equal(trust('203.0.113.20'), false);
});
