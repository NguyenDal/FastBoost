const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMatch, importSettings, importMatches, riotRequest } = require('../src/utils/riotMatches');
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
    const result = await importMatches({ region: 'Europe West', inGameName: 'A B#EUW', paidAt: since }, 10, async (region, path) => {
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
    assert.equal(result.matches.length, 1);
    assert.equal(result.nextStart, null);
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
