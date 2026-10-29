const { getVault } = require('./payoutInformationCrypto');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const eligible = user => user?.role === 'PROVIDER' || user?.hasBoosterAccess === true;
const fields = ['id', 'boosterId', 'createdAt', 'updatedAt', 'status', 'revision', 'submittedAt', 'reviewedAt', 'country', 'currency', 'accountLast4', 'correctionReason'];
const summary = value => Object.fromEntries(fields.map(key => [key, value[key] ?? null]));
const summarySelect = Object.fromEntries(fields.map(key => [key, true]));
const reasons = ['ACCOUNT_DETAILS', 'NAME_MISMATCH', 'OTHER'];
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function country(value) { if (!['US', 'VN'].includes(value)) fail(400, 'Choose United States or Vietnam.'); return value; }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) fail(400, 'Refresh the payout information and try again.'); return value; }
function abaRoutingNumber(value) {
    if (!/^\d{9}$/.test(value) || /^0+$/.test(value)) return false;
    const digits = [...value].map(Number);
    const prefix = Number(value.slice(0, 2));
    return ((prefix >= 0 && prefix <= 12) || (prefix >= 21 && prefix <= 32) || (prefix >= 61 && prefix <= 72) || prefix === 80)
        && (3 * (digits[0] + digits[3] + digits[6]) + 7 * (digits[1] + digits[4] + digits[7]) + digits[2] + digits[5] + digits[8]) % 10 === 0;
}
function validateDetails(value, requestedCountry) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['country', 'legalName', 'accountNumber', 'routingNumber', 'bankName', 'currency'].includes(key))) fail(400, 'Enter the requested bank details.');
    if (country(value.country) !== requestedCountry) fail(400, 'Use the bank country selected in this request.');
    const text = key => typeof value[key] === 'string' ? value[key].trim() : '';
    const legalName = text('legalName');
    const accountNumber = text('accountNumber');
    if (legalName.length < 2 || legalName.length > 100 || /[\u0000-\u001f\u007f]/.test(legalName)) fail(400, 'Enter the account holder’s full legal name.');
    if (!(value.country === 'US' ? /^\d{4,17}$/ : /^\d{4,30}$/).test(accountNumber)) fail(400, 'Enter a valid bank account number using digits only.');
    if (value.country === 'US') {
        const routingNumber = text('routingNumber');
        if (!abaRoutingNumber(routingNumber)) fail(400, 'Enter a valid 9-digit US routing number.');
        if (value.currency !== 'USD' || text('bankName')) fail(400, 'US bank deposits use USD and a routing number.');
        return { country: 'US', legalName, accountNumber, routingNumber, currency: 'USD' };
    }
    const bankName = text('bankName');
    if (bankName.length < 2 || bankName.length > 120 || /[\u0000-\u001f\u007f]/.test(bankName)) fail(400, 'Enter the Vietnamese bank name.');
    if (!['USD', 'VND'].includes(value.currency) || text('routingNumber')) fail(400, 'Choose USD or VND for the Vietnamese bank account.');
    return { country: 'VN', legalName, accountNumber, bankName, currency: value.currency };
}
function schemaMissing(error) {
    const cause = error?.meta?.driverAdapterError?.cause || error?.cause;
    return ['P2021', 'P2022'].includes(error?.code)
        || ['42P01', '42703'].includes(cause?.originalCode || cause?.code || error?.code);
}
function createPayoutInformationService(db, vault) {
    // Route registration must not eagerly load secrets or initialize AWS.
    vault ||= { configured: () => getVault().configured(),
        encrypt: (...args) => getVault().encrypt(...args), decrypt: (...args) => getVault().decrypt(...args) };
    async function guarded(work) {
        try { return await work(); }
        catch (error) {
            if (schemaMissing(error)) fail(503, 'Payout information needs a service update. Please try again later.');
            throw error;
        }
    }
    const transaction = work => guarded(() => db.$transaction(work, { timeout: 20000 }));
    async function actorFor(tx, actor, adminOnly = false) {
        const fresh = actor?.id && await tx.user.findUnique({ where: { id: actor.id },
            select: { id: true, username: true, role: true, hasBoosterAccess: true, isOwner: true, suspendedAt: true } });
        if (!fresh || fresh.suspendedAt) fail(403, 'Access unavailable.');
        if (adminOnly ? fresh.role !== 'ADMIN' : fresh.role !== 'ADMIN' && !eligible(fresh)) fail(403, adminOnly ? 'Admins only.' : 'Booster access is required.');
        return fresh;
    }
    async function authorized(tx, id, actor) {
        if (!uuid(id)) fail(404, 'Payout information not found.');
        const record = await tx.payoutInformation.findUnique({ where: { id } });
        if (!record || (record.boosterId !== actor.id && actor.role !== 'ADMIN')) fail(404, 'Payout information not found.');
        return record;
    }
    async function audit(tx, actor, action, record, before) {
        const booster = await tx.user.findUnique({ where: { id: record.boosterId }, select: { id: true, username: true } });
        const boosterName = typeof booster?.username === 'string' && booster.username.trim() || 'Booster';
        const state = value => value ? { status: value.status, revision: value.revision, country: value.country } : null;
        await tx.managementAuditLog.create({ data: { actorId: actor.id, actorName: actor.username || 'Account', actorRole: actor.role,
            actorIsOwner: Boolean(actor.isOwner), category: 'boosters', action, targetType: 'payoutInformation', targetId: record.id,
            targetLabel: `${boosterName} · Payout information`, before: state(before), after: state(record), outcome: 'SUCCEEDED', statusCode: 200, finishedAt: new Date() } });
    }
    async function notify(tx, record, userId, kind, title) {
        await tx.notification.upsert({ where: { id: `payout-${kind}-${record.id}-${record.revision}` }, update: {},
            create: { id: `payout-${kind}-${record.id}-${record.revision}`, userId, type: 'BOOSTER_PAYOUT_INFORMATION', title,
                message: 'Open your private payout information page.', data: { targetPath: `/provider/payout-information/${record.id}` } } });
    }
    function requireConfigured() { if (!vault.configured()) fail(503, 'Secure payout information is not configured yet.'); }
    async function matchingExisting(tx, id, boosterId, requestedCountry) {
        const sameId = await tx.payoutInformation.findUnique({ where: { id } });
        if (sameId && sameId.boosterId !== boosterId) fail(409, 'This request ID is already in use. Refresh before creating another request.');
        const existing = sameId || await tx.payoutInformation.findUnique({ where: { boosterId } });
        if (existing && existing.country !== requestedCountry) fail(409, 'This booster already has a payout request for another country. Open it to correct the country before submission.');
        return existing;
    }
    return {
        async readiness(actor) {
            return guarded(async () => {
                await actorFor(db, actor, true);
                if (!vault.configured()) return { ok: true, configured: false };
                try { await db.payoutInformation.findFirst({ select: { id: true } }); }
                catch (error) { if (schemaMissing(error)) return { ok: true, configured: false }; throw error; }
                return { ok: true, configured: true };
            });
        },
        async list(actor, scope) {
            return guarded(async () => {
                const fresh = await actorFor(db, actor);
                if (scope !== undefined && !['mine', 'all'].includes(scope)) fail(400, 'Choose a valid payout information view.');
                if (scope === 'all' && fresh.role !== 'ADMIN') fail(403, 'Admins only.');
                if (scope === 'mine' && !eligible(fresh)) fail(403, 'Booster access is required.');
                const records = await db.payoutInformation.findMany({ where: fresh.role === 'ADMIN' && scope !== 'mine' ? {} : { boosterId: fresh.id },
                    select: summarySelect, orderBy: { createdAt: 'desc' } });
                return { ok: true, requests: records.map(summary) };
            });
        },
        async request(actor, boosterId, body) {
            if (!uuid(body?.requestId)) fail(400, 'Refresh before requesting payout information.');
            const requestedCountry = country(body.country);
            const id = body.requestId.toLowerCase();
            try {
                return await transaction(async tx => {
                    const fresh = await actorFor(tx, actor, true);
                    requireConfigured();
                    const booster = await tx.user.findUnique({ where: { id: boosterId }, select: { id: true, role: true, hasBoosterAccess: true, suspendedAt: true } });
                    if (!booster || booster.suspendedAt || !eligible(booster)) fail(404, 'Active booster not found.');
                    const existing = await matchingExisting(tx, id, boosterId, requestedCountry);
                    if (existing) return { ok: true, id: existing.id };
                    const record = await tx.payoutInformation.create({ data: { id, boosterId, issuedById: fresh.id, country: requestedCountry } });
                    await audit(tx, fresh, 'payout.request', record);
                    await notify(tx, record, boosterId, 'request', 'Payout information requested');
                    return { ok: true, id: record.id };
                });
            } catch (error) {
                if (error?.code !== 'P2002') throw error;
                return guarded(async () => {
                    await actorFor(db, actor, true);
                    const existing = await matchingExisting(db, id, boosterId, requestedCountry);
                    if (!existing) throw error;
                    return { ok: true, id: existing.id };
                });
            }
        },
        async context(actor, id) {
            return guarded(async () => {
                const fresh = await actorFor(db, actor);
                const record = await authorized(db, id, fresh);
                const booster = await db.user.findUnique({ where: { id: record.boosterId }, select: { username: true, profile: { select: { displayName: true } } } });
                const own = fresh.id === record.boosterId;
                return { ok: true, request: summary(record), boosterName: booster?.profile?.displayName || booster?.username || 'Booster', own,
                    canSubmit: own && eligible(fresh), canReview: fresh.role === 'ADMIN' && !own && record.status === 'SUBMITTED',
                    canChangeCountry: fresh.role === 'ADMIN' && record.status === 'REQUESTED' };
            });
        },
        async details(actor, id) {
            return transaction(async tx => {
                const fresh = await actorFor(tx, actor);
                const record = await authorized(tx, id, fresh);
                if (!record.encryptedDetails) fail(409, 'Bank details have not been submitted yet.');
                const details = validateDetails(await vault.decrypt(record.encryptedDetails, record), record.country);
                await audit(tx, fresh, 'payout.reveal', record, record);
                return { ok: true, details, revision: record.revision };
            });
        },
        async changeCountry(actor, id, body) {
            const expectedRevision = revision(body?.revision);
            const requestedCountry = country(body.country);
            return transaction(async tx => {
                const fresh = await actorFor(tx, actor, true);
                const record = await authorized(tx, id, fresh);
                if (record.status !== 'REQUESTED') fail(409, 'The bank country cannot change after details have been submitted.');
                if (record.revision !== expectedRevision) fail(409, 'This request changed. Refresh before trying again.');
                if (record.country === requestedCountry) return { ok: true, request: summary(record) };
                const changed = await tx.payoutInformation.updateMany({ where: { id, revision: expectedRevision, status: 'REQUESTED' },
                    data: { country: requestedCountry, revision: { increment: 1 } } });
                if (!changed.count) fail(409, 'This request changed. Refresh before trying again.');
                const updated = await tx.payoutInformation.findUnique({ where: { id } });
                await audit(tx, fresh, 'payout.country', updated, record);
                return { ok: true, request: summary(updated) };
            });
        },
        async submit(actor, id, body) {
            const expectedRevision = revision(body?.revision);
            if (body?.confirmed !== true) fail(400, 'Confirm that these are your correct payout details.');
            return transaction(async tx => {
                const fresh = await actorFor(tx, actor);
                const record = await authorized(tx, id, fresh);
                if (record.boosterId !== fresh.id || !eligible(fresh)) fail(403, 'Only this booster can submit their bank details.');
                if (record.revision !== expectedRevision) fail(409, 'This request changed. Refresh before submitting again.');
                requireConfigured();
                const details = validateDetails(body.details, record.country);
                const nextRevision = expectedRevision + 1;
                const encryptedDetails = await vault.encrypt(details, { ...record, detailsRevision: nextRevision });
                const now = new Date();
                const changed = await tx.payoutInformation.updateMany({ where: { id, revision: expectedRevision }, data: {
                    revision: nextRevision, detailsRevision: nextRevision, encryptedDetails, country: details.country, currency: details.currency,
                    accountLast4: details.accountNumber.slice(-4), submittedAt: now, confirmedAt: now, status: 'SUBMITTED',
                    reviewedAt: null, reviewedById: null, correctionReason: null,
                } });
                if (!changed.count) fail(409, 'This request changed. Refresh before submitting again.');
                const updated = await tx.payoutInformation.findUnique({ where: { id } });
                await audit(tx, fresh, 'payout.submit', updated, record);
                const reviewers = await tx.user.findMany({ where: { role: 'ADMIN', suspendedAt: null, id: { not: record.boosterId } }, select: { id: true } });
                for (const reviewer of reviewers) await notify(tx, updated, reviewer.id, `submitted-${reviewer.id}`, 'Payout information ready for review');
                return { ok: true, request: summary(updated) };
            });
        },
        async review(actor, id, body) {
            const expectedRevision = revision(body?.revision);
            if (!['verify', 'return'].includes(body?.decision) || (body.decision === 'return' && !reasons.includes(body.reason))) fail(400, 'Choose a review decision and a correction reason if needed.');
            return transaction(async tx => {
                const fresh = await actorFor(tx, actor, true);
                const record = await authorized(tx, id, fresh);
                if (record.boosterId === fresh.id) fail(403, 'Another admin must review your bank details.');
                if (record.revision !== expectedRevision || record.status !== 'SUBMITTED') fail(409, 'This submission changed. Refresh and review it again.');
                const changed = await tx.payoutInformation.updateMany({ where: { id, revision: expectedRevision, status: 'SUBMITTED' }, data: {
                    revision: { increment: 1 }, status: body.decision === 'verify' ? 'VERIFIED' : 'CHANGES_REQUESTED',
                    reviewedById: fresh.id, reviewedAt: new Date(), correctionReason: body.decision === 'return' ? body.reason : null,
                } });
                if (!changed.count) fail(409, 'This submission changed. Refresh and review it again.');
                const updated = await tx.payoutInformation.findUnique({ where: { id } });
                await audit(tx, fresh, 'payout.review', updated, record);
                await notify(tx, updated, record.boosterId, 'review', body.decision === 'verify' ? 'Payout information reviewed' : 'Update your payout information');
                return { ok: true, request: summary(updated) };
            });
        },
    };
}
module.exports = { createPayoutInformationService, validateDetails, abaRoutingNumber, summary, schemaMissing };
