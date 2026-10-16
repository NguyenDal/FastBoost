const CHAMPIONS_CACHE_KEY = "fastboost:champions:v1";
const CHAMPIONS_CACHE_TTL = 24 * 60 * 60 * 1000;
const DATA_DRAGON_URL = "https://ddragon.leagueoflegends.com";

let pendingLoad = null;

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CHAMPIONS_CACHE_KEY));
    if (!Array.isArray(cached?.champions) || cached.champions.length === 0) return null;
    if (!cached.champions.every((champion) => (
      typeof champion?.id === "string" && champion.id.length > 0 &&
      typeof champion.name === "string" && champion.name.length > 0 &&
      typeof champion.icon === "string" &&
      /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/\d+\.\d+\.\d+\/img\/champion\/[A-Za-z0-9]+\.png$/.test(champion.icon)
    ))) return null;
    return cached;
  } catch {
    return null;
  }
}

async function fetchCatalog(cached) {
  try {
    const versionResponse = await fetch(`${DATA_DRAGON_URL}/api/versions.json`);
    if (!versionResponse.ok) throw new Error("Champion versions are unavailable.");
    const versions = await versionResponse.json();
    const latestVersion = Array.isArray(versions) ? versions[0] : null;
    if (typeof latestVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(latestVersion)) {
      throw new Error("Champion version is invalid.");
    }

    const championResponse = await fetch(
      `${DATA_DRAGON_URL}/cdn/${latestVersion}/data/en_US/champion.json`
    );
    if (!championResponse.ok) throw new Error("Champions are unavailable.");
    const championData = await championResponse.json();
    if (!championData?.data || typeof championData.data !== "object" || Array.isArray(championData.data)) {
      throw new Error("Champion catalog is invalid.");
    }
    const champions = Object.values(championData.data).filter((champion) => (
      typeof champion?.id === "string" && champion.id.length > 0 &&
      typeof champion.name === "string" && champion.name.length > 0 &&
      typeof champion.image?.full === "string" &&
      /^[A-Za-z0-9]+\.png$/.test(champion.image.full)
    )).map((champion) => ({
      id: champion.id,
      name: champion.name,
      icon: `${DATA_DRAGON_URL}/cdn/${latestVersion}/img/champion/${champion.image.full}`,
    }));
    if (champions.length === 0) throw new Error("Champion catalog is empty.");

    try {
      localStorage.setItem(CHAMPIONS_CACHE_KEY, JSON.stringify({ champions, savedAt: Date.now() }));
    } catch {
      // Browsers that block storage can still use the fetched catalog.
    }
    return champions;
  } catch (error) {
    // Existing champions remain usable while Data Dragon is temporarily unavailable.
    if (cached) return cached.champions;
    throw error;
  }
}

export function loadChampions() {
  const cached = readCache();
  if (cached && typeof cached.savedAt === "number" &&
    Date.now() - cached.savedAt >= 0 && Date.now() - cached.savedAt < CHAMPIONS_CACHE_TTL) {
    return Promise.resolve(cached.champions);
  }
  if (!pendingLoad) {
    pendingLoad = fetchCatalog(cached).finally(() => { pendingLoad = null; });
  }
  return pendingLoad;
}
