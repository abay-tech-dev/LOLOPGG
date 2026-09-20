'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PlayerStatsCard from './components/PlayerStatsCard';

const PLATFORMS = [
  { value: 'euw1', label: 'Europe de l\'Ouest (EUW)' },
  { value: 'eun1', label: 'Europe Nordique & Est (EUNE)' },
  { value: 'na1', label: 'Amérique du Nord (NA)' },
  { value: 'kr', label: 'Corée (KR)' },
  { value: 'jp1', label: 'Japon (JP)' },
  { value: 'br1', label: 'Brésil (BR)' },
  { value: 'la1', label: 'Amérique Latine Nord (LAN)' },
  { value: 'la2', label: 'Amérique Latine Sud (LAS)' },
  { value: 'oc1', label: 'Océanie (OCE)' },
  { value: 'tr1', label: 'Turquie (TR)' },
  { value: 'ru', label: 'Russie (RU)' },
];

const REFRESH_MS = 18000;

export default function HomePage() {
  const [riotId, setRiotId] = useState('');
  const [platform, setPlatform] = useState('euw1');
  const [submitted, setSubmitted] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);

  // ?mock=1 force le mode démo même si une vraie clé Riot est configurée
  // côté serveur — pratique pour présenter le produit sans consommer de
  // quota API.
  const [forceMock, setForceMock] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setForceMock(params.get('mock') === '1');
  }, []);

  const fetchStats = useCallback(
    async (id, plat) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ riotId: id, platform: plat });
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
        setError('Impossible de contacter le serveur.');
      } finally {
        setLoading(false);
      }
    },
    [forceMock]
  );

  useEffect(() => {
    if (!submitted) return undefined;
    fetchStats(submitted.riotId, submitted.platform);
    intervalRef.current = setInterval(() => {
      fetchStats(submitted.riotId, submitted.platform);
    }, REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [submitted, fetchStats]);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = riotId.trim();
    if (!trimmed.includes('#')) {
      setError('Format attendu : Pseudo#TAG (ex: Faker#KR1)');
      return;
    }
    setError(null);
    setStats(null);
    setSubmitted({ riotId: trimmed, platform });
  }

  return (
    <main className="page">
      <div>
        <h1 className="page-title">LoL Stats Live</h1>
        <p className="page-subtitle">Rang, LP et forme du jour, en temps réel.</p>
      </div>

      <form className="riot-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Pseudo#TAG"
          value={riotId}
          onChange={(e) => setRiotId(e.target.value)}
        />
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-hextech" disabled={loading}>
          {loading ? 'Chargement…' : 'Afficher mes stats'}
        </button>
      </form>

      {error && <p className="error-banner">{error}</p>}
      {loading && !stats && !error && <p className="loading-text">Chargement des stats…</p>}
      {stats && (
        <>
          <PlayerStatsCard stats={stats} />
          <p className="refresh-note">Actualisation automatique toutes les {REFRESH_MS / 1000}s</p>
        </>
      )}
    </main>
  );
}
