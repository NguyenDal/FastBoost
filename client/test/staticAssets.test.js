import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRankAssetPath } from '../src/utils/rankAssets.js';

const clientRoot = fileURLToPath(new URL('../', import.meta.url));
const assetRoot = join(clientRoot, 'public', 'assets');
const assets = [
  'logos/fastboost-logo.svg', 'logos/fastboost-logo.png', 'logos/lol-logo.jpg', 'logos/tft-logo.png',
  'roles/top.png', 'roles/jungle.png', 'roles/mid.png', 'roles/bot.png', 'roles/support.png', 'roles/fill.png',
  'services/lol-card.jpg', 'services/tft-card.jpg',
  'services/rank-boost-transparent.png', 'services/placement-boost-transparent.png',
  'services/win-boost-transparent.png', 'services/pro-duo-transparent.png',
  'services/ranks/unranked.webp', 'services/ranks/iron.png', 'services/ranks/bronze.png',
  'services/ranks/silver.png', 'services/ranks/gold.png', 'services/ranks/platinum.png',
  'services/ranks/emerald.png', 'services/ranks/diamond.png', 'services/ranks/master.png',
  'services/ranks/grandmaster.png', 'services/ranks/challenger.png',
  'updates/opening.png', 'updates/opening-hero.webp',
  'updates/opening-ticket.webp', 'updates/player-guides-hologram.webp', 'updates/grand-opening-velocity.webp',
  'updates/grand-opening-velocity-hero.webp',
  'guides/summoners-rift.png',
];

test('all migrated public art is checked in with the expected image format', () => {
  for (const asset of assets) {
    const bytes = readFileSync(join(assetRoot, asset));
    assert.ok(bytes.length > 100, `${asset} has image data`);
    if (asset.endsWith('.png')) assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', asset);
    if (asset.endsWith('.jpg')) assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff', asset);
    if (asset.endsWith('.webp')) assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', asset);
    if (asset.endsWith('.svg')) assert.match(bytes.toString('utf8', 0, 500), /<svg\b/, asset);
  }
});

test('dynamic rank paths use only checked-in ranks', () => {
  for (const tier of ['unranked', 'iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger']) {
    const asset = getRankAssetPath(`${tier.toUpperCase()} IV`);
    assert.ok(assets.includes(asset.slice('/assets/'.length)), tier);
  }
  assert.equal(getRankAssetPath('../../private'), null);
  assert.equal(getRankAssetPath('unknown'), null);
});

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(jsx?|css|html)$/.test(entry.name) ? [path] : [];
  });
}

test('client source no longer depends on the public FastBoost S3 bucket', () => {
  for (const path of [join(clientRoot, 'index.html'), ...sourceFiles(join(clientRoot, 'src'))]) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /fastboost-assets\.s3(?:\.ca-central-1)?\.amazonaws\.com/, path);
  }
});
