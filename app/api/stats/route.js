// app/api/stats/route.js
//
// Endpoint interne consommé par le dashboard (/) et l'overlay OBS
// (/overlay). Toute la logique Riot API tourne ici, côté serveur : la clé
// RIOT_API_KEY ne transite jamais vers le client.

import { NextResponse } from 'next/server';
import { getPlayerStats, getMockPlayerStats, RiotApiError } from '@/lib/riot';

export const runtime = 'nodejs';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const riotId = searchParams.get('riotId');
  const platform = searchParams.get('platform') || 'euw1';
  const forceMock = searchParams.get('mock') === '1';

  if (!riotId) {
    return NextResponse.json({ error: 'Paramètre riotId manquant.' }, { status: 400 });
  }
  if (!riotId.includes('#')) {
    return NextResponse.json(
      { error: 'Format de Riot ID invalide. Utilisez Pseudo#TAG.' },
      { status: 400 }
    );
  }

  // Mode démo automatique si aucune clé n'est configurée, ou forcé via
  // ?mock=1 (pratique pour développer/présenter sans clé API).
  const useMock = forceMock || !process.env.RIOT_API_KEY;

  try {
    const stats = useMock
      ? await getMockPlayerStats(riotId, platform)
      : await getPlayerStats(riotId, platform);
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof RiotApiError) {
      const status = [404, 429, 403, 400].includes(err.status) ? err.status : 502;
      const messages = {
        400: 'Format de Riot ID invalide. Utilisez Pseudo#TAG.',
        404: 'Riot ID introuvable.',
        403: "Clé API Riot invalide ou expirée.",
        429: 'Limite de requêtes Riot atteinte, réessayez dans quelques secondes.',
      };
      return NextResponse.json(
        { error: messages[status] || "Erreur de l'API Riot." },
        { status }
      );
    }
    console.error('[api/stats] erreur inattendue :', err);
    return NextResponse.json({ error: 'Erreur interne du serveur.' }, { status: 500 });
  }
}
