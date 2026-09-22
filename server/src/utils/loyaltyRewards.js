// Both sources arrive newest first. Merge only as far as the requested page,
// keeping completed-order rewards first when timestamps match.
function mergeRewardPage(orders, bonuses, offset, limit) {
    const page = [];
    let orderIndex = 0;
    let bonusIndex = 0;
    let position = 0;

    while (position < offset + limit && (orderIndex < orders.length || bonusIndex < bonuses.length)) {
        const takeOrder = bonusIndex >= bonuses.length || (
            orderIndex < orders.length &&
            new Date(orders[orderIndex].createdAt) >= new Date(bonuses[bonusIndex].createdAt)
        );
        const reward = takeOrder ? orders[orderIndex++] : bonuses[bonusIndex++];
        if (position >= offset) page.push(reward);
        position += 1;
    }

    return page;
}

module.exports = { mergeRewardPage };
