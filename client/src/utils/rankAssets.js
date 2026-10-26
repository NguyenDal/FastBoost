const rankAssetPaths = Object.freeze({
  unranked: '/assets/services/ranks/unranked.webp',
  iron: '/assets/services/ranks/iron.png',
  bronze: '/assets/services/ranks/bronze.png',
  silver: '/assets/services/ranks/silver.png',
  gold: '/assets/services/ranks/gold.png',
  platinum: '/assets/services/ranks/platinum.png',
  emerald: '/assets/services/ranks/emerald.png',
  diamond: '/assets/services/ranks/diamond.png',
  master: '/assets/services/ranks/master.png',
  grandmaster: '/assets/services/ranks/grandmaster.png',
  challenger: '/assets/services/ranks/challenger.png',
});

export function getRankAssetPath(rank) {
  const tier = String(rank || '').trim().split(/\s+/)[0].toLowerCase();
  return Object.hasOwn(rankAssetPaths, tier) ? rankAssetPaths[tier] : null;
}
