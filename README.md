# Groupe d'allemand

Le site du groupe : planning, stories, bons plans, infos utiles, liens et ressources.
Hébergement gratuit : **Vercel** (le site) + **Supabase** (les données et les comptes des membres).

## Mise en ligne

### 1. Supabase (la base de données)
1. Sur [supabase.com](https://supabase.com), connectez-vous avec GitHub, puis **New project**. Nom : `groupe-allemand`, région : *Central EU (Frankfurt)*. Notez le mot de passe proposé.
2. Menu **SQL Editor** > **New query**. Collez tout le contenu de [`supabase/installation.sql`](supabase/installation.sql).
   Remplacez `VOTRE_EMAIL@exemple.fr` par l'e-mail avec lequel vous vous connecterez au site (vous serez modérateur), puis cliquez sur **Run**.
3. Menu **Authentication** > **Sign In / Providers** > **Email** : désactivez **Confirm email**, puis **Save**.
   (Sans cela, les membres devraient confirmer par e-mail, et l'envoi d'e-mails gratuit de Supabase est très limité.)
4. Menu **Project Settings** > **API** (ou **Data API** et **API Keys**) : copiez la **Project URL** et la clé **anon public**.

### 2. Vercel (le site)
1. Sur [vercel.com](https://vercel.com), connectez-vous avec GitHub (formule **Hobby**, gratuite).
2. **Add New** > **Project** > importez le dépôt `groupe-allemand`.
3. Avant **Deploy**, ouvrez **Environment Variables** et ajoutez :
   - `SUPABASE_URL` = la Project URL
   - `SUPABASE_ANON_KEY` = la clé anon public
   - *(facultatif, payant)* `ANTHROPIC_API_KEY` = une clé de [console.anthropic.com](https://console.anthropic.com) pour l'import automatique d'événements. Sans cette clé, le bouton d'import affiche simplement qu'il n'est pas activé.
4. **Deploy**. Le lien du site (`https://groupe-allemand-….vercel.app`) est à partager aux membres.

## Bon à savoir
- Chaque membre crée son compte avec son e-mail et un mot de passe, puis remplit son profil.
- Chacun modifie et supprime ses propres publications ; le modérateur peut tout modifier.
- Supabase gratuit met le projet en pause après 7 jours sans visite : un clic sur **Restore** dans Supabase le relance.
- Le contenu de la version Claude (bons plans, infos, liens, ressources, festival Augenblick) est déjà inclus dans `installation.sql`.

## Fichiers
- `index.html`, `app.js` : l'application.
- `backend.js` : la connexion à Supabase (données, comptes, fichiers).
- `api/config.js`, `api/import.js` : petites fonctions Vercel (réglages, import par IA).
- `supabase/installation.sql` : création de la base et contenu de départ.
