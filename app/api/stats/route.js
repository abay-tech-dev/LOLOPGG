// app/api/stats/route.js
//
// Endpoint interne consommé par le dashboard (/) et l'overlay OBS
// (/overlay). Toute la logique de récupération des données OP.GG tourne
// ici, côté serveur (pas de clé API, pas de compte développeur Riot).

import { NextResponse } from 'next/server';
import { getPlayerStats, getMockPlayerStats, OpggError } from '@/lib/opgg';

export const runtime = 'nodejs';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const riotId = searchParams.get('riotId');
  const platform = searchParams.get('platform') || 'euw';
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

  // Mode démo forcé via ?mock=1 (présentation du produit) ou via la
  // variable d'env OPGG_MOCK=1 (dev local sans solliciter op.gg à chaque
  // rechargement).
  const useMock = forceMock || process.env.OPGG_MOCK === '1';

  try {
    const stats = useMock
      ? await getMockPlayerStats(riotId, platform)
      : await getPlayerStats(riotId, platform);
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof OpggError) {
      const status = [400, 404, 403, 429, 502].includes(err.status) ? err.status : 502;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error('[api/stats] erreur inattendue :', err);
    return NextResponse.json({ error: 'Erreur interne du serveur.' }, { status: 500 });
  }
}
