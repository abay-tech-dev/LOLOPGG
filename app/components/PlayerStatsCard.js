// app/components/PlayerStatsCard.js
//
// Composant de présentation pur, partagé entre le dashboard (grand format)
// et l'overlay OBS (format compact, fond transparent). Ne fait aucun appel
// réseau : reçoit les stats déjà résolues en props.

import { getChampionSplashUrl } from '@/lib/riot';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PlayerStatsCard({ stats, compact = false }) {
  const { rank, today, streak, recentMatches, liveGame } = stats;
  const featuredChampion = liveGame?.championName || recentMatches[0]?.championName || null;
  const splashUrl = featuredChampion ? getChampionSplashUrl(featuredChampion) : null;

  return (
    <div
      className={`stat-card${compact ? ' compact' : ''}`}
      style={splashUrl ? { '--splash-url': `url(${splashUrl})` } : undefined}
    >
      {liveGame && (
        <div className="live-badge">
          {liveGame.championIconUrl && (
            <img className="live-champion-icon" src={liveGame.championIconUrl} alt={liveGame.championName} />
          )}
          EN JEU · {liveGame.queueName} · {formatDuration(liveGame.gameLengthSeconds)}
        </div>
      )}

      <div className="player-header">
        <img className="profile-icon" src={stats.profileIconUrl} alt="Icône de profil" />
        <div className="player-identity">
          <p className="player-name">{stats.riotId}</p>
          <span className="player-level">Niveau {stats.summonerLevel}</span>
        </div>
        <div className="rank-badge">
          {rank ? (
            <>
              <div className={`rank-tier rank-${rank.tier}`}>
                {rank.tier} {rank.rank}
              </div>
              <div className="rank-lp">{rank.leaguePoints} LP</div>
            </>
          ) : (
            <div className="rank-tier rank-UNRANKED">Non classé</div>
          )}
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-block">
          <span className="stat-label">Victoires du jour</span>
          <span className="stat-value win">{today.wins}V</span>
        </div>
        <div className="stat-block">
          <span className="stat-label">Défaites du jour</span>
          <span className="stat-value loss">{today.losses}D</span>
        </div>
        <div className="stat-block">
          <span className="stat-label">Série en cours</span>
          <span className={`stat-value ${streak ? (streak.win ? 'win' : 'loss') : ''}`}>
            {streak ? `${streak.count}${streak.win ? 'V' : 'D'}` : '—'}
          </span>
        </div>
      </div>

      {recentMatches.length > 0 && (
        <div className="stat-block">
          <span className="stat-label">Dernières games</span>
          <div className="recent-matches">
            {recentMatches.map((m) => (
              <div
                key={m.matchId}
                className={`match-pip ${m.win ? 'win' : 'loss'}`}
                title={`${m.win ? 'Victoire' : 'Défaite'} · ${m.championName} · ${m.kills}/${m.deaths}/${m.assists} · ${m.cs} CS`}
              >
                <img src={m.championIconUrl} alt={m.championName} />
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.mock && <span className="mock-badge">Mode démo — données factices</span>}
    </div>
  );
}
