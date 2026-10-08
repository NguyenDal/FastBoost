const { matchScope, matchesOrder } = require('./orderMatchScope');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const regions = {
    'North America': 'americas', NA: 'americas', NA1: 'americas',
    Brazil: 'americas', BR1: 'americas', LAN: 'americas', LAS: 'americas',
    'Latin America North': 'americas', 'Latin America South': 'americas', LA1: 'americas', LA2: 'americas',
    'Europe West': 'europe', EUW: 'europe', EUW1: 'europe',
    'Europe Nordic & East': 'europe', EUNE: 'europe', EUN1: 'europe', TR1: 'europe', RU: 'europe',
    Korea: 'asia', KR: 'asia', Japan: 'asia', JP1: 'asia',
    Oceania: 'sea', OCE: 'sea', OC1: 'sea', SG2: 'sea', TW2: 'sea', VN2: 'sea',
};
const buckets = new Map();
const platforms = { na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
    euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', kr: 'asia', jp1: 'asia',
    oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea' };
const apiKey = game => (game === 'TFT' ? process.env.RIOT_TFT_API_KEY?.trim() || process.env.RIOT_API_KEY?.trim() : process.env.RIOT_API_KEY?.trim());
const configured = (game = 'LOL') => Boolean(apiKey(game));
const number = n => Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
const text = value => String(value || '').slice(0, 120);

function importSettings(order) {
    const region = regions[order.region];
    if (!region) fail(400, 'Choose a supported Riot region on this order.');
    const parts = String(order.inGameName || '').trim().split('#');
    if (parts.length !== 2 || !parts.every(p => p.trim())) fail(400, 'Add the Riot ID (name#tag) in this order’s Login Info first.');
    const scope = matchScope(order);
    if (!scope) fail(400, 'Choose a supported service and ranked queue on this order before importing matches.');
    return { ...scope, region, gameName: parts[0].trim(), tagLine: parts[1].trim() };
}

async function riotRequest(region, path, fetcher = fetch, game = 'LOL') {
    if (!configured(game)) fail(503, 'Riot imports are not configured on the server.');
    if (!['americas', 'europe', 'asia', 'sea', ...Object.keys(platforms)].includes(region)) fail(400, 'Unsupported Riot region.');
    const now = Date.now();
    const bucketKey = `${game === 'TFT' && process.env.RIOT_TFT_API_KEY?.trim() ? 'TFT' : 'LOL'}:${region}`;
    const bucket = buckets.get(bucketKey) || { times: [], blockedUntil: 0 };
    bucket.times = bucket.times.filter(t => now - t < 120000);
    buckets.set(bucketKey, bucket);
    if (bucket.blockedUntil > now || bucket.times.length >= 95 || bucket.times.filter(t => now - t < 1000).length >= 18) {
        fail(429, 'Riot’s request limit was reached. Wait a moment before importing again.');
    }
    bucket.times.push(now);
    let response;
    try {
        response = await fetcher(`https://${region}.api.riotgames.com${path}`, {
            headers: { 'X-Riot-Token': apiKey(game) }, signal: AbortSignal.timeout(15000), redirect: 'error',
        });
    } catch { fail(502, 'Riot could not be reached. Please try again.'); }
    if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After'));
        bucket.blockedUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 120) * 1000;
        fail(429, 'Riot is rate limiting requests. Please retry later.');
    }
    if ([401, 403].includes(response.status)) fail(503, 'Riot access is unavailable. Ask an admin to check the server API key.');
    if (response.status === 404) fail(404, 'Riot could not find that account or match. Check the saved Riot ID and region.');
    if (!response.ok) fail(502, 'Riot could not return match history. Please retry later.');
    try { return await response.json(); } catch { fail(502, 'Riot returned an invalid response. Please try again.'); }
}

function normalizeTeams(teams) {
    if (!Array.isArray(teams)) return [];
    return teams.filter(team => [100, 200].includes(team?.teamId)).slice(0, 2).map(team => ({
        id: team.teamId,
        objectives: Object.fromEntries(['baron', 'dragon', 'riftHerald', 'horde', 'tower', 'inhibitor', 'atakhan'].map(key => {
            const kills = team.objectives?.[key]?.kills;
            // Missing objectives in older patches are unknown, not zero.
            return [key, Number.isFinite(kills) && kills >= 0 ? number(kills) : null];
        })),
    }));
}

function normalizeMatch(raw, puuid) {
    const info = raw?.info;
    const players = info?.participants;
    if (!Array.isArray(players) || players.length > 20 || players.some(p => !p || typeof p !== 'object')) return null;
    const selected = players.findIndex(p => p.puuid === puuid);
    if (selected < 0 || !/^[A-Z0-9]+_\d+$/.test(raw?.metadata?.matchId || '')) return null;
    const startedAt = Number(info.gameStartTimestamp || info.gameCreation);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
    const version = /^\d+\.\d+/.exec(String(info.gameVersion))?.[0] || '';
    const duration = info.gameEndTimestamp ? Math.floor((info.gameEndTimestamp - startedAt) / 1000) : number(info.gameDuration);
    return {
        game: 'LOL', externalId: raw.metadata.matchId, participantId: puuid, playedAt: new Date(startedAt),
        details: {
            version, queueId: number(info.queueId), mode: text(info.gameMode), duration: Math.max(0, duration),
            selected, remake: players.some(p => p.gameEndedInEarlySurrender),
            teams: normalizeTeams(info.teams),
            players: players.map(p => ({
                name: text(p.riotIdGameName || p.summonerName || 'Player'), tag: text(p.riotIdTagline),
                champion: text(p.championName), championId: number(p.championId), team: number(p.teamId), win: Boolean(p.win),
                kills: number(p.kills), deaths: number(p.deaths), assists: number(p.assists),
                cs: number(p.totalMinionsKilled) + number(p.neutralMinionsKilled), gold: number(p.goldEarned),
                damage: number(p.totalDamageDealtToChampions), damageTaken: number(p.totalDamageTaken), vision: number(p.visionScore), level: number(p.champLevel),
                summonerSpells: [number(p.summoner1Id), number(p.summoner2Id)],
                runes: [number(p.perks?.styles?.find(s => s.description === 'primaryStyle')?.selections?.[0]?.perk),
                    number(p.perks?.styles?.find(s => s.description === 'subStyle')?.style)],
                items: Array.from({ length: 7 }, (_, i) => number(p[`item${i}`])),
            })),
        },
    };
}

function normalizeTftMatch(raw, puuid, account = {}) {
    const info = raw?.info;
    const players = info?.participants;
    if (!Array.isArray(players) || !players.length || players.length > 8 || players.some(p => !p || typeof p !== 'object')) return null;
    const selected = players.findIndex(p => p.puuid === puuid);
    if (selected < 0 || !/^[A-Z0-9]+_\d+$/.test(raw?.metadata?.match_id || '')) return null;
    const startedAt = Number(info.gameCreation || info.game_datetime);
    if (!Number.isFinite(startedAt) || startedAt <= 0 || players.some(p => !Number.isInteger(p.placement) || p.placement < 1 || p.placement > 8)) return null;
    const objects = value => Array.isArray(value) ? value.filter(v => v && typeof v === 'object').slice(0, 30) : [];
    return { game: 'TFT', externalId: raw.metadata.match_id, participantId: puuid, playedAt: new Date(startedAt), details: {
        version: /\d+\.\d+/.exec(String(info.game_version))?.[0] || '', queueId: number(info.queue_id ?? info.queueId),
        mode: text(info.tft_game_type), duration: number(info.game_length), set: number(info.tft_set_number), selected,
        players: players.map((p, index) => ({
            name: text(p.riotIdGameName || (index === selected ? account.gameName : '') || `Player ${index + 1}`),
            tag: text(p.riotIdTagline || (index === selected ? account.tagLine : '')),
            placement: p.placement, win: p.placement <= 4, level: number(p.level), goldLeft: number(p.gold_left),
            lastRound: number(p.last_round), damage: number(p.total_damage_to_players), eliminated: number(p.players_eliminated),
            traits: objects(p.traits).map(t => ({ id: text(t.name), units: number(t.num_units), tier: number(t.tier_current), style: number(t.style) })),
            units: objects(p.units).map(u => ({ id: text(u.character_id), name: text(u.name), tier: Math.min(4, number(u.tier)), rarity: number(u.rarity),
                items: (Array.isArray(u.itemNames) && u.itemNames.length ? u.itemNames : Array.isArray(u.items) ? u.items : []).slice(0, 3).map(text) })),
        })),
    } };
}

async function importMatches(order, start = 0, request = riotRequest) {
    const { region, gameName, tagLine, game, queueId } = importSettings(order);
    const call = (route, path) => request(route, path, undefined, game);
    const account = await call(region === 'sea' ? 'asia' : region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
    if (typeof account.puuid !== 'string' || !account.puuid) fail(502, 'Riot returned an incomplete account.');
    const since = new Date(order.paidAt || order.createdAt).getTime();
    if (!Number.isFinite(since)) fail(400, 'This order needs a valid payment date before importing matches.');
    const endpoint = game === 'TFT' ? '/tft/match/v1' : '/lol/match/v5';
    // TFT's match-list endpoint has no queue filter. Validate each result below.
    const filter = game === 'LOL' ? `&type=ranked&queue=${queueId}` : '';
    const ids = await call(region, `${endpoint}/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?startTime=${Math.floor(since / 1000)}&start=${start}&count=10${filter}`);
    if (!Array.isArray(ids) || ids.length > 10) fail(502, 'Riot returned an invalid match list.');
    const matches = [];
    // Serial requests keep one import below the development key's burst limit.
    for (const id of ids) {
        if (!/^[A-Z0-9]+_\d+$/.test(id)) fail(502, 'Riot returned an invalid match ID.');
        const raw = await call(region, `${endpoint}/matches/${id}`);
        const match = game === 'TFT' ? normalizeTftMatch(raw, account.puuid, { gameName, tagLine }) : normalizeMatch(raw, account.puuid);
        if (match && match.externalId === id && matchesOrder(order, match) && match.playedAt.getTime() >= since && match.playedAt.getTime() <= Date.now()) matches.push(match);
    }
    return { matches, nextStart: ids.length === 10 ? start + 10 : null };
}
function createRankLookup(request = riotRequest) {
    const games = new Map(), players = new Map();
    function cached(cache, key, limit, loader) {
        const existing = cache.get(key);
        if (existing && existing.until > Date.now()) return existing.promise;
        if (cache.size >= limit) cache.delete(cache.keys().next().value);
        const entry = { until: Date.now() + 3600000 };
        entry.promise = loader().catch(error => { cache.delete(key); throw error; });
        cache.set(key, entry);
        return entry.promise;
    }
    return async match => {
        const platform = String(match.externalId).split('_')[0].toLowerCase();
        if (!platforms[platform] || !/^[A-Z0-9]+_\d+$/.test(match.externalId)) fail(400, 'Unsupported match.');
        const queue = { 420: 'RANKED_SOLO_5x5', 440: 'RANKED_FLEX_SR' }[match.details.queueId];
        if (!queue) return { ranks: match.details.players.map(() => null), checkedAt: new Date().toISOString() };
        // Load only when a scoreboard opens, with shared in-flight/cache entries so
        // paging and several viewers do not multiply calls for the same players.
        const result = await cached(games, match.externalId, 250, async () => {
            const raw = await request(platforms[platform], `/lol/match/v5/matches/${match.externalId}`);
            if (!Array.isArray(raw?.info?.participants) || raw.info.participants.length > 20) fail(502, 'Riot returned an invalid scoreboard.');
            const ranks = [];
            let limited = false;
            for (const player of raw.info.participants) {
                let rank = null;
                if (player?.puuid && !limited) {
                    try {
                        const entries = await cached(players, `${platform}:${player.puuid}`, 2000,
                            () => request(platform, `/lol/league/v4/entries/by-puuid/${encodeURIComponent(player.puuid)}`));
                        if (!Array.isArray(entries)) fail(502, 'Riot returned invalid rankings.');
                        const entry = entries.find(e => e.queueType === queue);
                        const tiers = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
                        if (!entry) rank = { unranked: true };
                        else if (tiers.includes(entry.tier)) rank = { tier: entry.tier,
                            division: ['I', 'II', 'III', 'IV'].includes(entry.rank) ? entry.rank : '', lp: number(entry.leaguePoints) };
                    } catch (error) { if ([429, 503].includes(error.status)) limited = true; }
                }
                ranks.push({ name: text(player?.riotIdGameName || player?.summonerName || 'Player'), tag: text(player?.riotIdTagline),
                    team: number(player?.teamId), championId: number(player?.championId), damageTaken: number(player?.totalDamageTaken), rank });
            }
            return { players: ranks, teams: normalizeTeams(raw.info.teams), checkedAt: new Date().toISOString() };
        });
        // Retry missing ranks later without repeatedly hitting a throttled service.
        const cachedGame = games.get(match.externalId);
        if (cachedGame && result.players.some(p => p.rank === null)) cachedGame.until = Math.min(cachedGame.until, Date.now() + 60000);
        const mapped = match.details.players.map(player => result.players.find(p =>
            p.name === player.name && p.tag === player.tag && p.team === player.team && p.championId === player.championId));
        return { checkedAt: result.checkedAt, ranks: mapped.map(p => p?.rank || null), damageTaken: mapped.map(p => p?.damageTaken ?? null), teams: result.teams };
    };
}
const matchPlayerDetails = createRankLookup();
module.exports = { configured, importSettings, importMatches, normalizeMatch, normalizeTftMatch, riotRequest, createRankLookup, matchPlayerDetails };
