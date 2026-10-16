import test from "node:test";
import assert from "node:assert/strict";
import { loadChampions } from "../src/api/champions.js";

const champion = {
  id: "Ahri", name: "Ahri",
  icon: "https://ddragon.leagueoflegends.com/cdn/16.1.1/img/champion/Ahri.png",
};

function fixture(t, { cache = null, storageBlocked = false, responses = [] } = {}) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let stored = cache;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        if (storageBlocked) throw new Error("Storage blocked");
        return stored;
      },
      setItem(_key, value) {
        if (storageBlocked) throw new Error("Storage blocked");
        stored = value;
      },
    },
  });
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Unexpected request");
    return { ok: response.ok ?? true, json: async () => response.body };
  });
  return { requests, readStored: () => JSON.parse(stored) };
}

const catalogResponses = () => [
  { body: ["16.2.1"] },
  { body: { data: { Ahri: { id: "Ahri", name: "Ahri", image: { full: "Ahri.png" } } } } },
];

test("fresh champion cache avoids a network request", async (t) => {
  const setup = fixture(t, { cache: JSON.stringify({ champions: [champion], savedAt: Date.now() }) });
  assert.deepEqual(await loadChampions(), [champion]);
  assert.equal(setup.requests.length, 0);
});

test("stale champion cache stays usable when Data Dragon returns HTTP errors", async (t) => {
  fixture(t, {
    cache: JSON.stringify({ champions: [champion], savedAt: 0 }),
    responses: [{ ok: false, body: ["16.2.1"] }],
  });
  assert.deepEqual(await loadChampions(), [champion]);
});

test("HTTP errors without a cache reject so the picker can offer a retry", async (t) => {
  fixture(t, { responses: [{ body: ["16.2.1"] }, { ok: false, body: {} }] });
  await assert.rejects(loadChampions(), /Champions are unavailable/);
});

test("malformed cache is replaced with the fetched catalog and matching versioned icons", async (t) => {
  const setup = fixture(t, { cache: "invalid-json", responses: catalogResponses() });
  const champions = await loadChampions();
  assert.deepEqual(champions, [{ ...champion, icon: champion.icon.replace("16.1.1", "16.2.1") }]);
  assert.match(setup.requests[1], /\/16\.2\.1\/data\/en_US\/champion\.json$/);
  assert.deepEqual(setup.readStored().champions, champions);
});

test("blocked browser storage does not prevent loading champions", async (t) => {
  fixture(t, { storageBlocked: true, responses: catalogResponses() });
  assert.equal((await loadChampions())[0].name, "Ahri");
});

test("invalid remote catalog rejects instead of reporting an empty successful load", async (t) => {
  fixture(t, { responses: [{ body: ["16.2.1"] }, { body: { data: {} } }] });
  await assert.rejects(loadChampions(), /Champion catalog is empty/);
});

test("simultaneous pickers share one in-flight catalog request", async (t) => {
  const setup = fixture(t, { responses: catalogResponses() });
  const [first, second] = await Promise.all([loadChampions(), loadChampions()]);
  assert.deepEqual(first, second);
  assert.equal(setup.requests.length, 2);
});
