const PRODUCT_PATHS = Object.freeze({
  'Rank Boost': '/order/league-of-legends/rank-boost',
  'Placement Boost': '/order/league-of-legends/placement-boost',
  'Win Boost': '/order/league-of-legends/win-boost',
  'Pro Duo': '/order/league-of-legends/pro-duo',
  'TFT Rank Boost': '/order/teamfight-tactics/rank-boost',
  'TFT Win Boost': '/order/teamfight-tactics/win-boost',
  'TFT Placement Boost': '/order/teamfight-tactics/placement-boost',
});

const TITLES_BY_PATH = new Map(Object.entries(PRODUCT_PATHS).map(([title, path]) => [path, title]));

const GAME_QUERY_VALUES = Object.freeze({
  lol: 'league-of-legends',
  tft: 'teamfight-tactics',
});

export function selectedGameFromSearch(search) {
  const value = new URLSearchParams(search).get('game');
  return Object.keys(GAME_QUERY_VALUES).find(game => GAME_QUERY_VALUES[game] === value) || '';
}

export function searchWithSelectedGame(search, game) {
  const params = new URLSearchParams(search);
  if (Object.hasOwn(GAME_QUERY_VALUES, game)) params.set('game', GAME_QUERY_VALUES[game]);
  else params.delete('game');
  return params.toString();
}

export function serviceTitleFromOrderRoute(game, product) {
  return TITLES_BY_PATH.get(`/order/${game}/${product}`) || null;
}

export function uniqueServiceForTitle(services, title) {
  if (!Array.isArray(services) || !title) return null;
  const matches = services.filter(service => service?.title === title);
  return matches.length === 1 ? matches[0] : null;
}

export function orderPathForService(service, catalog) {
  if (!service?.id) return '/';
  const fallback = `/order/${encodeURIComponent(String(service.id))}`;
  const path = Object.hasOwn(PRODUCT_PATHS, service.title) ? PRODUCT_PATHS[service.title] : null;
  if (!path || !Array.isArray(catalog)) return fallback;
  const unique = uniqueServiceForTitle(catalog, service.title);
  return unique && String(unique.id) === String(service.id) ? path : fallback;
}
