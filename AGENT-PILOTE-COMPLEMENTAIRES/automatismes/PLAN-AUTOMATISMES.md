# Plan des automatismes

> Inventaire des automatismes réellement disponibles. Un modèle ou une instruction ne signifie pas qu'un hook est installé.

## État de configuration
- **Environnement :** Claude Code (sessions cloud liées au projet). Déploiement automatique par Vercel à chaque push sur `main` (fonctionnement standard de Vercel, non configuré dans ce dépôt).
- **Hooks disponibles :** aucun dans le dépôt (pas de `.claude/settings.json`, pas de hook Git).
- **Tests / lint :** aucun. `package.json` ne contient ni script ni dépendance ; pas de build. Vérification minimale possible sans installation : `node --check app.js backend.js api/*.js`.
- **Navigateur / E2E :** aucun outil dans le dépôt. Vérification manuelle dans le navigateur sur le site Vercel.
- **Scheduler / agent de fond :** non configuré. Veille à la demande uniquement.
- **Dernière vérification :** 2026-11-12

## Matrice des déclencheurs
| Déclencheur | Action | Condition | Sortie attendue | État |
|---|---|---|---|---|
| Début de session | Lire instructions, mémoire, leçons et statut Git | Fichiers disponibles | Bref état + blocages | Manuel |
| Avant modification | Inspecter fichiers, usages, tests et impacts | Changement non trivial | Plan concis | Manuel |
| Après modification | `node --check` sur les fichiers JS modifiés | Node disponible | Aucune erreur de syntaxe | Manuel |
| Fin de tâche | Vérifier, mettre à jour mémoire si nécessaire, rendre compte | Tâche avec changements | Tests, limites, suite | Manuel |
| Correction utilisateur | Chercher cause, ajouter leçon si durable | Correction ou erreur vérifiée | Leçon courte ou aucune | Manuel |
| Veille planifiée | Contrôler sources configurées | Scheduler réellement actif | Journal daté + alertes pertinentes | Non configuré |

## Règles d'activation
1. Inspecter le projet et détecter les commandes existantes avant d'ajouter un hook.
2. Préférer les outils déjà installés ; ne pas installer de dépendance sans accord si cela modifie le projet.
3. Hooks : petite action, rapide, déterministe, avec sortie compréhensible et gestion d'échec.
4. Ne jamais faire de déploiement, suppression, publication, dépense ou migration irréversible automatiquement. Ici : un push sur `main` déclenche un déploiement Vercel, et `installation.sql` modifie la base Supabase réelle.
5. Éviter les boucles : limite de tentatives, timeout et état de dernière vérification.
6. Exclure caches, builds et fichiers de mémoire du contrôle de changements quand c'est approprié.
7. Tester chaque hook avec une entrée normale, un échec et un cas où l'outil est absent.
8. Documenter le chemin, le déclencheur, les permissions, la commande, le résultat et comment désactiver.

## Checklist de mise en place
- [x] Identifier le runtime et le gestionnaire de paquets. (JavaScript navigateur + fonctions Node sur Vercel, modules ES ; aucun gestionnaire de paquets utilisé.)
- [x] Relever les commandes test/lint/typecheck/build déjà présentes. (Aucune.)
- [ ] Choisir un hook minimal adapté à l'environnement réel.
- [ ] Vérifier JSON/config et syntaxe des scripts.
- [ ] Tester l'exécution manuelle avant l'activation automatique.
- [ ] Tester le comportement en cas d'échec et d'outil absent.
- [ ] Confirmer avec l'utilisateur avant une action à risque ou une nouvelle dépendance.
- [ ] Inscrire les automatismes activés dans la matrice ci-dessus.

## Règle de vérité
Si aucun scheduler n'est actif, écrire « veille à la demande » et non « veille continue ». Si aucun hook n'a été installé, écrire « vérification manuelle » et non « automatique ».
