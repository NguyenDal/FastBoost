const test = require('node:test');
const assert = require('node:assert/strict');
const { browserCorsOptions } = require('../src/config/browserCors');

test('API CORS permits only the configured site and keeps direct requests available', t => {
    const originalUrl = process.env.CLIENT_URL;
    const originalEnv = process.env.NODE_ENV;
    process.env.CLIENT_URL = 'https://www.fastboost.gg/';
    process.env.NODE_ENV = 'production';
    t.after(() => {
        if (originalUrl === undefined) delete process.env.CLIENT_URL;
        else process.env.CLIENT_URL = originalUrl;
        if (originalEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalEnv;
    });
    const allowed = [];
    browserCorsOptions.origin('https://www.fastboost.gg', (...args) => allowed.push(args));
    assert.deepEqual(allowed, [[null, 'https://www.fastboost.gg']]);

    const foreign = [];
    browserCorsOptions.origin('https://security-check.invalid', (...args) => foreign.push(args));
    assert.deepEqual(foreign, [[null, false]]);

    const direct = [];
    browserCorsOptions.origin(undefined, (...args) => direct.push(args));
    assert.deepEqual(direct, [[null, false]]);

    delete process.env.CLIENT_URL;
    const unconfigured = [];
    browserCorsOptions.origin('https://www.fastboost.gg', (...args) => unconfigured.push(args));
    assert.deepEqual(unconfigured, [[null, false]]);

    process.env.NODE_ENV = 'development';
    const local = [];
    browserCorsOptions.origin('http://localhost:5173', (...args) => local.push(args));
    assert.deepEqual(local, [[null, 'http://localhost:5173']]);
});
