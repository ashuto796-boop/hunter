# Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Serveur injoignable » dans l'interface | API non démarrée ou mauvais proxy | Lancez `make api` (port 8000) ; en développement, Vite redirige `/api` vers `VITE_API_PROXY` (défaut `http://127.0.0.1:8000`) |
| `npm install` échoue avec « Cannot read properties of null (reading 'edgesOut') » | Bug d'arborist (npm 10) | `.npmrc` active `legacy-peer-deps` ; utilisez `npm ci` avec le `package-lock.json` fourni |
| Import : « Colonnes obligatoires introuvables » | En-têtes non reconnus | Renommez en `date, n1…n5, e1, e2` ou utilisez le format FDJ (`date_de_tirage, boule_1…, etoile_1…`) |
| Import : lignes « étoile hors bornes » | Étoile 10/11 avant mai 2011 ou 12 avant septembre 2016 | Données incohérentes avec les règles de l'époque : vérifiez la source |
| Import : « Impossible de mélanger des données de démonstration fictives et des données réelles » | Le jeu fictif est chargé | *Historique* → *Purger l'historique*, puis importez |
| Import par URL : « Hôte non autorisé » | Liste blanche | Ajoutez l'hôte à `EM_ALLOWED_IMPORT_HOSTS` (https uniquement) |
| Import par URL : « Source inaccessible » | Réseau, proxy, site indisponible | Téléchargez le fichier et importez-le manuellement |
| 429 « Trop de calculs lancés » | Limitation de débit ou file de tâches pleine | Patientez ; ajustez `EM_RATE_LIMIT_PER_MINUTE` / `EM_MAX_CONCURRENT_JOBS` |
| 401 « Clé d'API manquante » | `EM_API_KEY` défini côté serveur | Saisissez la clé dans *Paramètres* → *Accès à l'API* |
| « Calcul trop lourd » (simulation) | Tirages × grilles > `EM_MAX_SIMULATION_WORK` | Réduisez, ou augmentez la limite si la machine le permet |
| « Analyse exacte limitée à 100 grilles » | Coût mémoire/temps | Utilisez le simulateur, ou augmentez `EM_EXACT_PORTFOLIO_MAX_GRIDS` |
| CP-SAT renvoie le statut « repli » | Temps insuffisant pour la recherche | Augmentez le temps maximal (≥ 4 s pour 10–20 grilles) |
| « Contraintes trop restrictives » | Aucune grille admissible trouvée | Assouplissez la somme, la parité ou les exclusions |
| Tâche introuvable après redémarrage | Les tâches en cours sont en mémoire | Relancez ; les résultats terminés (simulations, expériences, audits) sont en base |
| Erreur de migration au démarrage | Base modifiée manuellement ou version incompatible | Sauvegardez la base puis `cd backend && alembic upgrade head` ; en dernier recours, supprimez `backend/data/euromillions.db` |
| `docker compose build` : erreurs de certificat (pip/npm) | Proxy d'entreprise interceptant TLS | Ajoutez le certificat racine au build (par ex. `COPY ca.crt` + `ENV PIP_CERT=…` / `NODE_EXTRA_CA_CERTS=…`) |
| Graphiques vides | Aucun tirage sur la période filtrée | Élargissez la fenêtre ou les dates |
| Windows : `make` absent | — | Utilisez les commandes équivalentes du README (`.venv\Scripts\activate`) |

## Vérifier l'installation

```bash
curl -s http://127.0.0.1:8000/api/health
cd backend && pytest -q          # 132 tests
cd frontend && npm test          # tests Vitest
```

Puis lancez la page **Audit** : les 8 vérifications doivent être conformes. Le test d'uniformité étant
statistique, un échec isolé reste possible (≈ 0,1 %) : relancez l'audit pour confirmer.
