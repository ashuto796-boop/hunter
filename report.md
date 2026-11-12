# AURUM — test sur données réelles de l'or

Données : Dukascopy XAU/USD (bid + ask, M1 → M15), du 2021-11-12 au 2026-11-11 (115 041 bougies de 15 min). L'IA trade à partir du 2022-01-23, après ses 60 premiers jours d'apprentissage.
Réglages du serveur : capital 10000 $, risque 1 % par trade, 4 trades max par jour, perte max 3 % par jour, réentraînement tous les 5 jours sur 60 jours.
Coûts mesurés sur les vrais prix d'achat et de vente : écart médian 0.40 $ par once, 90e centile 0.71 $.

## Comme en vrai (réentraînement régulier, écart médian)

| Résultat | Trades | Réussite | Gains/pertes | Pire repli | Moyenne | Mois positifs |
|---:|---:|---:|---:|---:|---:|---:|
| −21.4 % (7862 $) | 487 | 44 % | 0.79 | 26.7 % | -0.12R | 34 % |

Pour comparaison, l'or lui-même a fait +116.8 % sur la même période (acheter et garder, sans effet de levier).
Seuil choisi par l'IA à chaque réentraînement : de 53 à 70, médiane 61.

### Année par année

| Année | Résultat | Trades | Total | Pire repli |
|---|---:|---:|---:|---:|
| 2022 | −5.9 % | 67 | -13.6R | 11.3 % |
| 2023 | −5.6 % | 85 | -11.8R | 16.2 % |
| 2024 | −5.1 % | 92 | -13.2R | 21.3 % |
| 2025 | −0.8 % | 146 | -7.0R | 22.3 % |
| 2026 | −5.9 % | 97 | -13.4R | 26.7 % |

### Écart de prix élevé (90e centile)

−27.7 %, 378 trades, gains/pertes 0.65, pire repli 30.7 %.

### Seuil fixe, sans réentraînement

| Seuil | Résultat | Trades | Gains/pertes | Pire repli |
|---:|---:|---:|---:|---:|
| 57 | −24.4 % | 554 | 0.80 | 29.7 % |
| 61 | −15.0 % | 360 | 0.83 | 21.6 % |
| 65 | −10.7 % | 163 | 0.75 | 15.5 % |

### Détail (comme en vrai)

#### Par spécialiste

| | Trades | Réussite | Total | Gains/pertes |
|---|---:|---:|---:|---:|
| sweep | 390 | 44 % | -47.7R | 0.78 |
| squeeze | 46 | 46 % | +0.2R | 1.19 |
| london | 43 | 47 % | -5.2R | 0.67 |
| pullback | 7 | 14 % | -5.3R | 0.11 |
| reversion | 1 | 0 % | -1.0R | 0.00 |

#### Par état du marché

| | Trades | Réussite | Total | Gains/pertes |
|---|---:|---:|---:|---:|
| RANGE | 412 | 43 % | -54.6R | 0.76 |
| SQUEEZE | 37 | 51 % | +5.3R | 1.43 |
| TREND_UP | 21 | 48 % | -0.3R | 0.83 |
| TREND_DOWN | 17 | 29 % | -9.4R | 0.19 |

#### Par session

| | Trades | Réussite | Total | Gains/pertes |
|---|---:|---:|---:|---:|
| LONDRES | 258 | 43 % | -43.4R | 0.71 |
| OVERLAP | 173 | 42 % | -23.5R | 0.76 |
| NEW_YORK | 40 | 48 % | -1.5R | 1.11 |
| ASIE | 16 | 69 % | +9.4R | 2.28 |

#### Par type de sortie

| | Trades | Réussite | Total | Gains/pertes |
|---|---:|---:|---:|---:|
| SL | 259 | 0 % | -259.0R | 0.00 |
| TP2 | 83 | 100 % | +136.8R | ∞ |
| TRAIL | 65 | 100 % | +40.8R | ∞ |
| BE | 55 | 95 % | +23.0R | 5767.79 |
| TEMPS | 17 | 41 % | -2.4R | 0.37 |
| WEEKEND | 8 | 63 % | +1.7R | 2.74 |

### Écart de prix mesuré par session

| Session | Médiane | 90e centile |
|---|---:|---:|
| ASIE | 0.420 $ | 0.765 $ |
| LONDRES | 0.384 $ | 0.640 $ |
| OVERLAP | 0.385 $ | 0.676 $ |
| NEW_YORK | 0.387 $ | 0.672 $ |

Données : 44 fichiers journaliers sur 3132 n'ont pas pu être téléchargés (1.4 %), ce qui laisse quelques jours vides.

Limites : pas de calendrier historique des annonces (Fed, emploi), donc le filtre d'annonces ne joue pas ici ; pas d'humeur de la presse dans le passé ; frais de financement de nuit non comptés (positions de 8 h maximum).
