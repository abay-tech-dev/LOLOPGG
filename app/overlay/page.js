'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PlayerStatsCard from '../components/PlayerStatsCard';

const DEFAULT_REFRESH_MS = 18000;

function OverlayContent() {
  const searchParams = useSearchParams();
  const riotId = searchParams.get('riotId');
  const platform = searchParams.get('platform') || 'euw';
  const forceMock = searchParams.get('mock') === '1';

  const refreshSeconds = Number(searchParams.get('refresh'));
  const refreshMs =
    Number.isFinite(refreshSeconds) && refreshSeconds > 0 ? refreshSeconds * 1000 : DEFAULT_REFRESH_MS;

  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  // Fond transparent réel pour la capture OBS (Browser Source) : le fond
  // Hextech du dashboard reste réservé à la route "/".
  useEffect(() => {
    document.body.classList.add('overlay-mode');
    return () => document.body.classList.remove('overlay-mode');
  }, []);

  const fetchStats = useCallback(async () => {
    if (!riotId) return;
    try {
      const params = new URLSearchParams({ riotId, platform });
      if (forceMock) params.set('mock', '1');
      const res = await fetch(`/api/stats?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Erreur inconnue.');
        return;
      }
      setStats(data);
      setError(null);
    } catch {
      setError('Connexion au serveur impossible.');
    }
  }, [riotId, platform, forceMock]);

  useEffect(() => {
    if (!riotId) return undefined;
    fetchStats();
    intervalRef.current = setInterval(fetchStats, refreshMs);
    return () => clearInterval(intervalRef.current);
  }, [riotId, refreshMs, fetchStats]);

  if (!riotId) {
    return (
      <div className="overlay-root">
        <div className="overlay-error">
          Ajoutez ?riotId=Pseudo%23TAG&amp;platform=euw1 à l&apos;URL de cette Browser Source.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="overlay-root">
        <div className="overlay-error">{error}</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="overlay-root">
        <div className="overlay-loading">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="overlay-root">
      <PlayerStatsCard stats={stats} compact />
    </div>
  );
}

export default function OverlayPage() {
  return (
    <Suspense fallback={null}>
      <OverlayContent />
    </Suspense>
  );
}
