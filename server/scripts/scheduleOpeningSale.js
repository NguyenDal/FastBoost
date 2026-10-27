// Dry run by default. Use --apply only after reviewing the plan against the
// development database. This script must never be pointed at production.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const OPENING_SALE = Object.freeze({
    title: 'Opening month',
    discountPercent: 15,
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
    scope: 'GLOBAL',
    appliesTo: 'BASE_PRICE',
    footerDecoration: false,
    footerTimer: false,
});

function assertDevelopmentDatabase(databaseUrl, nodeEnv) {
    let url;
    try { url = new URL(databaseUrl); }
    catch { throw new Error('A valid development DATABASE_URL is required.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.hostname !== 'db.prisma.io' || nodeEnv === 'production') {
        throw new Error('Refusing to access a database outside the db.prisma.io development environment.');
    }
}

function toMillis(value) {
    return value == null ? null : new Date(value).getTime();
}

function overlapsWindow(sale) {
    const start = toMillis(sale.startsAt);
    const end = toMillis(sale.endsAt);
    return (start == null || start < Date.parse(OPENING_SALE.endsAt)) &&
        (end == null || end > Date.parse(OPENING_SALE.startsAt));
}

function matchesOpeningSale(sale) {
    return sale.scope === 'GLOBAL' && sale.serviceId == null && sale.couponCode == null &&
        sale.title === OPENING_SALE.title &&
        Number(sale.discountPercent) === OPENING_SALE.discountPercent &&
        sale.appliesTo === OPENING_SALE.appliesTo &&
        toMillis(sale.startsAt) === Date.parse(OPENING_SALE.startsAt) &&
        toMillis(sale.endsAt) === Date.parse(OPENING_SALE.endsAt) &&
        sale.footerDecoration === OPENING_SALE.footerDecoration &&
        sale.footerTimer === OPENING_SALE.footerTimer;
}

function summary(sale) {
    return {
        id: sale.id,
        scope: sale.scope,
        serviceId: sale.serviceId,
        title: sale.title,
        discountPercent: Number(sale.discountPercent),
        startsAt: sale.startsAt ? new Date(sale.startsAt).toISOString() : null,
        endsAt: sale.endsAt ? new Date(sale.endsAt).toISOString() : null,
    };
}

function planOpeningSale(sales, now = new Date()) {
    const current = now.getTime();
    if (current >= Date.parse(OPENING_SALE.endsAt)) {
        throw new Error('The opening sale window has already ended.');
    }

    const automatic = sales.filter(sale => sale.active && sale.couponCode == null &&
        (sale.endsAt == null || toMillis(sale.endsAt) > current));
    // The admin API rejects any still-current or scheduled global automatic
    // sale, even if its window does not intersect the opening event.
    const globalSales = automatic.filter(sale => sale.scope === 'GLOBAL');
    // A service sale takes precedence over a global sale in quotes. Refuse an
    // overlap so the advertised offer is actually available on every service.
    const serviceConflicts = automatic.filter(sale => sale.scope === 'SERVICE' && overlapsWindow(sale));
    const exact = globalSales.filter(matchesOpeningSale);
    const conflicts = [...globalSales.filter(sale => !matchesOpeningSale(sale)), ...serviceConflicts];

    if (exact.length > 1 || conflicts.length) {
        return { status: 'CONFLICT', existingId: null,
            conflicts: [...(exact.length > 1 ? exact : []), ...conflicts].map(summary) };
    }
    if (exact.length === 1) {
        return { status: 'EXISTS', existingId: exact[0].id, conflicts: [] };
    }
    return { status: 'READY', existingId: null, conflicts: [] };
}

function saleData() {
    return {
        title: OPENING_SALE.title,
        discountPercent: OPENING_SALE.discountPercent,
        startsAt: new Date(OPENING_SALE.startsAt),
        endsAt: new Date(OPENING_SALE.endsAt),
        scope: OPENING_SALE.scope,
        serviceId: null,
        appliesTo: OPENING_SALE.appliesTo,
        couponCode: null,
        active: true,
        footerDecoration: OPENING_SALE.footerDecoration,
        footerTimer: OPENING_SALE.footerTimer,
    };
}

async function assertFrontendCampaignMatches() {
    const file = pathToFileURL(path.join(__dirname, '../../client/src/data/openingCampaign.js')).href;
    const { OPENING_CAMPAIGN } = await import(file);
    for (const key of ['title', 'discountPercent', 'startsAt', 'endsAt']) {
        if (OPENING_CAMPAIGN[key] !== OPENING_SALE[key]) {
            throw new Error(`Opening campaign ${key} differs between client and sale script.`);
        }
    }
}

async function main(args = process.argv.slice(2)) {
    if (args.some(arg => arg !== '--apply') || args.length > 1) {
        throw new Error('Usage: node scripts/scheduleOpeningSale.js [--apply]');
    }
    require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
    assertDevelopmentDatabase(process.env.DATABASE_URL, process.env.NODE_ENV);
    await assertFrontendCampaignMatches();

    const prisma = require('../src/prisma');
    const query = {
        where: { active: true, couponCode: null,
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        select: { id: true, scope: true, serviceId: true, title: true,
            discountPercent: true, appliesTo: true, startsAt: true, endsAt: true,
            active: true, couponCode: true, footerDecoration: true, footerTimer: true },
    };

    try {
        if (!args.includes('--apply')) {
            const plan = planOpeningSale(await prisma.serviceSale.findMany(query));
            console.log(JSON.stringify({ mode: 'DRY_RUN', target: OPENING_SALE, ...plan }, null, 2));
            return;
        }

        // Serializable recheck closes the gap between dry run and write.
        const result = await prisma.$transaction(async tx => {
            const plan = planOpeningSale(await tx.serviceSale.findMany(query));
            if (plan.status !== 'READY') return plan;
            const sale = await tx.serviceSale.create({ data: saleData(), select: { id: true } });
            return { status: 'CREATED', existingId: sale.id, conflicts: [] };
        }, { isolationLevel: 'Serializable' });

        console.log(JSON.stringify({ mode: 'APPLY', target: OPENING_SALE, ...result }, null, 2));
        if (result.status === 'CONFLICT') process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch(error => {
        // Prisma connection errors may embed URLs. Never print them or secrets.
        const safe = error.message.startsWith('Opening campaign ') ||
            error.message.startsWith('Refusing to access ') ||
            error.message.startsWith('A valid development ') ||
            error.message.startsWith('The opening sale ') ||
            error.message.startsWith('Usage:');
        console.error(safe ? error.message : 'Could not inspect or update the development sale schedule.');
        process.exitCode = 1;
    });
}

module.exports = { OPENING_SALE, assertDevelopmentDatabase, matchesOpeningSale,
    planOpeningSale, saleData, assertFrontendCampaignMatches, main };
