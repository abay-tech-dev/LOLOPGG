# LoL Stats Live

Stats League of Legends en temps réel pour streamers : rang, LP, victoires/
défaites du jour, série en cours et 5 dernières games. Deux vues du même
moteur de données :

- **Dashboard** (`/`) — le streamer entre son Riot ID et voit ses stats en
  grand format, avec une direction artistique "Hextech" (fond sombre,
  dorures, police Cinzel).
- **Overlay OBS** (`/overlay?riotId=Pseudo%23TAG&platform=euw`) — mêmes
  données, présentation compacte, fond transparent, pensé pour une Browser
  Source OBS.

## Source de données : fetch direct sur OP.GG

Ce projet ne passe **pas** par l'API officielle Riot Games (pas de clé,
pas d'inscription développeur, pas de rate-limit Riot à gérer). Les stats
sont récupérées en fetchant directement les endpoints JSON internes que le
site **op.gg** appelle lui-même depuis le navigateur pour afficher ses
pages (`lol-api-summoner.op.gg`). Toute la logique vit dans
`lib/opgg.js`, appelée uniquement côté serveur
(`app/api/stats/route.js`, `runtime = 'nodejs'`).

Les icônes de champion/profil restent servies par **Data Dragon**
(`ddragon.leagueoflegends.com`) : c'est un CDN public d'assets, sans clé
et sans inscription — pas l'API de jeu Riot dont on s'écarte ici.

### ⚠️ Points d'attention (à lire avant toute mise en prod)

- **Endpoints non documentés/officiels.** `lib/opgg.js` reverse-engineer
  les appels que le site op.gg fait en interne. Op.gg peut en changer la
  forme, les déplacer ou les bloquer sans préavis — il n'y a aucune
  garantie de stabilité contractuelle, contrairement à une API publique
  versionnée. Tout le mapping des champs JSON est centralisé dans les
  fonctions `extract*` de `lib/opgg.js` : c'est le seul endroit à
  corriger si op.gg change sa structure.
- **Anti-bot / CGU.** op.gg est protégé par une protection anti-bot
  (Cloudflare) qui peut bloquer les requêtes serveur-à-serveur (403/429),
  surtout en cas de trafic élevé ou d'IP suspecte (typiquement les IP des
  datacenters cloud, y compris Vercel). Les CGU d'op.gg n'autorisent pas
  explicitement ce type d'automatisation. C'est un choix assumé pour ce
  projet (éviter la dépendance à l'API Riot), pas une garantie de
  conformité — à évaluer selon ton usage (perso vs commercial, volume de
  trafic).
- **Pas de détection "en partie".** L'API publique d'op.gg utilisée ici ne
  propose pas d'équivalent au spectator-v5 de Riot : le badge "EN JEU" ne
  s'affiche donc qu'en **mode démo**. À revoir si op.gg expose un jour un
  endpoint de partie en cours exploitable, ou en ajoutant l'API Riot
  seulement pour cette fonctionnalité ponctuelle si le besoin devient
  important.
- **"Aujourd'hui" = 20 dernières games.** Il n'y a pas de filtre par date
  côté op.gg pour cet endpoint : le calcul victoires/défaites du jour se
  fait en filtrant les 20 dernières games récupérées. Un streamer qui joue
  plus de 20 games dans sa journée verra un compteur sous-évalué.
- **Structure JSON validée sur un vrai compte** (voir `?debug=1` ci-dessous)
  début 2026 : la recherche par Riot ID renvoie directement les infos de
  rang (`solo_tier_info`), et l'historique de games liste les 10
  participants de chaque partie (il faut retrouver le sien par
  `summoner_id`). Si op.gg change cette structure plus tard, le
  diagnostic `?debug=1` (voir `lib/opgg.js`, `debugFetchRaw`) permet de
  voir la nouvelle forme et d'ajuster les fonctions `extract*` en
  conséquence.

## Mode démo (sans dépendre d'op.gg)

Si `?mock=1` est ajouté à l'URL, ou si la variable d'env `OPGG_MOCK=1` est
définie, l'app sert des données factices réalistes (mêmes formes de
données, vraies icônes Data Dragon). Permet de développer/présenter le
produit sans solliciter op.gg.

```bash
npm run dev
# puis :
# http://localhost:3000/?mock=1
# http://localhost:3000/overlay?riotId=Faker%23KR1&mock=1
```

## Développement local

```bash
npm install
npm run dev
```

- `http://localhost:3000/` — dashboard.
- `http://localhost:3000/overlay?riotId=Pseudo%23TAG&platform=euw` —
  overlay (fond transparent), à ajouter comme Browser Source dans OBS.
  Paramètre optionnel `refresh` (en secondes) pour changer la fréquence de
  rafraîchissement (par défaut 18s).

Régions supportées (paramètre `platform`) : `euw`, `eune`, `na`, `kr`,
`jp`, `br`, `lan`, `las`, `oce`, `tr`, `ru`.

## Déploiement sur Vercel

```bash
npm i -g vercel   # si besoin
vercel deploy
```

Aucune variable d'environnement obligatoire. `OPGG_MOCK=1` peut être
ajoutée dans **Settings > Environment Variables** si tu veux forcer le
mode démo sur un environnement de preview.

## Limites connues du MVP

- **Pas de base de données** : le Riot ID est saisi à chaque visite, pas
  de compte utilisateur. La structure (route API isolée, pas d'état côté
  client persistant) permet d'ajouter facilement des comptes plus tard
  (Postgres via Vercel Postgres/Neon, ou Supabase).
- **Cache en mémoire** (`lib/opgg.js`, fonctions `cacheGet`/`cacheSet`)
  pour limiter la fréquence des requêtes vers op.gg. Ce cache est perdu à
  chaque cold start Vercel et n'est pas partagé entre instances — pour une
  prod multi-clients, le remplacer par [Upstash Redis](https://upstash.com/)
  (tier gratuit) : le remplacement est isolé à ces deux fonctions.
- **Fragilité intrinsèque au scraping** : voir la section "Points
  d'attention" ci-dessus. Si tu commercialises ce produit, prévoir une
  solution de repli (service de scraping tiers géré, ou retour à l'API
  Riot officielle) en cas de blocage prolongé par op.gg.

## Build

```bash
npm run build
```
