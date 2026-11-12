# Mémoire du projet

> Maintenue par l'agent. Faits vérifiés seulement. Viser 30–60 lignes ; remplacer l'état au lieu d'empiler.

## Identité et objectif
- **But :** site communautaire du groupe d'allemand de Stéphane : planning (page d'accueil, type tableau d'affichage, export vers agenda perso en .ics), stories (posts des membres + story « Aujourd'hui » générée depuis le calendrier), bons plans, infos utiles, liens, ressources.
- **Utilisateurs :** membres du groupe (compte e-mail + mot de passe) ; Stéphane est modérateur (table `admins`).
- **Critères de réussite :** les membres consultent le planning et publient ; chacun modifie ses propres publications ; le modérateur peut tout modifier. Taille du groupe et échéance : non connues.

## État actuel
- **Fonctionnel :** site en ligne sur Vercel (Hobby) avec Supabase (gratuit) — d'après le suivi du projet, non revérifié dans ce dépôt.
- **Code (branche `main`) :** `index.html`, `app.js` (application, JS sans framework ni build), `backend.js` (connexion Supabase via `@supabase/supabase-js@2.45.4` en CDN), `api/config.js`, `api/import.js` (import d'événements par IA : Claude si `ANTHROPIC_API_KEY`, sinon Gemini si `GEMINI_API_KEY`), `api/_supabase.js`, `supabase/installation.sql` (schéma `docs`/`admins`, règles RLS, contenu de départ).
- **En cours :** branche `claude/project-thread-m47cpj` (PR #1) : `api/news.js`, story Nachrichten lue depuis le flux RSS nachrichtenleicht.de (cache 1 h, document Supabase en secours). URL du flux non vérifiée.
- **Dernière vérification :** 2026-11-12 — lecture du dépôt (`git ls-tree`, `package.json`, `vercel.json`, `api/import.js`). Aucune commande de test, lint ou build n'existe.

## Priorités
1. Vérifier `/api/news` après déploiement de la PR #1 — URL RSS jamais testée (réseau bloqué pendant le développement) — réponse JSON avec des titres récents.
2. Tester avec quelques membres (inscription, publication, modification de ses propres posts) — étape prévue après la v1 — retours des membres.
3. Décider d'un minimum de vérification automatique (ex. `node --check` sur les fichiers JS) — aucun test n'existe — voir `automatismes/PLAN-AUTOMATISMES.md`.

## Décisions structurantes
- 2026-10-28 — hébergement gratuit Vercel Hobby + Supabase — Supabase gratuit se met en pause après 7 jours sans visite (bouton Restore).
- 2026-10-29 — « Confirm email » désactivé dans Supabase — l'envoi d'e-mails gratuit est très limité.
- 2026-11-01 — import IA gratuit et intégré : Gemini par défaut, Claude si clé payante, copier-coller en secours.

## Risques et inconnues
- Noms des modèles Gemini (`gemini-3.8-flash`, repli `gemini-3.5-flash-lite`) — import cassé s'ils changent — tester l'import après chaque changement côté Google.
- Pause Supabase après 7 jours d'inactivité — site vide pour les membres — visiter régulièrement ou relancer.
- Règle « chacun modifie ses posts » : appliquée côté base par les règles RLS de `docs` (`author = auth.uid()` ou `is_admin()`, vérifié dans `installation.sql`) — non testée en conditions réelles avec plusieurs membres.

## Références
- Installation — `README.md` — 2026-11-12 — mise en ligne Supabase + Vercel pas à pas.
- Schéma et règles — `supabase/installation.sql` — 2026-11-12 — tables, RLS, contenu initial.

## Mise à jour
- Mise à jour : 2026-11-12
- Modifications depuis la précédente : création à partir du dépôt et du suivi du projet.
