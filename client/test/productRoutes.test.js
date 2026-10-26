import assert from 'node:assert/strict';
import test from 'node:test';
import { matchRoutes } from 'react-router-dom';
import { orderPathForService, searchWithSelectedGame, selectedGameFromSearch, serviceTitleFromOrderRoute, uniqueServiceForTitle } from '../src/utils/productRoutes.js';

test('all catalog products have readable and unambiguous purchase URLs', () => {
  const products = [
    ['Rank Boost', '/order/league-of-legends/rank-boost'],
    ['Placement Boost', '/order/league-of-legends/placement-boost'],
    ['Win Boost', '/order/league-of-legends/win-boost'],
    ['Pro Duo', '/order/league-of-legends/pro-duo'],
    ['TFT Rank Boost', '/order/teamfight-tactics/rank-boost'],
    ['TFT Win Boost', '/order/teamfight-tactics/win-boost'],
    ['TFT Placement Boost', '/order/teamfight-tactics/placement-boost'],
  ];
  const catalog = products.map(([title], index) => ({ id: `service-${index}`, title }));
  for (const [title, path] of products) {
    const service = catalog.find(item => item.title === title);
    assert.equal(orderPathForService(service, catalog), path);
    const [, , game, product] = path.split('/');
    assert.equal(serviceTitleFromOrderRoute(game, product), title);
  }
  assert.equal(serviceTitleFromOrderRoute('league-of-legends', 'admin'), null);
});

test('duplicate titles and unknown products retain the legacy ID route', () => {
  const first = { id: 'one', title: 'Rank Boost' };
  const second = { id: 'two', title: 'Rank Boost' };
  assert.equal(uniqueServiceForTitle([first, second], 'Rank Boost'), null);
  assert.equal(orderPathForService(first, [first, second]), '/order/one');
  assert.equal(orderPathForService({ id: 'legacy/one', title: 'Other Service' }, [first]), '/order/legacy%2Fone');
  assert.equal(orderPathForService(first), '/order/one');
});

test('canonical and legacy order URLs select the intended route', () => {
  const routes = [{ path: '/order/:serviceId' }, { path: '/order/:game/:product' }];
  assert.equal(matchRoutes(routes, '/order/league-of-legends/rank-boost')?.at(-1)?.route.path, '/order/:game/:product');
  assert.equal(matchRoutes(routes, '/order/legacy-service-id')?.at(-1)?.route.path, '/order/:serviceId');
});

test('home game selection has a shareable, validated query parameter', () => {
  assert.equal(selectedGameFromSearch('?game=teamfight-tactics'), 'tft');
  assert.equal(selectedGameFromSearch('?game=league-of-legends'), 'lol');
  assert.equal(selectedGameFromSearch('?game=unknown'), '');
  assert.equal(searchWithSelectedGame('?support=open', 'tft'), 'support=open&game=teamfight-tactics');
  assert.equal(searchWithSelectedGame('?support=open&game=teamfight-tactics', ''), 'support=open');
});
