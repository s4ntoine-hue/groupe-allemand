# Journal de veille technique

> Ajouter une entrée uniquement après consultation réelle d'une source. Une entrée ne garantit pas que l'information reste actuelle.

## Vérifications

| Date | Sujet / version | Source consultée | Résultat confirmé | Impact projet | Action / statut |
|---|---|---|---|---|---|
| [AAAA-MM-JJ] | [technologie/version] | [URL officielle] | [résumé factuel] | [aucun/faible/important/bloquant + raison] | [aucune / tâche créée / vérification requise] |

## Points à recontrôler
- Flux RSS nachrichtenleicht.de — URL utilisée par `api/news.js` (PR #1) jamais testée, réseau bloqué pendant le développement — après déploiement de la PR, ouvrir `/api/news` — https://www.nachrichtenleicht.de
- Modèles Gemini `gemini-3.8-flash` / `gemini-3.5-flash-lite` — noms codés dans `api/import.js`, non revérifiés — si l'import IA échoue — https://ai.google.dev/gemini-api/docs/models

[Aucune vérification de veille n'a encore été effectuée : le tableau ci-dessus reste à remplir.]

## Historique des décisions liées à la veille
- [AAAA-MM-JJ] — [décision] — [référence à l'entrée ci-dessus]
