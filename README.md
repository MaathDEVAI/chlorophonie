# Chlorophonie — l’herbier sonore

> Chaque graine est une note. Chaque jardin, une partition.

Chlorophonie est un jardin musical génératif qui vit dans le navigateur, sans
serveur, sans compte, sans dépendance. On y sème cinq familles de plantes
procédurales ; chaque plante mûre devient une voix d’un orchestre ambient qui
suit l’heure du jardin (l’aube est lydienne, la nuit éolienne). Les
pollinisateurs croisent les génomes et laissent tomber des graines hybrides ;
chaque espèce inédite est décrite d’une planche dans l’Herbier.

## Jouer en ligne

**https://maathdevai.github.io/chlorophonie/** — dépôt : https://github.com/MaathDEVAI/chlorophonie

## Lancer le jardin

```sh
python3 -m http.server 4173
# puis ouvrir http://localhost:4173
```

(N’importe quel serveur statique convient — les modules ES ne se chargent pas
en `file://`.)

### Version « un seul fichier »

```sh
node build.mjs
open dist/chlorophonie.html   # ouvrable d'un double-clic, hors ligne
```

## Jouer

| Geste | Effet |
| --- | --- |
| `1`–`5` puis clic sur la terre | semer une famille sauvage |
| `6`–`9` | semer une graine hybride cueillie |
| `A` + clic/glisser | arrosoir — hâte la croissance |
| `T` + clic | sécateur — taille une plante |
| `P` | invoquer une averse (pluie musicale, pousse accélérée) |
| clic sur une graine qui brille | cueillir un hybride |
| `H` | ouvrir l’Herbier · `M` couper le son · `Échap` fermer |

Le jardin se sauvegarde tout seul dans le navigateur. « Partager » copie un
lien qui contient l’état complet du jardin, encodé dans l’URL.

## Les cinq familles

| Famille | Genre | Rôle musical |
| --- | --- | --- |
| Campanule | *Campanula* | cloches FM — porte la mélodie |
| Roseau | *Arundo* | nappes — tient l’accord |
| Lampyre | *Lucerna* | arpèges — grimpe la gamme, perle par perle |
| Tympan | *Tympanea* | pouls — bat la mesure |
| Ombelle | *Stellaria* | carillons — sème des étincelles, surtout la nuit |

## Sous le capot

- **Zéro dépendance** : vanilla JS (modules ES), Canvas 2D, Web Audio API.
- **Plantes procédurales** : squelettes segmentés déterministes issus d’un
  génome de 10 traits ; croisements, mutations, ~200 espèces classables.
- **Moteur audio** : ordonnanceur à anticipation (68 bpm), harmonie modale
  liée à l’heure, réverbération à réponse impulsionnelle générée, délai
  stéréo croisé, voix synthétisées (FM, soustractif, bruit filtré).
- **Ciel vivant** : cycle jour/nuit interpolé, aurore nocturne qui trace la
  forme d’onde réelle de la sortie audio, étoiles filantes, lucioles, pluie.
- **État** : localStorage + partage par URL (base64url compact), aucun réseau.

## Vérifier

```sh
node --test tests/chlorophonie.test.mjs   # logique pure : PRNG, gammes, génome, sérialisation
node build.mjs       # build de production (fichier unique)
```

Arborescence : `index.html` (coquille), `src/` (10 modules), `tests/`,
`build.mjs`, `dist/` (généré).
