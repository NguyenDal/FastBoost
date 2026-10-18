const net = require('node:net');

// Require explicit addresses/subnets instead of trusting client-supplied XFF or
// guessing how many proxies exist. Leave unset for direct/local connections.
function configureTrustedProxy(app, value = process.env.TRUSTED_PROXY_CIDRS) {
    if (!value?.trim()) return;
    const subnets = value.split(',').map(item => item.trim());
    for (const subnet of subnets) {
        const [address, prefix, extra] = subnet.split('/');
        const family = net.isIP(address);
        if (!family || extra !== undefined || (prefix !== undefined &&
            (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))) {
            throw new Error('TRUSTED_PROXY_CIDRS must contain explicit proxy IP addresses or non-global CIDR ranges.');
        }
    }
    app.set('trust proxy', subnets);
}

module.exports = { configureTrustedProxy };
