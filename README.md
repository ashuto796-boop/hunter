# Memecoin Hunter - Market Terminal

Professional-grade memecoin trading terminal built with React + TypeScript + Tailwind CSS + Lightweight Charts.

## Features

✨ **Interactive Components**
- Click any ticker to see detailed coin modal
- Click any signal to view signal details
- Click any alert to see full context

📊 **TradingView-style Candlestick Chart**
- Real candlesticks (green for up, red for down)
- Responsive and performant
- Tooltip with OHLCV data

🎨 **Dark Theme Terminal UI**
- Wall Street aesthetic
- Smooth transitions and hover effects
- Fully responsive design

📱 **3 Main Pages**
- Market Dashboard (7 interactive panels)
- Portfolio Tracking (P&L monitoring)
- Alerts & Signals (Real-time notifications)

## AURUM — IA de trading Or (mobile)

Application mobile (PWA) dédiée à l'or : une IA autonome qui analyse XAU/USD et trade seule sur un compte de démonstration alimenté par les prix réels.

URL : https://ashuto796-boop.github.io/hunter/gold/ (sur téléphone : « Ajouter à l'écran d'accueil »)

- **Données** : contrat perpétuel or `XAUUSDT` de Binance Futures (public, sans clé), repli sur `PAXGUSDT`, puis marché simulé si aucun flux n'est joignable.
- **Cerveau** : 7 stratégies spécialistes (balayage de liquidité + cassure de structure, repli de tendance, ouverture de Londres, squeeze, momentum, retour à la moyenne, divergence RSI), pondérées selon le régime de marché, le biais H1/H4, la session et leurs propres résultats dans chaque régime (mémoire contextuelle bayésienne).
- **Radar intermarché** : l'argent (`XAGUSDT`) et le dollar (via `EURUSDT`) en H1 confirment ou freinent chaque décision (±8 % de confiance).
- **Mémoire du trader** : chaque signal de chaque spécialiste, tradé ou non, devient un trade fantôme suivi jusqu'à son stop ou son objectif ; ces leçons (pondérées 0,3 trade réel, les plus récentes comptant plus) ajustent les poids. Le « déjà vu » (situations passées les plus proches) est affiché à titre indicatif : testé sur 6 mois de PAXG réel, il n'améliorait pas les décisions, il ne les influence donc pas.
- **Monte-Carlo** (Labo) : 2 000 futurs de 30 jours tirés des trades simulés (médiane, fourchette 5-95 %, chance de finir positif, risque d'un creux de −10 %).
- **Mode Auto** : l'IA compare plusieurs seuils de confiance sur 70 % de l'historique et vérifie son choix sur les 30 % restants (validation hors échantillon affichée dans le Labo).
- **Risque** : sizing au % du capital, stop structurel, TP partiel à 1R + break-even, stop suiveur, limite de perte journalière, quota de trades, pause après 2 pertes, pas d'entrée autour des news US / FOMC / NFP ni avant le week-end.
- **Entraînement** : au démarrage l'IA rejoue 30 à 180 jours d'historique bougie par bougie (walk-forward, spread inclus) ; à la réouverture elle rejoue les bougies manquées comme un serveur 24/7.

### Serveur 24/7

L'IA tourne aussi sans téléphone : le workflow `.github/workflows/aurum-server.yml` lance `server/main.ts` toutes les 15 minutes sur GitHub Actions. Chaque passage rejoue toutes les bougies clôturées depuis le précédent avec exactement le même moteur que l'app (même résultat qu'un bot jamais arrêté, même si GitHub décale un passage), se ré-entraîne une fois par jour, puis publie `state.json` sur la branche `aurum-data`. L'app lit ce fichier : elle affiche le compte, les trades et les décisions du serveur, et reprend la main toute seule si le serveur ne publie plus.

- **Prix** : les serveurs GitHub sont aux États-Unis, où Binance Futures est bloqué ; le serveur utilise donc PAXG/USDT (1 PAXG = 1 once d'or) via `data-api.binance.vision`, l'API publique de données de marché de Binance, et le dollar (EUR/USDT) pour le radar.
- **Réglages** : `server/config.json` (capital, risque, mode, unité de temps, spread, limites, `retrainHours`).
- **Notifications push (optionnel)** : ajouter le secret de dépôt `NTFY_TOPIC` (app ntfy, gratuite) ou `TELEGRAM_TOKEN` + `TELEGRAM_CHAT_ID` : chaque entrée, chaque sortie, et un bilan du jour après la clôture de New York.
- **Fichiers publiés** sur `aurum-data` : `state.json` (lu par l'app), `stamp.json` (sondé chaque minute par l'app, quelques octets) et `memory.json` (la mémoire complète).
- **Repartir de zéro** : supprimer la branche `aurum-data`.
- **Sur une machine à soi** (VPS, Raspberry Pi…) : `npm run server:loop` tourne en continu et sert l'état sur `http://<machine>:8787/state.json` (à placer derrière HTTPS pour l'app).

Code : `src/gold/` (moteur dans `src/gold/engine/`). GitHub Pages sert la branche `main` telle quelle : après une modification, lancer `npm run build:gold` et committer le dossier `gold/` généré (`npm run dev:gold` pour développer).

## Tremplin — idées de SaaS, prompt Claude et plan de lancement

Application web (PWA) : un sondage sur ta situation, puis trois idées de SaaS adaptées, le prompt complet pour les construire avec Claude et un plan d'action des 30 premiers jours.

URL : https://ashuto796-boop.github.io/hunter/saas/

- **Sondage** : 10 questions (prénom, temps disponible, niveau technique, domaines d'expérience, cible, objectif, délai, budget, réseau, problème vécu).
- **Idées** : catalogue de 36 idées pour le marché français, chacune avec sa tendance (« pourquoi maintenant »), son MVP, son prix et ses canaux d'acquisition. Un score de compatibilité classe les idées selon le profil et évite trois variantes du même thème. « Proposer 3 autres idées » continue dans le classement.
- **Mode Claude (optionnel)** : avec sa propre clé API Anthropic (Réglages), les idées sont inventées sur mesure par `claude-opus-5-5` (sortie structurée). La clé reste dans le navigateur et part directement vers api.anthropic.com ; en cas d'erreur, l'app retombe sur le catalogue.
- **Prompt Claude** : contexte produit, périmètre de la v1, stack adaptée au niveau technique (Next.js, Supabase, Stripe, Vercel), règles de travail et première tâche ; plus un prompt pour la page d'attente.
- **Plan 30 jours** : 4 semaines (valider, construire, premiers utilisateurs, premiers clients) dont les volumes s'adaptent au temps disponible, tâches à cocher, et 4 messages de prospection prêts à envoyer. Export Markdown.
- **Données** : pas de compte ni de serveur, tout est enregistré dans le navigateur (export JSON dans les Réglages).

Code : `src/saas/` (catalogue dans `src/saas/data/catalog.ts`, logique dans `src/saas/engine/`). Comme pour AURUM : après une modification, lancer `npm run build:saas` et committer le dossier `saas/` généré (`npm run dev:saas` pour développer).

## Local Development

```bash
npm install
npm run dev
# Open http://localhost:5173
```

## Build & Deploy

```bash
npm run build
# GitHub Actions will auto-deploy to GitHub Pages
```

## Tech Stack

- **React 18** + **TypeScript**
- **Tailwind CSS** for styling
- **Lightweight Charts** for professional charting
- **Zustand** for state management
- **Vite** for build tool

## Deployment

Auto-deploys to GitHub Pages on every push to `main`.

URL: https://ashuto796-boop.github.io/hunter/
