// lib/ddragon.js
//
// Petits helpers vers Data Dragon (CDN public d'assets de Riot,
// ddragon.leagueoflegends.com) : icônes de champion, splash arts, mapping
// id de champion -> nom technique. Aucune clé API requise, ce n'est pas
// l'API de jeu Riot (pas de rate-limit, pas de compte développeur) — on
// s'en sert uniquement comme source d'images, exactement comme le fait
// OP.GG lui-même pour une partie de ses assets.

const cacheStore = new Map();

async function withCache(key, ttlMs, fetchFn) {
  const entry = cacheStore.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.value;
  const value = await fetchFn();
  cacheStore.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

const CACHE_TTL_DDRAGON = 60 * 60 * 1000;

// Utilisée si Data Dragon est momentanément injoignable : évite de casser
// l'affichage pour un simple aléa réseau.
const FALLBACK_VERSION = '14.23.1';

export async function getLatestDdragonVersion() {
  return withCache('ddragon:version', CACHE_TTL_DDRAGON, async () => {
    try {
      const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
      const versions = await res.json();
      return versions[0];
    } catch {
      return FALLBACK_VERSION;
    }
  });
}

export async function getChampionIdToNameMap() {
  return withCache('ddragon:champions', CACHE_TTL_DDRAGON, async () => {
    try {
      const version = await getLatestDdragonVersion();
      const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`);
      const data = await res.json();
      const map = {};
      for (const champ of Object.values(data.data)) {
        // champ.key = identifiant numérique (string), champ.id = nom
        // technique utilisé dans les URLs d'assets (ex: "MonkeyKing" pour
        // Wukong).
        map[champ.key] = champ.id;
      }
      return map;
    } catch {
      return {};
    }
  });
}

export async function getChampionNameById(championId) {
  if (championId == null) return null;
  const map = await getChampionIdToNameMap();
  return map[String(championId)] || null;
}

export function getChampionIconUrl(version, championName) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
}

export function getChampionSplashUrl(championName) {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championName}_0.jpg`;
}

export async function getProfileIconUrl(iconId) {
  if (iconId == null) return null;
  const version = await getLatestDdragonVersion();
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${iconId}.png`;
}
