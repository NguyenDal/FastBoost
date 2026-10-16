const express = require('express');
const db = require('../prisma');
const { protect } = require('../middleware/authMiddleware');
const { ratingSelect, orderSelect, ratingRecipientIds, missingRatingTable } = require('../utils/orderRatings');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const completed = order => order.status === 'COMPLETED' && order.paymentStatus === 'PAID';

async function customer(client, userId) {
    if (!userId) fail(401, 'Sign in to review your order.');
    const actor = await client.user.findUnique({ where: { id: userId }, select: { id: true, suspendedAt: true } });
    if (!actor || actor.suspendedAt) fail(403, 'Only active customers can review their orders.');
    return actor;
}

async function ownedOrder(client, id, customerId) {
    const order = await client.order.findUnique({ where: { id }, select: orderSelect });
    if (!order || order.customerId !== customerId) fail(404, 'Order not found.');
    return order;
}

function createOrderRatingRouter(client = db) {
    const router = express.Router();
    router.get('/:id/rating', protect, handle(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const actor = await customer(client, req.user.id || req.user.userId);
        const order = await ownedOrder(client, req.params.id, actor.id);
        const eligible = !order.rating && completed(order) && (await ratingRecipientIds(client, order)).length > 0;
        res.json({ ok: true, rating: order.rating, eligible });
    }));
    router.post('/:id/rating', protect, handle(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const stars = req.body?.stars;
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail(400, 'Choose a whole-star rating from 1 to 5.');
        const userId = req.user.id || req.user.userId;
        if (!userId) fail(401, 'Sign in to review your order.');
        const rating = await client.$transaction(async tx => {
            // Refresh authorization under row locks; stale JWT roles cannot
            // authorize a review and concurrent submissions cannot duplicate it.
            await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
            const actor = await customer(tx, userId);
            await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${req.params.id} FOR UPDATE`;
            const order = await ownedOrder(tx, req.params.id, actor.id);
            if (order.rating) fail(409, 'You have already reviewed this order.');
            if (!completed(order)) fail(409, 'You can review an order after it is paid and completed.');
            const recipients = await ratingRecipientIds(tx, order);
            if (!recipients.length) fail(409, 'No booster is available to review for this order.');
            return tx.orderRating.create({
                data: { orderId: order.id, customerId: actor.id, stars,
                    recipients: { create: recipients.map(boosterId => ({ boosterId })) } },
                select: ratingSelect,
            });
        });
        res.status(201).json({ ok: true, rating });
    }));
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (missingRatingTable(error)) return res.status(503).json({ ok: false, message: 'Order reviews are not available yet. Please try again later.' });
        if (error.code === 'P2002') return res.status(409).json({ ok: false, message: 'You have already reviewed this order.' });
        res.status(error.status || 500).json({ ok: false,
            message: error.status ? error.message : 'Could not load or save the order review. Please try again.' });
    });
    return router;
}

module.exports = { createOrderRatingRouter };
