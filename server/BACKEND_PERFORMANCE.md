# Backend read performance

Run the synthetic benchmark from `server`:

```sh
npm run benchmark:backend
npm run benchmark:backend -- --orders=50000 --rounds=9
```

The default fixture contains 20,000 completed, paid orders, of which exactly 1%
involve the requested booster. It mixes legacy contributions and match history,
co-contributors, pending approvals, unconfirmed histories, irrelevant queues,
rejected/unclaimed matches, discounts, missing/zero amounts, and three currencies.
The benchmark asserts that the previous full-report path and the scoped summary
return identical confirmed income on every run. It also asserts scoped order
counts, keyset reads, and the 100-order batch limit.

Timings cover JavaScript processing only, including the asynchronous summary
loop and minimal in-memory adapter bookkeeping. Warmup materializes projected
query results before timing, and measurement order alternates. Database scans,
query planning, sorting, network latency, ORM decoding and fixture construction
are excluded. The printed row counts are deterministic modeled query results,
not measured production traffic. No database is connected and no application
data is changed. Do not describe these timings as production endpoint speedups.

## Work and retained data

For personal earnings, the previous path processes every completed paid order
and builds a detailed report before extracting one booster's totals. The summary
requests only orders involving that booster and only fields needed to calculate
earnings. It retains all co-contributors on those orders to preserve allocations.
With this fixture, order results decrease from 20,000 to 200, and the largest
order result decreases from 20,000 to 100. An exact multiple of the batch size
needs an extra empty read to establish the end of the list.

This removes unrelated orders and report construction from application work;
it does not make all earnings calculations constant time. The allocator still
visits related evidence and sorts shares within each order. If `k` is the number
of relevant orders, `e_i` their evidence counts and `b_i` their booster counts,
the summary performs O(k + sum(e_i + b_i log b_i)) allocation work across those `k`
orders, plus query/result overhead. Retained application data is one batch's
selected orders and evidence plus output totals. The 100-order cap does not cap
the number of matches or JSON bytes in an individual order. The synthetic
benchmark itself holds all fixtures and cached pages, so its process heap is
not a valid measurement of the production summary's retained memory.

The administrator booster directory uses the same bounded summary but still
processes site-wide earnings. Its output totals grow with boosters/currencies.
The detailed administrator earnings report is unchanged and still returns all
report rows. Query indexes can improve access paths, but actual database work
and latency must be checked with representative data and query plans.

## Other bounded result changes

| Read | Previous application result volume | Current application result volume |
| --- | --- | --- |
| Reward page `p` with limit `l` | Up to `2 * p * l` source rows before merge/slice | At most `l` combined rows (`l <= 10`) |
| Support inbox unread markers | Prisma distinct over customer-message history for page threads can transfer underlying history for client deduplication | At most one ID per visible thread (`<= 30`) from `EXISTS` |
| Audit actor names | Actor history used for distinct selection | One latest actor record per actor from PostgreSQL `DISTINCT ON` |

These bounds describe rows returned to the application. Reward pagination still
uses OFFSET, so deep pages can require increasing database work. Support EXISTS
depends on suitable indexes and data distribution. Audit actor results grow
with the number of actors. None of these changes promises constant database
time. Reward sources each read at most `offset + limit` ordered candidates before
the combined sort; that bound still grows with page depth. The additive index
migration is prepared but has not been applied to a real database by this work.
Those indexes only help after the migration has been applied.

## Database regression check

The optional PostgreSQL check uses temporary tables and always rolls back. It
requires the configured development database at `db.prisma.io`, and refuses a
production environment. From `server` in PowerShell:

```powershell
$env:RUN_BACKEND_READ_DB_TEST = '1'
node --test test/backendReadDatabase.test.js
Remove-Item Env:RUN_BACKEND_READ_DB_TEST
```

It checks SQL result equivalence, account boundaries, pagination, unread messages,
audit actor names, and the additive index migration against temporary tables.
The scale case seeds 20,000 orders and 20,000 rewards, inspects `EXPLAIN ANALYZE`,
and asserts that a five-row first page uses ordered indexes with at most five
rows read from either source. Timing diagnostics are informational and have no
machine-dependent pass/fail threshold. It never applies the migration to the
application's persistent tables.
