// lib/opgg.js
//
// Récupération des stats de joueur en fetchant directement les endpoints
// JSON internes du site op.gg (ceux que op.gg/ appelle lui-même depuis le
// navigateur pour afficher ses pages). Aucune clé API, aucune inscription
// développeur Riot.
//
// ⚠️ Ce ne sont PAS des endpoints publics documentés/officiels : op.gg
// peut en changer la forme ou les bloquer sans préavis, et ses CGU
// interdisent en principe l'automatisation de ce type de requêtes (voir
// README pour le détail du risque). C'est un choix assumé du projet pour
// éviter la dépendance à l'API Riot — pas une garantie de stabilité.
//
// Tout le mapping des champs JSON (noms exacts renvoyés par op.gg) est
// centralisé dans les fonctions `extract*` ci-dessous : si op.gg change sa
// structure, c'est le seul endroit à corriger. Structure vérifiée via
// `/api/stats?...&debug=1` (voir debugFetchRaw) sur un vrai compte début
// 2026 : la recherche par riot_id renvoie directement les infos de rang
// (`solo_tier_info`), et il n'existe pas d'endpoint "summary" séparé
// (celui qu'on avait deviné renvoie 404) — tout vient de la recherche +
// de l'historique de games.

import {
  getChampionIconUrl,
  getChampionNameById,
  getLatestDdragonVersion,
  getProfileIconUrl,
} from './ddragon';

export class OpggError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'OpggError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------
// Cache en mémoire (voir note sur Upstash Redis dans le README pour la
// prod multi-clients : ces deux fonctions sont le seul endroit à changer).
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

// Cache volontairement un peu large : on veut rester "discret" côté
// fréquence de requêtes vers op.gg (pas de rate-limit documenté, donc
// prudence), tout en restant aligné sur le refresh du front (15-20s).
const CACHE_TTL = {
  live: 20 * 1000,
  search: 10 * 60 * 1000,
};

// ---------------------------------------------------------------------
// Requête HTTP vers op.gg, avec des en-têtes de navigateur réalistes
// (op.gg est protégé par un anti-bot type Cloudflare : un fetch nu sans
// User-Agent est bloqué quasi systématiquement).
// ---------------------------------------------------------------------

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://www.op.gg/',
};

async function opggFetch(url) {
  let res;
  try {
    res = await fetch(url, { headers: BROWSER_HEADERS, cache: 'no-store' });
  } catch {
    throw new OpggError('OP.GG est injoignable (erreur réseau).', 502);
  }
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) {
    throw new OpggError(
      'OP.GG a bloqué la requête (protection anti-bot ou trop de requêtes). Réessayez dans quelques instants.',
      res.status
    );
  }
  if (!res.ok) {
    throw new OpggError(`Erreur OP.GG (${res.status}).`, res.status);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // op.gg a probablement renvoyé une page HTML (challenge anti-bot,
    // page d'erreur générique) au lieu du JSON attendu.
    throw new OpggError("Réponse inattendue d'OP.GG (probablement un blocage anti-bot).", 502);
  }
}

// ---------------------------------------------------------------------
// Régions op.gg (distinctes des "routing values" de l'API Riot).
// ---------------------------------------------------------------------

const REGIONS = ['na', 'euw', 'eune', 'kr', 'jp', 'br', 'lan', 'las', 'oce', 'tr', 'ru'];

export function normalizeRegion(region) {
  const key = (region || 'euw').toLowerCase();
  return REGIONS.includes(key) ? key : 'euw';
}

function splitRiotId(riotId) {
  const idx = riotId.lastIndexOf('#');
  if (idx <= 0 || idx === riotId.length - 1) {
    throw new OpggError('Format de Riot ID invalide. Utilisez Pseudo#TAG.', 400);
  }
  return [riotId.slice(0, idx), riotId.slice(idx + 1)];
}

// ---------------------------------------------------------------------
// Appels aux endpoints JSON internes d'op.gg.
// ---------------------------------------------------------------------

const SUMMONER_API = 'https://lol-api-summoner.op.gg/api';

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function searchSummoner(gameName, tagLine, region) {
  const riotId = `${encodeURIComponent(gameName)}%23${encodeURIComponent(tagLine)}`;
  const url = `${SUMMONER_API}/v3/${region}/summoners?riot_id=${riotId}&hl=fr_FR`;
  const key = `search:${region}:${gameName}:${tagLine}`.toLowerCase();
  const raw = await withCache(key, CACHE_TTL.search, () => opggFetch(url));
  if (!raw) throw new OpggError('Riot ID introuvable sur OP.GG.', 404);

  // La recherche renvoie { data: [ {...infos du compte directement...} ] },
  // pas d'imbrication sous une clé "summoner".
  const summoner = extractList(raw)[0];
  if (!summoner || !summoner.summoner_id) {
    throw new OpggError('Riot ID introuvable sur OP.GG.', 404);
  }
  return summoner;
}

async function getGames(summonerId, region, limit = 20) {
  const url = `${SUMMONER_API}/${region}/summoners/${summonerId}/games?limit=${limit}&game_type=total&hl=fr_FR&ended_at=`;
  const raw = await opggFetch(url);
  return extractList(raw);
}

// ---------------------------------------------------------------------
// Mode debug : renvoie les payloads bruts d'OP.GG sans aucune extraction,
// pour diagnostiquer un décalage entre la structure supposée (ci-dessus)
// et la structure réelle renvoyée par op.gg. Utilisé par
// `/api/stats?...&debug=1`. À retirer une fois l'intégration stabilisée.
// ---------------------------------------------------------------------

export async function debugFetchRaw(riotId, platform) {
  const [gameName, tagLine] = splitRiotId(riotId);
  const region = normalizeRegion(platform);
  const riotIdParam = `${encodeURIComponent(gameName)}%23${encodeURIComponent(tagLine)}`;
  const searchUrl = `${SUMMONER_API}/v3/${region}/summoners?riot_id=${riotIdParam}&hl=fr_FR`;

  const searchRaw = await opggFetch(searchUrl);
  const summoner = extractList(searchRaw)[0];
  const summonerId = summoner?.summoner_id;

  let gamesRaw = null;
  let gamesError = null;

  if (summonerId) {
    const gamesUrl = `${SUMMONER_API}/${region}/summoners/${summonerId}/games?limit=5&game_type=total&hl=fr_FR&ended_at=`;
    gamesRaw = await opggFetch(gamesUrl).catch((e) => {
      gamesError = e.message;
      return null;
    });
  }

  return {
    urls: { searchUrl, summonerId: summonerId || null },
    search: searchRaw,
    detectedSummoner: summoner || null,
    games: gamesRaw,
    gamesError,
  };
}

// ---------------------------------------------------------------------
// Normalisation des données OP.GG vers la forme attendue par l'UI.
// ---------------------------------------------------------------------

function toMillis(ts) {
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

const DIVISION_TO_ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
// Les tiers apex n'ont pas de division au sens classique : le champ
// `division` renvoyé par op.gg pour ces tiers est un artefact à ignorer.
const APEX_TIERS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

// Le rang solo/duo est directement sur l'objet compte renvoyé par la
// recherche (`solo_tier_info`), pas dans un endpoint "summary" séparé.
function extractRank(summoner) {
  const info = summoner.solo_tier_info;
  const tier = info?.tier ? String(info.tier).toUpperCase() : null;
  if (!tier) return null;
  return {
    tier,
    rank: APEX_TIERS.includes(tier) ? null : DIVISION_TO_ROMAN[info.division] || null,
    leaguePoints: info.lp ?? 0,
  };
}

const QUEUE_NAMES = {
  400: 'Normale (Draft)',
  420: 'Solo/Duo classée',
  430: 'Normale (Blind)',
  440: 'Flex classée',
  450: 'ARAM',
  700: 'Clash',
};

function getQueueName(queueId) {
  return QUEUE_NAMES[queueId] || 'Autre file';
}

async function summarizeGame(game, summonerId, version) {
  // Chaque game liste les 10 participants ; il faut retrouver le nôtre par
  // son summoner_id pour lire ses stats individuelles.
  const participant = game.participants.find((p) => p.summoner?.summoner_id === summonerId);
  const stats = participant?.stats || {};
  const win = String(stats.result || '').toUpperCase() === 'WIN';
  const championId = participant?.champion_id ?? null;
  const championName = await getChampionNameById(championId);

  return {
    matchId: String(game.id),
    win,
    championName,
    championIconUrl: championName ? getChampionIconUrl(version, championName) : null,
    kills: stats.kill ?? 0,
    deaths: stats.death ?? 0,
    assists: stats.assist ?? 0,
    cs: (stats.minion_kill ?? 0) + (stats.neutral_minion_kill ?? 0),
    gameCreation: toMillis(game.created_at),
    gameDuration: game.game_length_second ?? 0,
    queueName: getQueueName(game.queue_id),
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

function isToday(millis) {
  const d = new Date(millis);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  );
}

// ---------------------------------------------------------------------
// Point d'entrée principal (mode réel, données OP.GG).
// ---------------------------------------------------------------------

export async function getPlayerStats(riotId, platform) {
  const [gameName, tagLine] = splitRiotId(riotId);
  const region = normalizeRegion(platform);

  const summoner = await searchSummoner(gameName, tagLine, region);

  const [games, version] = await Promise.all([
    getGames(summoner.summoner_id, region, 20).catch(() => []),
    getLatestDdragonVersion(),
  ]);

  const rank = extractRank(summoner);

  const summarizedGames = await Promise.all(games.map((g) => summarizeGame(g, summoner.summoner_id, version)));
  const allSorted = summarizedGames.sort((a, b) => b.gameCreation - a.gameCreation);
  const todayGames = allSorted.filter((m) => isToday(m.gameCreation));

  const wins = todayGames.filter((m) => m.win).length;
  const losses = todayGames.length - wins;
  const streak = computeStreak(allSorted);

  const profileIconUrl = summoner.profile_image_url || (await getProfileIconUrl(summoner.profile_icon_id));

  return {
    riotId: `${gameName}#${tagLine}`,
    platform: region,
    profileIconUrl: profileIconUrl || null,
    summonerLevel: summoner.level ?? null,
    rank,
    today: { wins, losses },
    streak,
    recentMatches: allSorted.slice(0, 5),
    // OP.GG (source publique, sans clé) ne fournit pas d'API de partie en
    // cours équivalente à spectator-v5 de Riot : le badge "EN JEU" n'est
    // donc actif qu'en mode démo. À revoir si op.gg expose un jour un
    // endpoint "live game" exploitable.
    liveGame: null,
    mock: false,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------
// Mode démo (données factices, aucun accès réseau requis vers op.gg).
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
      queueName: 'Solo/Duo classée',
    };
  }).sort((a, b) => b.gameCreation - a.gameCreation);

  const wins = recentMatches.filter((m) => m.win).length;
  const losses = recentMatches.length - wins;
  const streak = computeStreak(recentMatches);

  const inGame = Math.random() > 0.65;
  const liveChampion = pickRandom(MOCK_CHAMPIONS);

  return {
    riotId: `${gameName}#${tagLine}`,
    platform: normalizeRegion(platform),
    profileIconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${randomInt(0, 28)}.png`,
    summonerLevel: randomInt(80, 500),
    rank: {
      tier: pickRandom(MOCK_TIERS),
      rank: pickRandom(['I', 'II', 'III', 'IV']),
      leaguePoints: randomInt(0, 100),
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
