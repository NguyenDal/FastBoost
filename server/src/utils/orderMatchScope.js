const lolServices = new Set(['Rank Boost', 'Placement Boost', 'Win Boost', 'Pro Duo']);
const tftServices = new Set(['TFT Rank Boost', 'TFT Placement Boost', 'TFT Win Boost']);

function matchScope(order) {
    // TFT services currently sell standard ranked, not Double Up or Hyper Roll.
    // Older TFT orders inherited the LoL Solo/Duo / Flex form field; ignore it.
    if (tftServices.has(order.boostType)) return { game: 'TFT', queueId: 1100, label: 'Ranked TFT' };
    if (!lolServices.has(order.boostType)) return null;
    const queue = String(order.queueType || '').trim().toLowerCase();
    if (['solo/duo', 'ranked solo/duo'].includes(queue)) return { game: 'LOL', queueId: 420, label: 'Ranked Solo/Duo' };
    if (['flex', 'ranked flex'].includes(queue)) return { game: 'LOL', queueId: 440, label: 'Ranked Flex' };
    return null;
}
function matchesOrder(order, match) {
    const scope = matchScope(order);
    return Boolean(scope && match.game === scope.game && match.details?.queueId === scope.queueId);
}
function usesMatchHistory(order) {
    // Untouched active TFT orders can adopt history on their first successful import.
    // Existing count submissions and completed historical orders retain their workflow.
    return Boolean(order.matchHistoryEnabled || (tftServices.has(order.boostType) &&
        ['PENDING', 'IN_PROGRESS'].includes(order.status) && Array.isArray(order.contributions) && !order.contributions.length));
}
module.exports = { matchScope, matchesOrder, usesMatchHistory };
