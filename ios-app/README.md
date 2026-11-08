# AURUM pour iPhone

L'app iPhone ouvre AURUM en plein écran, comme une vraie app : icône, écran de lancement,
retour haptique (Taptic Engine), liens externes dans Safari, écran hors-ligne. L'interface et
l'IA vivent sur le site : chaque amélioration du site arrive dans l'app sans la recompiler.

Pas besoin de Mac : l'app est compilée dans le cloud d'Expo (EAS) puis envoyée sur TestFlight.

## Ce qu'il faut

- Un compte **Apple Developer** (99 $/an) : app « Apple Developer » sur iPhone → Compte → S'inscrire.
  La validation par Apple peut prendre jusqu'à 48 h.
- Un compte **Expo** gratuit : https://expo.dev/signup

## Première compilation (une seule fois, environ 10 minutes)

Apple demande une première connexion « à la main » pour créer le certificat de l'app.
Il faut un terminal : un ordinateur (Windows, Mac ou Linux avec Node 22), ou **GitHub Codespaces**
dans le navigateur (page du dépôt → Code → Codespaces → Create codespace on main).

```bash
cd ios-app
npm install
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

Réponses aux questions :

| Question | Réponse |
| --- | --- |
| Create an EAS project? | Yes |
| Log in to your Apple account? | Yes (identifiant Apple + code de validation reçu sur l'iPhone) |
| Generate a new Apple Distribution Certificate? | Yes |
| Generate a new Apple Provisioning Profile? | Yes |
| Push Notifications setup? | No |
| Generate a new App Store Connect API Key? | Yes |

Puis enregistrer l'identifiant du projet Expo dans le dépôt :

```bash
git add app.json && git commit -m "AURUM iPhone : projet EAS" && git push
```

La compilation dure 15 à 30 minutes dans le cloud d'Expo, puis l'app part sur TestFlight.

## Installer sur l'iPhone

1. App Store Connect (appstoreconnect.apple.com) → AURUM → **TestFlight** → Test interne → ajoute-toi comme testeur.
2. Installe l'app **TestFlight** sur l'iPhone, ouvre l'invitation : AURUM s'installe.

## Les fois suivantes

Les changements du site arrivent tout seuls dans l'app. Pour une nouvelle version de l'app
elle-même (icône, nom, fonction native) : ajoute le secret de dépôt `EXPO_TOKEN`
(expo.dev → Account settings → Access tokens), puis GitHub → Actions → « AURUM app iPhone »
→ Run workflow. La compilation et l'envoi sur TestFlight se font seuls.

## Développement

- `npm run typecheck` : vérification TypeScript
- `npx expo export --platform ios` : vérifie que le code se compile pour iOS
- Le site appelé par l'app : `SITE` dans `App.tsx`. Il sait qu'il tourne dans l'app via
  `window.AURUM_NATIVE`, et demande un retour haptique avec
  `window.ReactNativeWebView.postMessage('{"type":"haptic","style":"success"}')`.
