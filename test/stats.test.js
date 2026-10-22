import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerStats, pourcentage, A_CLASSER } from '../src/stats.js';

const MACHINES = [
  { ligne: 'L1', machine: 'A' },
  { ligne: 'L1', machine: 'B' },
  { ligne: 'L2', machine: 'C' },
  { ligne: 'L2', machine: 'D' },
  { ligne: 'L3', machine: 'E' }, // aucune panne
];

const i = (id, date, machine, categorie, duree_arret_min) => ({
  id,
  date,
  ligne: MACHINES.find((m) => m.machine === machine).ligne,
  machine,
  description: 'peu importe',
  duree_arret_min,
  categorie,
});

// Jeu de référence. Résultats attendus calculés à la main :
//   A : 30 + 20 + 10 (MEC) + 40 (ELE)          = 100 min, 4 interventions
//   B : 50 + 25 (HYD)                          =  75 min, 2 interventions
//   C : 60 (MEC) + 15 + 5 + 10 (CAP)           =  90 min, 4 interventions
//   D : 100 (PNE) + 35 + 20 + 10 (à classer)   = 165 min, 4 interventions
//   E : 0
//   Total : 100 + 75 + 90 + 165 = 430 min, 14 interventions
const JEU = [
  i(1, '2026-03-05', 'A', 'MEC', 30),
  i(2, '2026-03-12', 'A', 'MEC', 20),
  i(3, '2026-03-20', 'A', 'MEC', 10),
  i(4, '2026-03-02', 'A', 'ELE', 40),
  i(5, '2026-03-03', 'B', 'HYD', 50),
  i(6, '2026-03-28', 'B', 'HYD', 25),
  i(7, '2026-03-01', 'C', 'MEC', 60),
  i(8, '2026-03-10', 'C', 'CAP', 15),
  i(9, '2026-03-11', 'C', 'CAP', 5),
  i(10, '2026-03-31', 'C', 'CAP', 10),
  i(11, '2026-03-15', 'D', 'PNE', 100),
  i(12, '2026-03-16', 'D', A_CLASSER, 35),
  i(13, '2026-03-17', 'D', A_CLASSER, 20),
  i(14, '2026-03-18', 'D', A_CLASSER, 10),
];

/** Gèle récursivement : toute tentative de modification de l'entrée lèverait une erreur. */
function geler(valeur) {
  if (valeur && typeof valeur === 'object') {
    Object.values(valeur).forEach(geler);
    Object.freeze(valeur);
  }
  return valeur;
}

test('en-tête : période, nombre d\'interventions, total', () => {
  const s = calculerStats(JEU, { machines: MACHINES });
  assert.deepEqual(s.periode, { debut: '2026-03-01', fin: '2026-03-31' });
  assert.equal(s.nbInterventions, 14);
  assert.equal(s.totalMin, 430);
  assert.equal(s.seuilRepetition, 3);
});

test('temps d\'arrêt par machine et par catégorie', () => {
  const s = calculerStats(JEU, { machines: MACHINES });
  const parNom = Object.fromEntries(s.parMachine.map((m) => [m.machine, m]));

  assert.deepEqual(s.parMachine.map((m) => m.machine), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(parNom.A.parCategorie, { ELE: { nb: 1, minutes: 40 }, MEC: { nb: 3, minutes: 60 } });
  assert.equal(parNom.A.totalMin, 100);
  assert.equal(parNom.A.nbInterventions, 4);
  assert.deepEqual(parNom.B.parCategorie, { HYD: { nb: 2, minutes: 75 } });
  assert.deepEqual(parNom.C.parCategorie, { CAP: { nb: 3, minutes: 30 }, MEC: { nb: 1, minutes: 60 } });
  assert.equal(parNom.C.totalMin, 90);
  assert.equal(parNom.D.totalMin, 165);
  assert.deepEqual(parNom.D.parCategorie[A_CLASSER], { nb: 3, minutes: 65 });
});

test('une machine sans panne apparaît à 0 si le parc est fourni', () => {
  const s = calculerStats(JEU, { machines: MACHINES });
  const e = s.parMachine.find((m) => m.machine === 'E');
  assert.deepEqual(e, { machine: 'E', ligne: 'L3', nbInterventions: 0, totalMin: 0, parCategorie: {}, partDuTotalPct: 0 });

  const sansParc = calculerStats(JEU);
  assert.equal(sansParc.parMachine.some((m) => m.machine === 'E'), false);
});

test('totaux par catégorie, toutes machines confondues', () => {
  const s = calculerStats(JEU);
  // MEC : 30 + 20 + 10 + 60 = 120 ; CAP : 15 + 5 + 10 = 30 ; à classer : 35 + 20 + 10 = 65
  assert.deepEqual(s.parCategorie, {
    CAP: { nb: 3, minutes: 30 },
    ELE: { nb: 1, minutes: 40 },
    HYD: { nb: 2, minutes: 75 },
    MEC: { nb: 4, minutes: 120 },
    PNE: { nb: 1, minutes: 100 },
    [A_CLASSER]: { nb: 3, minutes: 65 },
  });
  const somme = Object.values(s.parCategorie).reduce((t, c) => t + c.minutes, 0);
  assert.equal(somme, s.totalMin);
});

test('top 3 des machines les plus touchées, avec leur part du total', () => {
  const s = calculerStats(JEU, { machines: MACHINES });
  // 165/430 = 38,37 % → 38,4 ; 100/430 = 23,26 % → 23,3 ; 90/430 = 20,93 % → 20,9
  assert.deepEqual(s.top, [
    { rang: 1, machine: 'D', ligne: 'L2', totalMin: 165, nbInterventions: 4, partDuTotalPct: 38.4 },
    { rang: 2, machine: 'A', ligne: 'L1', totalMin: 100, nbInterventions: 4, partDuTotalPct: 23.3 },
    { rang: 3, machine: 'C', ligne: 'L2', totalMin: 90, nbInterventions: 4, partDuTotalPct: 20.9 },
  ]);
});

test('pannes répétées ≥ 3 : même machine + même catégorie, « à classer » exclu', () => {
  const s = calculerStats(JEU);
  // A/MEC : 3 fois, 60 min ; C/CAP : 3 fois, 30 min ; D/à classer : 3 fois mais exclu ; B/HYD : 2 fois seulement
  assert.deepEqual(s.pannesRepetees, [
    { machine: 'A', ligne: 'L1', categorie: 'MEC', nb: 3, minutes: 60 },
    { machine: 'C', ligne: 'L2', categorie: 'CAP', nb: 3, minutes: 30 },
  ]);
});

test('le seuil compte des interventions, pas des minutes', () => {
  // Deux pannes très longues ne font pas une panne répétée.
  const jeu = [i(1, '2026-03-01', 'B', 'HYD', 500), i(2, '2026-03-02', 'B', 'HYD', 500)];
  assert.deepEqual(calculerStats(jeu).pannesRepetees, []);
  assert.equal(calculerStats(jeu, { seuilRepetition: 2 }).pannesRepetees.length, 1);
});

test('égalité de temps d\'arrêt : départage alphabétique', () => {
  const jeu = [
    i(1, '2026-03-01', 'C', 'MEC', 50),
    i(2, '2026-03-01', 'A', 'MEC', 50),
    i(3, '2026-03-01', 'B', 'MEC', 50),
    i(4, '2026-03-01', 'D', 'MEC', 50),
  ];
  assert.deepEqual(calculerStats(jeu).top.map((m) => m.machine), ['A', 'B', 'C']);
});

test('moins de 3 machines touchées : le top est plus court, sans machine à 0', () => {
  const jeu = [i(1, '2026-03-01', 'B', 'HYD', 10)];
  const s = calculerStats(jeu, { machines: MACHINES });
  assert.deepEqual(s.top.map((m) => m.machine), ['B']);
});

test('déterministe : l\'ordre des interventions ne change pas le résultat', () => {
  const reference = calculerStats(JEU, { machines: MACHINES });
  const inverse = calculerStats([...JEU].reverse(), { machines: [...MACHINES].reverse() });
  const melange = calculerStats([JEU[7], ...JEU.slice(8), ...JEU.slice(0, 7)], { machines: MACHINES });
  assert.deepEqual(inverse, reference);
  assert.deepEqual(melange, reference);
  // Y compris l'ordre des clés, qui détermine l'ordre des colonnes du rapport.
  assert.equal(JSON.stringify(inverse), JSON.stringify(reference));
});

test('pur : les données d\'entrée ne sont pas modifiées', () => {
  const jeu = geler(structuredClone(JEU));
  const machines = geler(structuredClone(MACHINES));
  assert.doesNotThrow(() => calculerStats(jeu, { machines }));
  assert.deepEqual(jeu, JEU);
});

test('journal vide', () => {
  const s = calculerStats([], { machines: MACHINES });
  assert.equal(s.periode, null);
  assert.equal(s.nbInterventions, 0);
  assert.equal(s.totalMin, 0);
  assert.deepEqual(s.top, []);
  assert.deepEqual(s.pannesRepetees, []);
  assert.equal(s.parMachine.length, 5);
});

test('refuse une intervention non classée ou une durée invalide', () => {
  assert.throws(() => calculerStats([i(7, '2026-03-01', 'A', '', 10)]), /Intervention 7 : catégorie manquante/);
  assert.throws(() => calculerStats([i(8, '2026-03-01', 'A', 'MEC', 0)]), /Intervention 8 : durée invalide/);
  assert.throws(() => calculerStats([i(9, '2026-03-01', 'A', 'MEC', '30')]), /Intervention 9 : durée invalide/);
});

test('pourcentage arrondi au dixième', () => {
  assert.equal(pourcentage(135, 400), 33.8); // 33,75 → 33,8
  assert.equal(pourcentage(1, 3), 33.3);
  assert.equal(pourcentage(2, 3), 66.7);
  assert.equal(pourcentage(5, 0), 0);
});
