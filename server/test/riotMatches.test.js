const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMatch, normalizeTftMatch, importSettings, importMatches, riotRequest, configured } = require('../src/utils/riotMatches');
const rawMatch = (id = 'NA1_123') => ({ metadata: { matchId: id }, info: { gameVersion: '16.19.123.456', queueId: 420,
    gameStartTimestamp: Date.now() - 3600000, gameEndTimestamp: Date.now() - 1800000,
    participants: [{ puuid: 'other', championName: 'Lux', win: false },
        { puuid: 'account', riotIdGameName: 'Player', riotIdTagline: 'NA1', championName: 'Ahri', championId: 103,
            kills: 7, deaths: 2, assists: 9, item0: 3118, item6: 3364, totalMinionsKilled: 170, neutralMinionsKilled: 8, win: true, totalDamageTaken: 32567,
            summoner1Id: 4, summoner2Id: 14, perks: { styles: [{ description: 'primaryStyle', selections: [{ perk: 8112 }] }, { description: 'subStyle', style: 8200 }] } }] } });
test('normalizes full scoreboard and all item slots, without exposing PUUIDs', () => {
    const match = normalizeMatch(rawMatch(), 'account');
    assert.equal(match.details.players.length, 2);
    assert.equal(match.details.selected, 1);
    assert.equal(match.details.duration, 1800);
    assert.deepEqual(match.details.players[1].items, [3118, 0, 0, 0, 0, 0, 3364]);
    assert.equal(match.details.players[1].cs, 178);
    assert.equal(match.details.players[1].damageTaken, 32567);
    assert.deepEqual(match.details.players[1].summonerSpells, [4, 14]);
    assert.deepEqual(match.details.players[1].runes, [8112, 8200]);
    assert.deepEqual(match.details.players[0].summonerSpells, [0, 0]);
    assert.deepEqual(match.details.players[0].runes, [0, 0]);
    assert.equal(match.details.version, '16.19');
    assert.equal(JSON.stringify(match.details).includes('puuid'), false);
    assert.equal(normalizeMatch(rawMatch(), 'unknown'), null);
    assert.equal(normalizeMatch(rawMatch('../invalid'), 'account'), null);
    assert.equal(normalizeMatch({ info: { participants: {} } }, 'account'), null);
    assert.equal(normalizeMatch({ info: { participants: [null] } }, 'account'), null);
    assert.throws(() => importSettings({ region: 'North America', inGameName: 'missing-tag' }), /name#tag/);
    assert.throws(() => importSettings({ region: 'invalid', inGameName: 'A#B' }), /region/);
});
test('uses region and saved Riot ID, pages history and filters matches before payment', async () => {
    const calls = [];
    const since = new Date(Date.now() - 7200000);
    const result = await importMatches({ boostType: 'Rank Boost', queueType: 'Solo/Duo', region: 'Europe West', inGameName: 'A B#EUW', paidAt: since }, 10, async (region, path) => {
        calls.push({ region, path });
        if (path.includes('/accounts/')) return { puuid: 'account' };
        if (path.includes('/ids?')) return ['EUW1_1', 'EUW1_2'];
        const raw = rawMatch(path.endsWith('_1') ? 'EUW1_1' : 'EUW1_2');
        if (path.endsWith('_2')) raw.info.gameStartTimestamp = since.getTime() - 1000;
        return raw;
    });
    assert.equal(calls[0].region, 'europe');
    assert.match(calls[0].path, /A%20B\/EUW$/);
    assert.match(calls[1].path, /start=10&count=10/);
    assert.match(calls[1].path, /type=ranked/);
    assert.match(calls[1].path, /queue=420/);
    assert.equal(result.matches.length, 1);
    assert.equal(result.nextStart, null);
});
test('objective totals retain team identity and distinguish unavailable counts from zero', () => {
    const raw = rawMatch();
    raw.info.teams = [
        { teamId: 200, objectives: { baron: { kills: 0 }, dragon: { kills: 3 }, horde: { kills: 2 }, tower: { kills: 8 }, secret: 'private-value' } },
        { teamId: 100, objectives: { inhibitor: { kills: 2 }, riftHerald: { kills: -1 }, dragon: { kills: '3' } } },
        null, { teamId: 999 },
    ];
    const teams = normalizeMatch(raw, 'account').details.teams;
    assert.deepEqual(teams.map(t => t.id), [200, 100]);
    assert.deepEqual(teams[0].objectives, { baron: 0, dragon: 3, riftHerald: null, horde: 2, tower: 8, inhibitor: null, atakhan: null });
    assert.equal(teams[1].objectives.inhibitor, 2);
    assert.equal(teams[1].objectives.riftHerald, null);
    assert.equal(teams[1].objectives.dragon, null);
    assert.equal(JSON.stringify(teams).includes('private-value'), false);
    assert.deepEqual(normalizeMatch(rawMatch(), 'account').details.teams, []);
});
test('provider failures stay generic and Retry-After halts further calls', async () => {
    const saved = process.env.RIOT_API_KEY;
    process.env.RIOT_API_KEY = 'synthetic-test-key';
    try {
        await assert.rejects(riotRequest('europe', '/test', async () => ({ status: 403 })), /server API key/);
        await assert.rejects(riotRequest('asia', '/test', async () => { throw new Error('private provider body'); }), /could not be reached/);
        await assert.rejects(riotRequest('sea', '/test', async () => ({ status: 429, headers: new Headers({ 'Retry-After': '120' }) })), /rate limiting/);
        let contacted = false;
        await assert.rejects(riotRequest('sea', '/test', async () => { contacted = true; }), /request limit/);
        assert.equal(contacted, false);
    } finally { if (saved === undefined) delete process.env.RIOT_API_KEY; else process.env.RIOT_API_KEY = saved; }
});

test('Flex imports request Flex only and verify returned queue and match IDs', async () => {
    const calls = [];
    const result = await importMatches({ boostType: 'Placement Boost', queueType: 'Flex', region: 'North America', inGameName: 'A#B', paidAt: new Date(Date.now() - 7200000) }, 0, async (region, path) => {
        calls.push(path);
        if (path.includes('/accounts/')) return { puuid: 'account' };
        if (path.includes('/ids?')) return ['NA1_1', 'NA1_2', 'NA1_3', 'NA1_4'];
        const raw = rawMatch(path.split('/').at(-1));
        raw.info.queueId = path.endsWith('_1') ? 440 : path.endsWith('_2') ? 420 : 400;
        if (path.endsWith('_4')) { raw.info.queueId = 440; raw.metadata.matchId = 'NA1_999'; }
        return raw;
    });
    assert.match(calls[1], /queue=440/);
    assert.deepEqual(result.matches.map(m => m.externalId), ['NA1_1']);
    assert.equal(result.nextStart, null);
});

test('TFT requests use the dedicated server key when present and fall back to the shared key', async () => {
    const saved = { RIOT_API_KEY: process.env.RIOT_API_KEY, RIOT_TFT_API_KEY: process.env.RIOT_TFT_API_KEY };
    const received = [];
    const fakeFetch = async (url, options) => {
        received.push(options.headers['X-Riot-Token']);
        assert.equal(url.includes('synthetic'), false, 'keys must stay out of URLs');
        return { ok: true, status: 200, json: async () => ({}) };
    };
    try {
        process.env.RIOT_API_KEY = 'synthetic-lol';
        process.env.RIOT_TFT_API_KEY = 'synthetic-tft';
        await riotRequest('americas', '/test', fakeFetch, 'TFT');
        await riotRequest('americas', '/test', fakeFetch, 'LOL');
        delete process.env.RIOT_TFT_API_KEY;
        await riotRequest('americas', '/test', fakeFetch, 'TFT');
        assert.deepEqual(received, ['synthetic-tft', 'synthetic-lol', 'synthetic-lol']);
        delete process.env.RIOT_API_KEY;
        assert.equal(configured('TFT'), false);
        process.env.RIOT_TFT_API_KEY = 'synthetic-tft';
        assert.equal(configured('TFT'), true);
        assert.equal(configured('LOL'), false);
    } finally {
        for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
});

const rawTft = (id = 'NA1_1', queue = 1100) => ({ metadata: { match_id: id }, info: {
    queue_id: queue, gameCreation: Date.now() - 3600000, game_datetime: Date.now() - 1800000,
    game_length: 1800.5, game_version: 'Version 16.19.1', tft_set_number: 16, tft_game_type: 'standard',
    participants: [{ puuid: 'account', placement: 2, level: 9, total_damage_to_players: 140, gold_left: 10,
        traits: [{ name: 'TFT16_Mage', num_units: 5, tier_current: 2, style: 2 }],
        units: [{ character_id: 'TFT16_Ahri', tier: 2, rarity: 3, itemNames: ['TFT_Item_JeweledGauntlet'] }] },
        { puuid: 'other-private-id', placement: 1, riotIdGameName: 'Winner', riotIdTagline: 'NA1' }],
} });
test('TFT boards and placements normalize without leaking participant identifiers', () => {
    const raw = rawTft(); const match = normalizeTftMatch(raw, 'account', { gameName: 'Player', tagLine: 'TAG' });
    assert.equal(match.game, 'TFT'); assert.equal(match.details.queueId, 1100);
    assert.equal(match.playedAt.getTime(), raw.info.gameCreation);
    assert.equal(match.details.players[0].name, 'Player'); assert.equal(match.details.players[0].placement, 2);
    assert.equal(match.details.players[0].win, true); assert.equal(match.details.duration, 1800);
    assert.deepEqual(match.details.players[0].units[0].items, ['TFT_Item_JeweledGauntlet']);
    assert.equal(match.details.players[0].traits[0].tier, 2);
    assert.equal(JSON.stringify(match.details).includes('puuid'), false);
    assert.equal(JSON.stringify(match.details).includes('private-id'), false);
    assert.equal(normalizeTftMatch(raw, 'missing'), null);
    assert.equal(normalizeTftMatch(rawTft('../bad'), 'account'), null);
    raw.info.participants[0].placement = 0; assert.equal(normalizeTftMatch(raw, 'account'), null);
    assert.equal(normalizeTftMatch({ info: { participants: [null] } }, 'account'), null);
});
test('TFT uses its own API, filters normal/Hyper Roll/Double Up, and pages past empty ranked batches', async () => {
    const order = { boostType: 'TFT Win Boost', queueType: 'Flex', region: 'Oceania', inGameName: 'A#B', paidAt: new Date(Date.now() - 7200000) };
    const calls = [];
    const result = await importMatches(order, 0, async (region, path, unused, game) => {
        calls.push({ region, path, game });
        if (path.includes('/accounts/')) return { puuid: 'account' };
        if (path.includes('/ids?')) return Array.from({ length: 10 }, (_, i) => `OC1_${i}`);
        const id = path.split('/').at(-1); const raw = rawTft(id, [1090, 1130, 1160][Number(id.split('_')[1]) % 3]);
        return raw;
    });
    assert.equal(calls[0].region, 'asia'); assert.equal(calls[1].region, 'sea');
    assert.ok(calls.every(call => call.game === 'TFT'));
    assert.match(calls[1].path, /^\/tft\/match\/v1\/matches\/by-puuid\/account\/ids\?/);
    assert.doesNotMatch(calls[1].path, /queue=|type=/);
    assert.deepEqual(result.matches, []); assert.equal(result.nextStart, 10);
    const next = await importMatches(order, 10, async (region, path) => {
        if (path.includes('/accounts/')) return { puuid: 'account' };
        if (path.includes('/ids?')) return ['OC1_11', 'OC1_12'];
        const raw = rawTft(path.split('/').at(-1));
        if (path.endsWith('_12')) raw.info.gameCreation = order.paidAt.getTime() - 1;
        return raw;
    });
    assert.deepEqual(next.matches.map(m => m.externalId), ['OC1_11']); assert.equal(next.nextStart, null);
});
