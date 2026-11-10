# CLAUDE.md

## Design et inspiration (à consulter pour chaque maquette ou app)

Avant de concevoir une maquette, une page ou une application, regarder ces sources pour trouver des idées, puis faire mieux et adapter au domaine du projet. Ne jamais copier un site tel quel.

| Source | Lien | À quoi elle sert |
|---|---|---|
| Inspora | https://www.inspora.design | Galerie mise à jour toutes les heures (web, branding, motion, 3D). À regarder à chaque fois. |
| Lucian UX/UI | https://lucianlabs.dev/uxui-prompt | Boutons, toggles, toasts, loaders, animations au scroll. Licence MIT : on peut reprendre le code en gardant la ligne de licence. Skill installé dans `.claude/skills/lucian-uxui` (équivalent de `npx skills add Seokwoooo/lucian-uxui`). |
| Jiro | https://jiro.build/components | Environ 1 250 composants et 120 templates : boutons animés, fonds Aurora, en-têtes par métier. |
| MotionSites | https://motionsites.org | Environ 700 prompts de sites animés et 3D. Modèle direct pour Darkroom. |
| OnePromptDesign | https://onepromptdesign.com | Prompts d'images pour les visuels de maquettes (héros, fonds, mockups). |
| 21st.dev | https://21st.dev | Composants d'interface. Vérifier la licence de chacun avant de reprendre du code. |
| Aura | https://aura.build | Galerie et générateur de designs. |
| Superdesign | https://superdesign.dev | Galerie et générateur de designs. |
| Awwwards | https://www.awwwards.com | Sites primés, pour viser le niveau « agence ». |

### Règles

- Le propriétaire aime les animations au défilement (scroll). En prévoir dans chaque maquette, en respectant `prefers-reduced-motion`, et garder le contenu visible même si l'animation ne se lance pas.
- Pour les animations et micro-interactions, chercher d'abord dans Lucian UX/UI avec le skill `lucian-uxui` (`node .claude/skills/lucian-uxui/scripts/lucian-uxui.mjs search <mots>`), garder les durées et courbes d'origine, et laisser la ligne `Lucian UX/UI Prompt #ID · MIT License` dans le code.
- Vérifier la licence avant de reprendre le code d'un autre site.
- Si un site n'est pas joignable depuis la session (réseau limité), le dire et continuer avec les autres sources.

### Projet en cours : QG Artisans

Application de gestion d'une micro-entreprise de visibilité Google pour artisans (Haguenau / Schweighouse-sur-Moder) : 16 agents IA, pilote automatique, prospection, clients, sites vitrines, devis, facturation. Publiée comme artifact : https://claude.ai/artifact/GGKEmz8aLxZ9tddWkF8cAj
