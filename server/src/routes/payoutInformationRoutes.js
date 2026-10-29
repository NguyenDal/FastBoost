// Mount behind operationsRoutes' JWT, fresh account check and no-store policy.
const router = require('express').Router();
const db = require('../prisma');
const { createPayoutInformationService } = require('../utils/payoutInformation');
const service = createPayoutInformationService(db);
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.get('/payout-information/configuration', handle(async (req, res) => res.json(await service.readiness(req.actor))));
router.get('/payout-information', handle(async (req, res) => res.json(await service.list(req.actor, req.query.scope))));
router.post('/boosters/:boosterId/payout-information', handle(async (req, res) => res.status(201).json(await service.request(req.actor, req.params.boosterId, req.body))));
router.get('/payout-information/:id', handle(async (req, res) => res.json(await service.context(req.actor, req.params.id))));
router.post('/payout-information/:id/details', handle(async (req, res) => res.json(await service.details(req.actor, req.params.id))));
router.post('/payout-information/:id/country', handle(async (req, res) => res.json(await service.changeCountry(req.actor, req.params.id, req.body))));
router.post('/payout-information/:id/submit', handle(async (req, res) => res.json(await service.submit(req.actor, req.params.id, req.body))));
router.post('/payout-information/:id/review', handle(async (req, res) => res.json(await service.review(req.actor, req.params.id, req.body))));
module.exports = router;
