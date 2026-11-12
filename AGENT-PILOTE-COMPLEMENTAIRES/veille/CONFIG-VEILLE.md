# Configuration de veille technique

> À remplir au démarrage. Cette configuration décrit quoi vérifier, pas une veille continue par elle-même. Aucun scheduler n'est configuré : veille à la demande.

## Périmètre
- **Projet / objectif :** site communautaire du groupe d'allemand (planning, stories, bons plans, ressources).
- **Technologies et versions déclarées :** HTML/CSS/JS sans framework ni build ; `@supabase/supabase-js@2.45.4` (CDN jsDelivr, dans `index.html`) ; fonctions serverless Node sur Vercel (modules ES, `vercel.json` : `maxDuration` 60 s pour `api/import.js`). Version de Node non fixée dans le dépôt.
- **Services externes / API :** Supabase (base Postgres, Auth e-mail, Storage, Realtime) ; API Anthropic Messages (`claude-sonnet-5-5` par défaut, optionnelle et payante) ; API Google Gemini (`gemini-3.8-flash`, repli `gemini-3.5-flash-lite`) ; flux RSS nachrichtenleicht.de (PR #1, non fusionnée).
- **Environnements ciblés :** production uniquement (Vercel Hobby + Supabase gratuit). Pas d'environnement de test.

## Sources prioritaires
| Sujet | Source primaire officielle | À vérifier |
|---|---|---|
| Runtime | https://vercel.com/docs/functions/runtimes/node-js | version Node par défaut, fin de support |
| Base / auth | https://supabase.com/changelog | changements Auth, RLS, limites et pause du plan gratuit |
| Client JS | https://github.com/supabase/supabase-js/releases | versions 2.x, failles, dépréciations |
| API Gemini | https://ai.google.dev/gemini-api/docs/models | noms de modèles, quota gratuit, retraits |
| API Claude | https://docs.claude.com/en/docs/about-claude/models | identifiants de modèles, retraits |
| Hébergement | https://vercel.com/docs/plans/hobby | limites du plan gratuit |
| Flux d'actualités | https://www.nachrichtenleicht.de | URL et format du flux RSS |

## Déclencheurs de vérification
- Avant d'utiliser une API, option ou fonction dont l'existence/version n'est pas établie.
- Avant une mise à niveau, migration, déploiement ou modification de dépendance.
- Lorsqu'un bug peut provenir d'une version, d'une dépréciation ou d'un changement externe (ex. l'import IA ou la story Nachrichten cesse de fonctionner).
- À la demande de l'utilisateur (« vérifie les dernières nouveautés »).
- À une cadence planifiée uniquement si un scheduler/agent de fond est réellement configuré.

## Cadence suggérée (à adapter)
- **À la demande / avant changement risqué :** documentation officielle et notes de version ciblées.
- **Mensuelle (si un mécanisme est mis en place) :** modèles Gemini/Claude encore disponibles, limites des plans gratuits Supabase et Vercel.
- **Avant une modification de `installation.sql` :** documentation Supabase sur RLS et Auth.

## Règles de qualité
1. Prioriser documentation officielle, changelog, advisories et source primaire.
2. Vérifier que la version et le produit correspondent au projet.
3. Enregistrer la date de consultation, la version concernée, l'URL et l'impact.
4. Distinguer **confirmé**, **probable** et **à vérifier**.
5. Ne pas mettre à jour une dépendance automatiquement sans autorisation et tests.
6. Ne signaler que les changements qui affectent le projet ou une décision prochaine.
7. Si aucune source récente n'est accessible, le dire : ne pas prétendre que la veille a été faite.

## Seuil de signalement
- **Bloquant :** vulnérabilité exploitable, incompatibilité qui empêche le fonctionnement, API supprimée.
- **Important :** migration requise prochainement, version non supportée, changement susceptible de casser une fonction.
- **À surveiller :** changement futur sans impact immédiat.
- **Optionnel :** amélioration sans besoin concret.
