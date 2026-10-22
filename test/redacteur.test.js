// Boucle « rédiger → contrôler → réécrire » du BPMN, avec un faux modèle (sans réseau).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redigerBilanMachine, donneesMachine, identifiantsDuParc } from '../src/redacteur.js';
import { calculerStats } from '../src/stats.js';
import { ErreurReponseModele } from '../src/llm.js';

const MACHINES = [{ ligne: 'Ligne 1', machine: 'M03 Ébarbeuse 1' }, { ligne: 'Ligne 2', machine: 'M04 Presse 2' }];
const JOURNAL = [
  { id: 1, date: '2026-03-02', ligne: 'Ligne 1', machine: 'M03 Ébarbeuse 1', description: 'secret technicien', duree_arret_min: 40, categorie: 'MEC' },
  { id: 2, date: '2026-03-09', ligne: 'Ligne 1', machine: 'M03 Ébarbeuse 1', description: 'x', duree_arret_min: 20, categorie: 'MEC' },
  { id: 3, date: '2026-03-20', ligne: 'Ligne 1', machine: 'M03 Ébarbeuse 1', description: 'x', duree_arret_min: 30, categorie: 'MEC' },
  { id: 4, date: '2026-03-25', ligne: 'Ligne 2', machine: 'M04 Presse 2', description: 'x', duree_arret_min: 10, categorie: 'ELE' },
];
const STATS = calculerStats(JOURNAL, { machines: MACHINES });
const LIBELLES = new Map([['MEC', 'mécanique'], ['ELE', 'électrique']]);
const DONNEES = donneesMachine(STATS, STATS.parMachine[0], LIBELLES);
const IDS = identifiantsDuParc(MACHINES);

function fauxModele(...reponses) {
  const messages = [];
  const appelerOutil = async ({ message }) => {
    messages.push(message);
    const r = reponses[messages.length - 1];
    if (r instanceof Error) throw r;
    return r;
  };
  return { appelerOutil, messages };
}

test('données envoyées : uniquement des chiffres calculés, aucune description', () => {
  assert.deepEqual(DONNEES, {
    machine: 'M03 Ébarbeuse 1',
    ligne: 'Ligne 1',
    nb_interventions: 3,
    temps_arret_total_min: 90, // 40 + 20 + 30
    part_du_temps_arret_usine_pct: 90, // 90 / (90 + 10)
    rang_dans_le_top3: 1,
    seuil_panne_repetee: 3,
    nb_categories_en_panne_repetee: 1,
    par_categorie: [{ categorie: 'mécanique', nb_interventions: 3, minutes: 90 }],
    pannes_repetees: [{ categorie: 'mécanique', nb_interventions: 3, minutes: 90 }],
  });
  assert.equal(JSON.stringify(DONNEES).includes('secret'), false);
});

test('texte cohérent : accepté au premier essai', async () => {
  const { appelerOutil, messages } = fauxModele({
    bilan: 'La M03 Ébarbeuse 1 (Ligne 1) totalise 90 min sur 3 interventions, 90 % de l\'usine.',
    points_a_etudier: ['Étudier l\'usure des organes mécaniques.'],
  });
  const r = await redigerBilanMachine(DONNEES, IDS, { appelerOutil });
  assert.equal(r.essais, 1);
  assert.equal(messages.length, 1);
});

test('chiffre inventé : réécriture demandée avec les nombres fautifs, acceptée au 2e essai', async () => {
  const { appelerOutil, messages } = fauxModele(
    { bilan: 'Soit 1,5 heure d\'arrêt et 30 min en moyenne.', points_a_etudier: [] },
    { bilan: '90 min d\'arrêt sur 3 interventions.', points_a_etudier: ['Examiner les courroies.'] },
  );
  const r = await redigerBilanMachine(DONNEES, IDS, { appelerOutil });
  assert.equal(r.essais, 2);
  assert.match(messages[1], /rejetée : ces nombres n'existent pas dans les données fournies : 1,5, 30/);
});

test('les points à étudier sont contrôlés aussi', async () => {
  const { appelerOutil } = fauxModele(
    { bilan: '90 min.', points_a_etudier: ['Étudier un graissage toutes les 500 h.'] },
    { bilan: '90 min.', points_a_etudier: ['Étudier la fréquence de graissage.'] },
  );
  assert.equal((await redigerBilanMachine(DONNEES, IDS, { appelerOutil })).essais, 2);
});

test('3 essais incohérents : erreur claire, pas de rapport', async () => {
  const faux = { bilan: '42 min.', points_a_etudier: [] };
  const { appelerOutil, messages } = fauxModele(faux, faux, faux, faux);
  await assert.rejects(
    redigerBilanMachine(DONNEES, IDS, { appelerOutil }),
    /Bilan de M03 Ébarbeuse 1 : chiffres incohérents après 3 essais .*42/,
  );
  assert.equal(messages.length, 3);
});

test('réponse inexploitable (sans outil) : compte comme un essai', async () => {
  const { appelerOutil } = fauxModele(new ErreurReponseModele('sans outil'), { bilan: '3 interventions.', points_a_etudier: [] });
  assert.equal((await redigerBilanMachine(DONNEES, IDS, { appelerOutil })).essais, 2);
});

test('erreur d\'API : remonte immédiatement', async () => {
  const { appelerOutil, messages } = fauxModele(new Error('Clé API refusée (401)'));
  await assert.rejects(redigerBilanMachine(DONNEES, IDS, { appelerOutil }), /401/);
  assert.equal(messages.length, 1);
});
