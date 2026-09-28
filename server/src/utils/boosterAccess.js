function canBoost(user) {
    return Boolean(user && !user.suspendedAt && (user.role === 'PROVIDER' || user.hasBoosterAccess === true));
}
const boosterWhere = { suspendedAt: null, OR: [{ role: 'PROVIDER' }, { hasBoosterAccess: true }] };
module.exports = { canBoost, boosterWhere };
