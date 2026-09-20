# LoL Stats Live

Stats League of Legends en temps réel pour streamers : rang, LP, victoires/
défaites du jour, série en cours et 5 dernières games. Deux vues du même
moteur de données :

- **Dashboard** (`/`) — le streamer entre son Riot ID et voit ses stats en
  grand format, avec une direction artistique "Hextech" (fond sombre,
  dorures, police Cinzel).
- **Overlay OBS** (`/overlay?riotId=Pseudo%23TAG&platform=euw1`) — mêmes
  données, présentation compacte, fond transparent, pensé pour une Browser
  Source OBS.

## Source de données : uniquement l'API Riot Games

Toute donnée de joueur (rang, LP, historique de matchs, profil) provient
exclusivement de l'**API officielle Riot Games**
(`https://developer.riotgames.com`) — jamais de scraping d'OP.GG, U.GG ou
tout autre site tiers. Les seules sources utilisées :

- **API Riot Games** (`account-v1`, `summoner-v4`, `league-v4`, `match-v5`,
  `spectator-v5`) — nécessite une clé API, appelée uniquement côté serveur.
- **Data Dragon** (`ddragon.leagueoflegends.com`) — CDN public officiel de
  Riot pour les assets (icônes, splash arts), sans clé.

La clé API n'est **jamais exposée au client** : tous les appels Riot
passent par la route serveur `app/api/stats/route.js` (`runtime = 'nodejs'`).

## Obtenir une clé API Riot

1. Créer un compte sur [developer.riotgames.com](https://developer.riotgames.com/)
   et se connecter avec son compte Riot Games.
2. Une **clé de développement** est générée automatiquement sur le dashboard
   — elle expire toutes les 24h, pratique pour développer/tester.
3. Pour un usage réel il faut ensuite demander :
   - une clé **Personal** (projet non commercial, limites plus larges,
     durée illimitée) ;
   - puis une clé **Product** pour la commercialisation (nécessite de
     soumettre l'app à la revue Riot — RSO, description du produit, etc.).

Le code n'a **rien à changer** entre ces paliers : seule la variable
d'environnement `RIOT_API_KEY` change de valeur.

⚠️ **Contrainte de monétisation Riot** : les CGU développeur interdisent de
facturer l'accès brut aux données de jeu ("payer pour voir ses stats"). La
valeur payante de ce produit doit résider dans les fonctionnalités, le
design ou l'hébergement (overlay premium, personnalisation, support), pas
dans l'accès aux stats en tant que tel. Ce MVP ne code aucun paywall, mais
l'architecture (pas de couplage entre "compte utilisateur" et "accès aux
stats") est pensée pour ça.

## Mode démo (sans clé API)

Si `RIOT_API_KEY` est absente, ou si `?mock=1` est ajouté à l'URL, l'app
sert des données factices réalistes (mêmes formes de données, vraies icônes
Data Dragon). Permet de développer/présenter le produit sans clé.

```bash
npm run dev
# puis :
# http://localhost:3000/?mock=1
# http://localhost:3000/overlay?riotId=Faker%23KR1&mock=1
```

## Développement local

```bash
npm install
cp .env.example .env.local   # puis renseigner RIOT_API_KEY
npm run dev
```

- `http://localhost:3000/` — dashboard.
- `http://localhost:3000/overlay?riotId=Pseudo%23TAG&platform=euw1` —
  overlay (fond transparent), à ajouter comme Browser Source dans OBS.
  Paramètre optionnel `refresh` (en secondes) pour changer la fréquence de
  rafraîchissement (par défaut 18s).

## Déploiement sur Vercel

```bash
npm i -g vercel   # si besoin
vercel deploy
```

Puis dans les **Settings > Environment Variables** du projet Vercel,
ajouter :

- `RIOT_API_KEY` = votre clé Riot (dev/personal/product selon le stade du
  projet).

Sans cette variable, l'app déployée bascule automatiquement en mode démo.

## Limites connues du MVP

- **Pas de base de données** : le Riot ID est saisi à chaque visite, pas de
  compte utilisateur. La structure (route API isolée, pas d'état côté
  client persistant) permet d'ajouter facilement des comptes plus tard
  (Postgres via Vercel Postgres/Neon, ou Supabase).
- **Cache en mémoire** (`lib/riot.js`, fonctions `cacheGet`/`cacheSet`) pour
  rester sous les rate-limits Riot (clé dev : 20 req/s, 100 req/2min). Ce
  cache est perdu à chaque cold start Vercel et n'est pas partagé entre
  instances — pour une prod multi-clients, le remplacer par
  [Upstash Redis](https://upstash.com/) (tier gratuit) : le remplacement
  est isolé à ces deux fonctions.

## Build

```bash
npm run build
```
