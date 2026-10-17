import test from 'node:test';
import assert from 'node:assert/strict';
import { findAssignedBooster, getBoosterDisplayName, getBoosterAvatar } from '../src/utils/matchBoosterProfile.js';

test('saved profile name and image take precedence over legacy user fields', () => {
    const booster = { username: 'old-handle', profileImage: 'https://images.example.test/old.png',
        avatar: 'https://images.example.test/avatar.png', profileImageUrl: 'https://images.example.test/top-level.png',
        profile: { displayName: 'Saved booster', profileImageUrl: 'https://images.example.test/saved.png' } };
    assert.equal(getBoosterDisplayName(booster), 'Saved booster');
    assert.equal(getBoosterAvatar(booster), 'https://images.example.test/saved.png');
});

test('missing or blank photo uses initials only when no saved or legacy image exists', () => {
    const booster = { profile: { displayName: 'A & B', profileImageUrl: ' ' } };
    const url = new URL(getBoosterAvatar(booster));
    assert.equal(url.hostname, 'ui-avatars.com');
    assert.equal(url.searchParams.get('name'), 'A & B');
    assert.equal(getBoosterDisplayName(null), 'Assigned Booster');
    assert.equal(getBoosterDisplayName({ username: ' ', name: 'Named booster', email: 'private@example.test' }), 'Named booster');
    for (const image of ['profileImageUrl', 'profileImage', 'avatar', 'photoUrl']) {
        assert.equal(getBoosterAvatar({ [image]: 'https://images.example.test/legacy.png' }), 'https://images.example.test/legacy.png');
        assert.equal(getBoosterAvatar({ profile: { [image]: 'https://images.example.test/legacy.png' } }), 'https://images.example.test/legacy.png');
    }
});

test('current assignment outranks a stale provider participant, including an assigned admin booster', () => {
    const rating = { average: 4.5, count: 8, available: true };
    const conversation = { participants: [
        { user: { id: 'former', role: 'PROVIDER', username: 'Former booster' } },
        { user: { id: 'current', role: 'ADMIN', hasBoosterAccess: true, username: 'Old name',
            profile: { displayName: 'Old display', profileImageUrl: 'https://images.example.test/old.png', avatar: 'legacy.png' } } },
    ] };
    const order = { assignments: [{ boosterId: 'current', booster: { id: 'current', role: 'ADMIN', hasBoosterAccess: true,
        username: 'Current name', profile: { displayName: 'Current display', profileImageUrl: 'https://images.example.test/current.png' }, rating } }] };
    const before = structuredClone({ conversation, order });
    const booster = findAssignedBooster(conversation, order);
    assert.equal(booster.id, 'current');
    assert.equal(booster.role, 'ADMIN');
    assert.equal(getBoosterDisplayName(booster), 'Current display');
    assert.equal(getBoosterAvatar(booster), 'https://images.example.test/current.png');
    assert.deepEqual(booster.rating, rating);
    assert.deepEqual({ conversation, order }, before, 'neither response snapshot is mutated');
});

test('matching participant enriches missing fields without replacing authoritative rating or cleared profile fields', () => {
    const conversation = { participants: [{ userId: 'booster', user: { id: 'booster', username: 'Known handle',
        rating: { average: 5, count: 100, available: true }, profile: { displayName: 'Old name', profileImageUrl: 'stale.png' } } }] };
    const rating = { average: null, count: 0, available: false };
    const result = findAssignedBooster(conversation, { assignments: [{ boosterId: 'booster', booster: {
        id: 'booster', profile: { displayName: 'Saved name', profileImageUrl: null }, rating,
    } }] });
    assert.equal(result.username, 'Known handle');
    assert.equal(result.profile.displayName, 'Saved name');
    assert.equal(result.profile.profileImageUrl, null);
    assert.deepEqual(result.rating, rating);
    assert.match(getBoosterAvatar(result), /^https:\/\/ui-avatars\.com\//);
    assert.equal(findAssignedBooster(conversation, { assignments: [{ boosterId: 'booster', booster: { id: 'booster', profile: null } }] }).profile, null);
});

test('ID-only assignments resolve the matching participant rather than the first provider', () => {
    const conversation = { participants: [{ user: { id: 'former', role: 'PROVIDER' } },
        { userId: 7, participant: { username: 'Assigned', role: 'ADMIN', hasBoosterAccess: true,
            profile: { profileImageUrl: 'https://images.example.test/assigned.png' } } }] };
    const booster = findAssignedBooster(conversation, { orderAssignments: [{ providerId: '7' }] });
    assert.equal(booster.id, '7');
    assert.equal(booster.username, 'Assigned');
    assert.equal(getBoosterAvatar(booster), 'https://images.example.test/assigned.png');
    const unmatched = findAssignedBooster(conversation, { assignments: [{ boosterId: 'new' }] });
    assert.equal(unmatched.id, 'new');
    assert.equal(unmatched.username, undefined);
});

test('explicit empty assignments never revive stale conversation participants', () => {
    const conversation = { participants: [{ user: { id: 'former', role: 'PROVIDER' } }] };
    for (const order of [{ assignments: [] }, { orderAssignments: [] }, { assignments: null },
        { assignments: [], orderAssignments: [{ booster: { id: 'also-old' } }] }]) {
        assert.equal(findAssignedBooster(conversation, order), null);
    }
});

test('legacy order references still precede participant fallback and support assignment relation aliases', () => {
    const conversation = { participants: [{ user: { id: 'stale', role: 'PROVIDER' } }] };
    for (const relation of ['booster', 'user', 'provider']) {
        assert.equal(findAssignedBooster(conversation, { assignments: [{ [relation]: { id: 'current' } }] }).id, 'current');
    }
    for (const key of ['booster', 'provider', 'assignedBooster', 'assignedProvider']) {
        assert.equal(findAssignedBooster(conversation, { assignments: [], [key]: { id: 'legacy' } }).id, 'legacy');
    }
    assert.equal(findAssignedBooster(conversation, {}).id, 'stale');
    assert.equal(findAssignedBooster({ participants: [{ user: { id: 'customer', role: 'CUSTOMER' } },
        { user: { id: 'admin', role: 'ADMIN', hasBoosterAccess: true } }] }, {}).id, 'admin');
    assert.equal(findAssignedBooster(null, null), null);
});
