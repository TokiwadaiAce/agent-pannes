import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifierChiffres, extraireNombres, nombresAutorises } from '../src/controle.js';

// Données telles qu'envoyées au modèle pour une machine.
const DONNEES = {
  machine: 'M03 Ébarbeuse 1',
  ligne: 'Ligne 1',
  periode: { debut: '2026-03-01', fin: '2026-03-31' },
  nb_interventions: 12,
  temps_arret_total_min: 1410,
  part_du_temps_arret_total_pct: 22.5,
  rang_top3: 2,
  seuil_repetition: 3,
  par_categorie: [
    { categorie: 'mécanique', nb_interventions: 7, minutes: 980 },
    { categorie: 'électrique', nb_interventions: 5, minutes: 430 },
  ],
};
const IDS = ['M03 Ébarbeuse 1', 'M03', 'Ligne 1'];

test('nombres autorisés : valeurs numériques et morceaux de dates, rien d\'autre', () => {
  const a = nombresAutorises(DONNEES);
  for (const n of [12, 1410, 22.5, 2, 3, 7, 980, 5, 430, 2026, 1, 31]) assert.ok(a.has(n), `${n} devrait être autorisé`);
  assert.equal(a.has(4), false);
  // Les chiffres contenus dans les noms (« M07 Presse 3 ») ne sont pas des données.
  assert.deepEqual([...nombresAutorises({ machine: 'M07 Presse 3', ligne: 'Ligne 3' })], []);
});

test('extraction : formats français, décimales, milliers', () => {
  assert.deepEqual(extraireNombres('1 410 min, soit 22,5 % ; 7 pannes'), ['1 410', '22,5', '7']);
  assert.deepEqual(extraireNombres('1 410 et 1 410 et 22.5'), ['1 410', '1 410', '22.5']);
  assert.deepEqual(extraireNombres('fin de phrase 12.'), ['12']);
});

test('extraction : les identifiants de machine et de ligne sont ignorés', () => {
  const texte = 'La M03 Ébarbeuse 1 (ligne 1) cumule 12 interventions ; la M03 reste en tête.';
  assert.deepEqual(extraireNombres(texte, IDS), ['12']);
});

test('texte correct : tous les nombres existent', () => {
  const r = verifierChiffres(
    [
      'Du 1er au 31 mars 2026, la M03 Ébarbeuse 1 a connu 12 interventions pour 1 410 min d\'arrêt, '
        + 'soit 22,5 % du total (rang 2). La mécanique domine avec 7 interventions et 980 min.',
      'Étudier l\'origine des 5 pannes électriques (430 min).',
    ],
    DONNEES,
    IDS,
  );
  assert.deepEqual(r, { ok: true, cites: r.cites, inconnus: [] });
  // 1er, 31, 2026, 12, 1 410, 22,5, 2, 7, 980 | 5, 430
  assert.equal(r.cites.length, 11);
});

test('nombre inventé ou calculé par le modèle : détecté', () => {
  // 23,5 h = 1410 / 60 : un calcul fait par le modèle, interdit.
  // 69,5 % = 980 / 1410 : idem. 8 : chiffre inventé.
  const r = verifierChiffres(
    ['12 interventions, soit 23,5 heures. La mécanique pèse 69,5 % ; 8 pannes répétées.'],
    DONNEES,
    IDS,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.inconnus, ['23,5', '69,5', '8']);
});

test('somme faite par le modèle : détectée', () => {
  // 7 + 5 = 12 existe déjà, mais 980 + 430 + 100 = 1510 non.
  const r = verifierChiffres(['Au total 1 510 min.'], DONNEES, IDS);
  assert.deepEqual(r.inconnus, ['1 510']);
});

test('ambiguïté des milliers : « 3 980 » accepté si « 3 » et « 980 » existent séparément', () => {
  assert.equal(verifierChiffres(['au moins 3 980 min'], DONNEES, IDS).ok, true);
  assert.equal(verifierChiffres(['au moins 4 980 min'], DONNEES, IDS).ok, false);
});

test('une valeur arrondie différemment est refusée', () => {
  // 22,5 fourni ; 22 ou 23 sont des arrondis faits par le modèle.
  assert.deepEqual(verifierChiffres(['environ 22 %, presque 23 %'], DONNEES, IDS).inconnus, ['22', '23']);
});

test('nombres en lettres : contrôlés aussi', () => {
  // « sept » (7) et « cinq » (5) existent ; « quatre » et « Huit » non.
  const r = verifierChiffres(['Sept pannes mécaniques, cinq électriques, quatre catégories, Huit au total.'], DONNEES, IDS);
  assert.deepEqual(r.inconnus, ['quatre', 'Huit']);
  // Pas de faux positif sur les articles, « neuf » ou les mots qui contiennent un nombre.
  assert.equal(verifierChiffres(['Un joint neuf, une deuxième fois, des dizaines de sixièmes.'], DONNEES, IDS).ok, true);
});

test('texte sans nombre : accepté', () => {
  assert.deepEqual(verifierChiffres(['Aucune récurrence notable.'], DONNEES, IDS), { ok: true, cites: [], inconnus: [] });
});
