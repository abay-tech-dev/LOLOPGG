// lib/riot.js
//
// Toute la logique d'accès aux données de joueur League of Legends.
// Source exclusive : API officielle Riot Games (account/summoner/league/
// match/spectator) + Data Dragon (CDN public d'assets). Aucun scraping de
// site tiers (OP.GG, U.GG, etc.) : voir contraintes légales du projet.
//
// Deux modes :
// - Mode réel : nécessite RIOT_API_KEY (variable d'env, jamais exposée au
//   client — ce fichier n'est utilisé que côté serveur, dans les route
//   handlers `app/api/**/route.js`).
// - Mode démo (mock) : utilisé si RIOT_API_KEY est absente ou si l'appelant
//   le demande explicitement. Retourne des données factices réalistes, avec
//   les vraies icônes Data Dragon (pas besoin de clé pour ce CDN public).

const RIOT_API_KEY = process.env.RIOT_API_KEY;

export class RiotApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'RiotApiError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------
// Cache en mémoire (process Node.js).
//
// Limite connue : sur Vercel (fonctions serverless), ce cache est perdu à
// chaque "cold start" et n'est pas partagé entre plusieurs instances. Pour
// une prod multi-clients il faudra le remplacer par un store partagé
// (Upstash Redis, tier gratuit largement suffisant). Le remplacement est
// volontairement isolé à ces deux fonctions : il suffira de les réécrire
// pour appeler Upstash au lieu du Map local, sans toucher au reste du code.
// ---------------------------------------------------------------------

const cacheStore = new Map();

export function cacheGet(key) {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cacheStore.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs) {
  cacheStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function withCache(key, ttlMs, fetchFn) {
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  const value = await fetchFn();
  cacheSet(key, value, ttlMs);
  return value;
}

const CACHE_TTL = {
  // Le refresh front tourne toutes les 15-20s : on aligne le cache stats
  // dessus pour rester sous les rate-limits Riot sans jamais servir une
  // donnée périmée de plus d'un cycle de refresh.
  live: 15 * 1000,
  // Le compte (Riot ID -> PUUID) ne change jamais : cache long.
  account: 30 * 60 * 1000,
  // Un match terminé ne change jamais non plus.
  matchDetail: 60 * 60 * 1000,
  ddragon: 60 * 60 * 1000,
};

// ---------------------------------------------------------------------
// Appel générique à l'API Riot.
// ---------------------------------------------------------------------

async function riotFetch(url) {
  if (!RIOT_API_KEY) {
    throw new RiotApiError('RIOT_API_KEY manquante côté serveur.', 500);
  }
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY },
    cache: 'no-store', // on gère notre propre cache mémoire au-dessus
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new RiotApiError(`Erreur API Riot (${res.status})`, res.status);
  }
  return res.json();
}

// Routage régional (account-v1, match-v5) vs plateforme (summoner-v4,
// league-v4, spectator-v5). Table établie d'après la doc officielle des
// "routing values" de Riot ; à ajuster si Riot fait évoluer ce découpage.
const PLATFORM_TO_REGION = {
  na1: 'americas',
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  euw1: 'europe',
  eun1: 'europe',
  tr1: 'europe',
  ru: 'europe',
  kr: 'asia',
  jp1: 'asia',
  oc1: 'sea',
  ph2: 'sea',
  sg2: 'sea',
  th2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
};

export function getRegionalRoute(platform) {
  return PLATFORM_TO_REGION[platform] || 'europe';
}

function splitRiotId(riotId) {
  const idx = riotId.lastIndexOf('#');
  if (idx <= 0 || idx === riotId.length - 1) {
    throw new RiotApiError('Format de Riot ID invalide. Utilisez Pseudo#TAG.', 400);
  }
  return [riotId.slice(0, idx), riotId.slice(idx + 1)];
}

// ---------------------------------------------------------------------
// Appels Riot API individuels.
// ---------------------------------------------------------------------

async function getAccountByRiotId(gameName, tagLine, platform) {
  const region = getRegionalRoute(platform);
  const key = `account:${region}:${gameName}:${tagLine}`.toLowerCase();
  return withCache(key, CACHE_TTL.account, async () => {
    const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const data = await riotFetch(url);
    if (!data) throw new RiotApiError('Riot ID introuvable.', 404);
    return data;
  });
}

async function getSummonerByPuuid(puuid, platform) {
  const key = `summoner:${platform}:${puuid}`;
  return withCache(key, CACHE_TTL.live, async () => {
    const url = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    const data = await riotFetch(url);
    if (!data) throw new RiotApiError('Invocateur introuvable.', 404);
    return data;
  });
}

// league-v4 ne propose pas encore de variante by-puuid stable : on passe
// par le summonerId renvoyé par summoner-v4 by-puuid.
async function getLeagueEntries(summonerId, platform) {
  const key = `league:${platform}:${summonerId}`;
  return withCache(key, CACHE_TTL.live, async () => {
    const url = `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}`;
    const data = await riotFetch(url);
    return data || [];
  });
}

// spectator-v5 : partie en cours, basé sur le PUUID. Un 404 signifie
// simplement que le joueur n'est pas en jeu (pas une erreur).
async function getActiveGameByPuuid(puuid, platform) {
  const url = `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`;
  return riotFetch(url); // pas de cache : on veut détecter l'entrée en jeu vite
}

async function getTodayMatchIds(puuid, region, max = 20) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startTime = Math.floor(startOfDay.getTime() / 1000);
  const key = `matchids:${region}:${puuid}:${startTime}`;
  return withCache(key, CACHE_TTL.live, async () => {
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${startTime}&start=0&count=${max}`;
    const ids = await riotFetch(url);
    return ids || [];
  });
}

async function getMatchById(matchId, region) {
  const key = `match:${region}:${matchId}`;
  return withCache(key, CACHE_TTL.matchDetail, async () => {
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    return riotFetch(url);
  });
}

// ---------------------------------------------------------------------
// Data Dragon (CDN public d'assets, sans clé API).
// ---------------------------------------------------------------------

// Utilisée si Data Dragon est momentanément injoignable : évite de casser
// l'affichage pour un simple aléa réseau (les URLs d'icônes restent
// valides pour une version un peu ancienne, juste moins à jour).
const FALLBACK_DDRAGON_VERSION = '14.23.1';

async function getLatestDdragonVersion() {
  return withCache('ddragon:version', CACHE_TTL.ddragon, async () => {
    try {
      const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
      const versions = await res.json();
      return versions[0];
    } catch {
      return FALLBACK_DDRAGON_VERSION;
    }
  });
}

async function getChampionIdToNameMap() {
  return withCache('ddragon:champions', CACHE_TTL.ddragon, async () => {
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

async function getChampionNameById(championId) {
  const map = await getChampionIdToNameMap();
  return map[String(championId)] || null;
}

export function getChampionIconUrl(version, championName) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
}

export function getChampionSplashUrl(championName) {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championName}_0.jpg`;
}

async function getProfileIconUrl(iconId) {
  const version = await getLatestDdragonVersion();
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${iconId}.png`;
}

export const QUEUE_NAMES = {
  400: 'Normale (Draft)',
  420: 'Solo/Duo classée',
  430: 'Normale (Blind)',
  440: 'Flex classée',
  450: 'ARAM',
  700: 'Clash',
};

export function getQueueName(queueId) {
  return QUEUE_NAMES[queueId] || 'Autre file';
}

// ---------------------------------------------------------------------
// Agrégation : résumé de match, série en cours.
// ---------------------------------------------------------------------

function summarizeMatch(matchDetail, puuid, version) {
  const participant = matchDetail.info.participants.find((p) => p.puuid === puuid);
  if (!participant) return null;
  return {
    matchId: matchDetail.metadata.matchId,
    win: participant.win,
    championName: participant.championName,
    championIconUrl: getChampionIconUrl(version, participant.championName),
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
    gameCreation: matchDetail.info.gameCreation,
    gameDuration: matchDetail.info.gameDuration,
    queueId: matchDetail.info.queueId,
  };
}

function computeStreak(matchesSortedDesc) {
  if (matchesSortedDesc.length === 0) return null;
  const result = matchesSortedDesc[0].win;
  let count = 0;
  for (const m of matchesSortedDesc) {
    if (m.win !== result) break;
    count += 1;
  }
  return { win: result, count };
}

// ---------------------------------------------------------------------
// Point d'entrée principal (mode réel).
// ---------------------------------------------------------------------

export async function getPlayerStats(riotId, platform) {
  const [gameName, tagLine] = splitRiotId(riotId);
  const region = getRegionalRoute(platform);

  const account = await getAccountByRiotId(gameName, tagLine, platform);
  const puuid = account.puuid;

  const [summoner, liveGameRaw, todayMatchIds, version] = await Promise.all([
    getSummonerByPuuid(puuid, platform),
    getActiveGameByPuuid(puuid, platform),
    getTodayMatchIds(puuid, region),
    getLatestDdragonVersion(),
  ]);

  const [leagueEntries, profileIconUrl, matchDetails] = await Promise.all([
    getLeagueEntries(summoner.id, platform),
    getProfileIconUrl(summoner.profileIconId),
    Promise.all(todayMatchIds.map((id) => getMatchById(id, region))),
  ]);

  const todayMatches = matchDetails
    .filter(Boolean)
    .map((m) => summarizeMatch(m, puuid, version))
    .filter(Boolean)
    .sort((a, b) => b.gameCreation - a.gameCreation);

  const wins = todayMatches.filter((m) => m.win).length;
  const losses = todayMatches.length - wins;
  const streak = computeStreak(todayMatches);
  const soloQueue = leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5') || null;

  let liveGame = null;
  if (liveGameRaw) {
    const participant = liveGameRaw.participants.find((p) => p.puuid === puuid);
    const championName = participant ? await getChampionNameById(participant.championId) : null;
    liveGame = {
      championName,
      championIconUrl: championName ? getChampionIconUrl(version, championName) : null,
      gameLengthSeconds: liveGameRaw.gameLength,
      queueName: getQueueName(liveGameRaw.gameQueueConfigId),
    };
  }

  return {
    riotId: `${gameName}#${tagLine}`,
    platform,
    profileIconUrl,
    summonerLevel: summoner.summonerLevel,
    rank: soloQueue
      ? {
          tier: soloQueue.tier,
          rank: soloQueue.rank,
          leaguePoints: soloQueue.leaguePoints,
          wins: soloQueue.wins,
          losses: soloQueue.losses,
        }
      : null,
    today: { wins, losses },
    streak,
    recentMatches: todayMatches.slice(0, 5),
    liveGame,
    mock: false,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------
// Mode démo (données factices, aucune clé API requise).
// ---------------------------------------------------------------------

const MOCK_CHAMPIONS = ['Ahri', 'Yasuo', 'Jinx', 'LeeSin', 'Thresh', 'Vi', 'Zed', 'Lux', 'MonkeyKing', 'Ezreal'];
const MOCK_TIERS = ['GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickRandom(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

export async function getMockPlayerStats(riotId, platform) {
  const [gameName, tagLine] = riotId.includes('#') ? splitRiotId(riotId) : [riotId || 'DemoStreamer', 'EUW'];
  // Les icônes viennent du vrai CDN Data Dragon (public, sans clé) pour un
  // rendu fidèle même en mode démo.
  const version = await getLatestDdragonVersion();

  const recentMatches = Array.from({ length: 5 }, (_, i) => {
    const win = Math.random() > 0.45;
    const championName = pickRandom(MOCK_CHAMPIONS);
    return {
      matchId: `MOCK_${i}`,
      win,
      championName,
      championIconUrl: getChampionIconUrl(version, championName),
      kills: randomInt(0, 14),
      deaths: randomInt(0, 9),
      assists: randomInt(0, 18),
      cs: randomInt(90, 260),
      gameCreation: Date.now() - i * 32 * 60 * 1000,
      gameDuration: randomInt(1400, 2400),
      queueId: 420,
    };
  }).sort((a, b) => b.gameCreation - a.gameCreation);

  const wins = recentMatches.filter((m) => m.win).length;
  const losses = recentMatches.length - wins;
  const streak = computeStreak(recentMatches);

  const inGame = Math.random() > 0.65;
  const liveChampion = pickRandom(MOCK_CHAMPIONS);

  return {
    riotId: `${gameName}#${tagLine}`,
    platform: platform || 'euw1',
    profileIconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${randomInt(0, 28)}.png`,
    summonerLevel: randomInt(80, 500),
    rank: {
      tier: pickRandom(MOCK_TIERS),
      rank: pickRandom(['I', 'II', 'III', 'IV']),
      leaguePoints: randomInt(0, 100),
      wins: randomInt(80, 220),
      losses: randomInt(80, 220),
    },
    today: { wins, losses },
    streak,
    recentMatches,
    liveGame: inGame
      ? {
          championName: liveChampion,
          championIconUrl: getChampionIconUrl(version, liveChampion),
          gameLengthSeconds: randomInt(60, 1800),
          queueName: 'Solo/Duo classée',
        }
      : null,
    mock: true,
    updatedAt: Date.now(),
  };
}
