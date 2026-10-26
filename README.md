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
- **Cerveau** : 7 stratégies spécialistes (balayage de liquidité + cassure de structure, repli de tendance, ouverture de Londres, squeeze, momentum, retour à la moyenne, divergence RSI), pondérées selon le régime de marché, le biais H1/H4, la session et leurs propres résultats (apprentissage bayésien).
- **Risque** : sizing au % du capital, stop structurel, TP partiel à 1R + break-even, stop suiveur, limite de perte journalière, quota de trades, pause après 2 pertes, pas d'entrée autour des news US / FOMC / NFP ni avant le week-end.
- **Entraînement** : au démarrage l'IA rejoue 30 à 180 jours d'historique bougie par bougie (walk-forward, spread inclus) ; à la réouverture elle rejoue les bougies manquées comme un serveur 24/7.

Code : `src/gold/` (moteur dans `src/gold/engine/`), page d'entrée `gold/index.html`.

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
