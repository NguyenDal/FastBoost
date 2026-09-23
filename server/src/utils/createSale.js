async function createSale(db, data, now = new Date()) {
    if (!data.couponCode) return db.serviceSale.create({ data });
    return db.$transaction(async tx => {
        // Release an expired reservation atomically with replacement creation.
        // The partial unique index also protects concurrent creates and scheduled codes.
        await tx.serviceSale.updateMany({
            where: { couponCode: data.couponCode, active: true, endsAt: { lte: now } },
            data: { active: false },
        });
        return tx.serviceSale.create({ data });
    });
}
module.exports = { createSale };
