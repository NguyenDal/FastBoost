const test = require('node:test');
const assert = require('node:assert/strict');
const { createRankLookup } = require('../src/utils/riotMatches');

const players = [0, 1].map(i => ({ name: `Player${i}`, tag: 'NA1', team: i ? 200 : 100, championId: 103 + i }));
const match = id => ({ externalId: `NA1_${id}`, details: { queueId: 440, players } });
const raw = { info: { teams: [{ teamId: 200, objectives: { baron: { kills: 0 }, dragon: { kills: 3 }, tower: { kills: 8 } } }], participants: players.map((p, i) => ({ puuid: `private-${i}`, riotIdGameName: p.name, riotIdTagline: p.tag,
    teamId: p.team, championId: p.championId, totalDamageTaken: 30000 + i })) } };

test('player details use the match queue and platform, preserve player mapping and cache concurrent reads', async () => {
    const calls = [];
    const lookup = createRankLookup(async (region, path) => {
        calls.push({ region, path });
        if (path.includes('/match/')) return raw;
        return [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I', leaguePoints: 40 },
            { queueType: 'RANKED_FLEX_SR', tier: 'EMERALD', rank: 'IV', leaguePoints: 63 }];
    });
    const results = await Promise.all([lookup(match(1)), lookup(match(1))]);
    assert.equal(calls.length, 3, 'simultaneous viewers share the scoreboard and rank calls');
    assert.equal(calls[0].region, 'americas'); assert.equal(calls[1].region, 'na1');
    assert.match(calls[1].path, /league\/v4\/entries\/by-puuid\//);
    assert.deepEqual(results[0].ranks[0], { tier: 'EMERALD', division: 'IV', lp: 63 });
    assert.deepEqual(results[0].damageTaken, [30000, 30001]);
    assert.equal(results[0].teams[0].id, 200);
    assert.equal(results[0].teams[0].objectives.baron, 0);
    assert.equal(results[0].teams[0].objectives.tower, 8);
    assert.equal(results[0].teams[0].objectives.inhibitor, null);
    assert.equal(JSON.stringify(results).includes('private-'), false, 'PUUIDs must remain server-side');
    await lookup(match(2)); assert.equal(calls.length, 4, 'a player shared by another match reuses rank data');
    const reversed = await lookup({ ...match(1), details: { queueId: 440, players: [...players].reverse() } });
    assert.deepEqual(reversed.damageTaken, [30001, 30000], 'results map by player identity, not array position');
});
test('rank failures keep stored scoreboards usable and never imply unranked', async () => {
    let calls = 0;
    const lookup = createRankLookup(async (region, path) => {
        calls++;
        if (path.includes('/match/')) return raw;
        throw Object.assign(new Error('Riot throttled'), { status: 429 });
    });
    const result = await lookup(match(3));
    assert.deepEqual(result.ranks, [null, null]); assert.deepEqual(result.damageTaken, [30000, 30001]);
    assert.equal(result.teams[0].objectives.dragon, 3, 'rank throttling must not discard match objective data');
    assert.equal(calls, 2, 'stop further rank requests when throttled');
    await lookup(match(3)); assert.equal(calls, 2, 'cooldown prevents repeated requests from expanding again');
});
test('only a successful empty queue response means unranked; unsupported hosts never receive the key', async () => {
    let calls = 0;
    const lookup = createRankLookup(async (region, path) => { calls++; return path.includes('/match/') ? raw : []; });
    assert.deepEqual((await lookup(match(4))).ranks, [{ unranked: true }, { unranked: true }]);
    await assert.rejects(lookup({ ...match(4), externalId: 'EVIL_1' }), /Unsupported match/);
    await assert.rejects(lookup({ ...match(4), externalId: 'NA1_../1' }), /Unsupported match/);
    assert.equal(calls, 3);
});
