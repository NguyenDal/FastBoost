# Riot match history

The first integration supports ranked League of Legends matches. TFT retains the
existing match-count contribution flow. This feature records earnings allocations;
it does not transfer money.

## Local setup

1. Sign in to https://developer.riotgames.com/ and generate a development key.
2. Store it only in the ignored `server/.env` as `RIOT_API_KEY=...`. Never use a
   `VITE_` variable, commit the key, paste it into chat, or put it in a client bundle.
3. Restart the backend after changing the environment variable. Development keys
   expire every 24 hours; expiration stops new imports, not saved match reviews.
4. Apply the match-history migration and regenerate Prisma before running the API.
   This repository's documented development database has historical migration
   drift: do not reset it or blindly run all migrations. Apply the reviewed new
   migration with its checksum in migration history, as recorded in the handoff.

The development database migration and Prisma generation were completed locally
on October 5, 2026. This does not establish deployment to any other database.

## Import and review

- Save the customer's Riot ID (`name#tag`) in the order's Details → Login Info.
  The order's selected region is used for API routing.
- Open Match History and use the refresh icon as an admin or assigned booster.
  History displays five matches per page using the shared order pagination.
  Customers receive only submitted/approved matches; unclaimed imports and excluded
  matches are filtered on the server, including the player-details endpoint.
- Imports fetch up to 10 ranked matches at a time, starting at the order payment
  timestamp. Import older matches to continue. Wait one minute between requests.
  Duplicate imports leave existing reviews intact. Riot limits are also enforced
  by region within the API process and `Retry-After` responses are respected.
- Assigned boosters check the games they played across pages, then submit them
  after confirming the selected count, cumulative submitted count, and estimated
  cumulative earnings. Quotes are computed on the server and bound to the history
  revision and amount. Claims are atomic, belong to the authenticated booster,
  and append SUBMITTED audit records. They remain PENDING until admin review.
- Riot identifies the game account, not the human playing. Admins approve submitted
  work or exclude incorrect claims; unrelated games can remain unsubmitted.
- After the paid order is completed, confirm its complete match history to allocate
  the 70% pool proportionally by approved matches. Pending submitted claims block
  confirmation; unclaimed imports do not. Estimates include submitted/approved work
  only and can change with other claims or review decisions; they do not fund payouts.
  Old count submissions cannot bypass this flow. Existing completed/cancelled orders
  keep their prior allocations. One account's match can be approved on only one order.
- Reopening a confirmed history unconfirms its allocation until it is reviewed and
  confirmed again. Individual review revisions are retained in `OrderMatchReview`.
- Expanded player rows include champion/level, spells, runes, name, and current rank
  for that match's queue. League-v4 rank calls run only on expansion and are cached
  for an hour, sharing in-flight requests. Missing ranks retry after a short cooldown.
  They are current ranks, not historical ranks from the match date. Player-details
  also fills damage taken for older snapshots; damage dealt is red and taken grey.

Data shown: result, champion, K/D/A, CS, gold, duration, final seven item slots,
and an expandable scoreboard with all participants, damage, vision and item builds.
Images and item names use the matching Data Dragon patch. API keys never reach the
browser; stored match snapshots exclude raw provider payloads and account PUUIDs
from the client response.

## Production access (avoiding daily development-key resets)

Use Register Product → Production API Key in the Riot portal for a public service.
Personal keys are for the developer or a small private community, not a public app.
Riot approval is required and is not guaranteed for this service or business model.

For the current application form:
- Product name: FastBoost
- Product URL: https://www.fastboost.gg/
- Product group: Default Group, unless sharing with a real development team
- Game focus: League of Legends
- Organizing tournaments: No

Describe the actual service and the intended Account-v1/Match-v5 usage accurately,
including match display, admin review, and compensation based on approved matches.
Do not present the whole service as an unrelated stats-only product to obtain access.
Disclose that the new match-history feature is currently a local prototype. Riot
needs an accessible demonstration or other review material; localhost is not
accessible to their reviewers. Review and accept portal terms personally.

After approval, set the approved key as the backend host's secret `RIOT_API_KEY`
environment variable and restart/redeploy that API. Keep it out of frontend hosting.
Do not publish this API feature using the temporary development key. Multi-instance
hosting should coordinate key rate limits across instances; the current limiter is
process-local.

### Render configuration

The backend service is `fastboost-api`. Set `RIOT_API_KEY` in that service's
Environment Variables, never on the `fastboost-web` static site. Render's **Save
only** stores the value for a later deployment; it does not restart the running
service. Use that option when preparing configuration before the matching feature
release. A key alone does not deploy the Match History code or its migration.

Local development separately reads `server/.env`. To use a replacement locally,
update its `RIOT_API_KEY` entry and restart the local API. Never copy this file to
the frontend or commit it. Changing Render does not change the local `.env` file.

An application's Approved status alone should not be treated as proof of a
production key or permission for a different use case. Confirm the registered tier
and approved scope before public activation. The 20/second and 100/two-minute
limits match Riot's documented personal-key tier; limits alone do not conclusively
identify a key's category.

References:
- https://developer.riotgames.com/docs/portal#web-apis_api-keys
- https://developer.riotgames.com/docs/lol

## Checks

`npm test` in `server` runs the route, permission, import and allocation tests.
The opt-in `RUN_MATCH_HISTORY_DB_TEST=1 node --test test/matchHistoryDb.test.js`
verifies storage and the duplicate-pay constraint using synthetic data in a
rolled-back transaction, and only accepts the documented development DB host.
