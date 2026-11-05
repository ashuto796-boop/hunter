# Guide utilisateur

## Premiers pas

1. Ouvrez **Historique des tirages** et importez l'historique officiel :
   - *Importer un fichier* : CSV, Excel ou archive ZIP (format FDJ reconnu) ;
   - *Depuis une URL officielle* : uniquement en https et pour un hôte autorisé ;
   - *Saisie manuelle* : pour ajouter le dernier tirage.
   Le rapport d'import liste chaque ligne rejetée avec son motif (date invalide, numéro hors bornes, étoile
   inexistante à cette époque, doublon, conflit…).
2. Pour découvrir l'application sans données réelles, cliquez sur **Charger la démonstration (FICTIVE)**. Un
   bandeau rappelle en permanence que ces tirages sont inventés. Purgez-les avant d'importer des données réelles.
3. Dans **Paramètres**, vérifiez le prix d'une grille (2,50 € par défaut) et sa source.

## Pages

| Page | Utilisation |
|---|---|
| **Accueil** | Règle fondamentale, probabilités exactes des 13 rangs, accès rapides |
| **Tableau de bord** | Indicateurs clés, fréquences, sommes et parité contre la théorie, tests globaux corrigés. Filtres : fenêtre (20/50/100/500), dates, époque |
| **Historique** | Import, saisie, suppression, purge, sources (empreinte SHA-256) |
| **Statistiques des numéros / étoiles** | Onglets *Fréquences* (histogramme, tableau triable : sorties, écart, z, q-valeur BH, rangs par fenêtre, retard), *Chauds/froids*, *Retards* (distribution des intervalles vs loi géométrique), *Courbes* (cumul de 1 à 5 valeurs). Export CSV/Excel/JSON/PDF |
| **Analyse des combinaisons** | Paires, triplets, carte thermique des cooccurrences, paires d'étoiles ; parité, sommes, dizaines, écarts, consécutifs, répétitions ; entropie |
| **Générateur** | Nombre de grilles (préréglages 1 à 10 000), stratégie A–F, mode reproductible (graine), contraintes. Résultats : probabilité de jackpot, coût, scores, liste de grilles (copier, sauvegarder, regénérer, supprimer, comparer la sélection), export, matrice de similarité |
| **Optimiseur** | Nombre de grilles ou budget, niveau (rapide/standard/approfondi), pondérations, contraintes. *Comparer les méthodes* (tableau + convergence) ou *Portefeuilles candidats* (tableau, scores, répartition des étoiles). Sélectionnez puis sauvegardez |
| **Laboratoire de stratégies** | Curseurs de pondération avec effet **en direct** ; comparaison jusqu'à 5 stratégies ; configurations enregistrées ; recherche automatique de paramètres |
| **Comparateur** | Deux portefeuilles : critère par critère, portefeuille dominant pour chacun, distribution des gains simulés |
| **Mes grilles** | Portefeuilles enregistrés, renommage, ajout/suppression de grilles, exports, **analyse exacte** des rangs secondaires |
| **Vérification** | Tirage importé ou saisi + portefeuille → rang par grille, bons numéros mis en évidence, gains si le barème est importé, historique |
| **Simulateur** | Portefeuilles + références aléatoires, 1 000 à 5 000 000 tirages, graine, hypothèses de gains. Barre de progression, annulation, simulations enregistrées et exportables |
| **Laboratoire IA** | Choix des modèles, part d'entraînement chronologique, graine, période. Résultats hors échantillon avec IC et conclusion automatique |
| **Jackpot** | Montant, nombre de grilles, partage (grilles des autres joueurs ou λ), multiplicateur de popularité, gains secondaires supposés ou historiques. Espérances séparées, jackpot d'équilibre, sensibilité |
| **Budget** | Budget par tirage/semaine/mois ou nombre de grilles ou portefeuille ; durée ; prix ; taux de retour supposé. Coûts, probabilités, courbe coût/probabilité, scénarios |
| **Mode recherche** | Hypothèse, période, simulations, α, graine ; exploratoire ou confirmatoire ; reproduction et export PDF |
| **Audit** | Lance les 8 vérifications et produit un rapport de conformité exportable |
| **Paramètres** | Prix, source, tirages/semaine, URL officielle, clé d'API, limites du serveur |

## Lire les résultats correctement

- « Diversité », « couverture », « objectif » : mesures de **structure** du portefeuille, pas des chances de gain.
- « Indice de motif » : heuristique, pas une popularité mesurée.
- « Chaud », « froid », « retard » : descriptions du passé.
- Un test « H0 rejetée » sur une période ne démontre pas une capacité prédictive.
- Les montants affichés proviennent du barème importé ou de vos hypothèses, jamais d'une estimation inventée.

## Tâches longues

Optimisations, simulations, analyses exactes, expériences et audits s'exécutent en arrière-plan : la barre de
progression s'affiche, le bouton **Annuler** interrompt le calcul, et vous pouvez continuer à utiliser les autres
pages. Deux calculs simultanés au plus par défaut (`EM_MAX_CONCURRENT_JOBS`).

## Exports

CSV (séparateur `;`, UTF-8 avec BOM pour Excel), Excel, JSON et PDF. Les rapports PDF contiennent la date, les
paramètres, les grilles, les statistiques principales, le coût, les probabilités, les hypothèses et les limites
méthodologiques.
