const { clientOrigin } = require('../utils/clientOrigin');

const browserCorsOptions = { origin(origin, callback) {
    if (!origin) return callback(null, false);
    let allowed = false;
    try { allowed = origin === clientOrigin({ get: name => name === 'origin' ? origin : undefined }); }
    catch { /* Invalid or missing site configuration fails closed for browsers. */ }
    return callback(null, allowed ? origin : false);
} };

module.exports = { browserCorsOptions };
