// Tests du classement sans réseau : le modèle est remplacé par une fonction qui joue un scénario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classerInterventions, verifierReponse, decouperEnLots } from '../src/classifier.js';
import { ErreurReponseModele } from '../src/llm.js';
import { A_CLASSER } from '../src/stats.js';

const CATEGORIES = [
  { code: 'MEC', libelle: 'mécanique', description: 'courroies, roulements' },
  { code: 'ELE', libelle: 'électrique', description: 'moteurs, variateurs' },
  { code: 'DIV', libelle: 'divers', description: 'le reste' },
];
const CODES = CATEGORIES.map((c) => c.code);

const interv = (id, description = `panne ${id}`) => ({
  id, date: '2026-03-01', ligne: 'L1', machine: 'A', description, duree_arret_min: 10, categorie: '',
});

/** Faux modèle : renvoie successivement les réponses prévues et enregistre ce qu'on lui envoie. */
function fauxModele(...reponses) {
  const appels = [];
  const appelerOutil = async (requete) => {
    appels.push({ ...requete, donnees: JSON.parse(requete.message) });
    const r = reponses[appels.length - 1];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(appels.at(-1).donnees) : r;
  };
  return { appelerOutil, appels };
}

test('découpage en lots de 20', () => {
  const lots = decouperEnLots(Array.from({ length: 45 }, (_, i) => i));
  assert.deepEqual(lots.map((l) => l.length), [20, 20, 5]);
});

test('vérification : accepte les codes de la liste, rejette le reste', () => {
  const lot = [interv(1), interv(2), interv(3), interv(4), interv(5)];
  const reponse = {
    classements: [
      { id: 1, categorie: 'MEC' },
      { id: 2, categorie: 'hydraulique' }, // hors liste
      { id: 4, categorie: 'ELE' },
      { id: 4, categorie: 'MEC' }, // id doublé avec deux avis différents
      { id: 5, categorie: 'DIV' },
      { id: 99, categorie: 'MEC' }, // id qui n'était pas dans le lot : ignoré
    ],
  };
  const { acceptees, aReprendre } = verifierReponse(lot, reponse, CODES);
  assert.deepEqual([...acceptees], [[1, 'MEC'], [5, 'DIV']]);
  assert.deepEqual(aReprendre.map((i) => i.id), [2, 3, 4]); // 3 : absent de la réponse
});

test('vérification : réponse vide ou mal formée → tout est à reprendre', () => {
  const lot = [interv(1), interv(2)];
  for (const reponse of [null, {}, { classements: 'MEC' }]) {
    assert.equal(verifierReponse(lot, reponse, CODES).aReprendre.length, 2);
  }
});

test('n\'envoie que l\'id et la description, par lots', async () => {
  const toutMec = (donnees) => ({ classements: donnees.map((d) => ({ id: d.id, categorie: 'MEC' })) });
  const { appelerOutil, appels } = fauxModele(toutMec, toutMec);
  const interventions = Array.from({ length: 25 }, (_, k) => interv(k + 1));

  const r = await classerInterventions(interventions, CATEGORIES, { appelerOutil });

  assert.equal(appels.length, 2);
  assert.deepEqual(appels.map((a) => a.donnees.length), [20, 5]);
  assert.deepEqual(Object.keys(appels[0].donnees[0]).sort(), ['description', 'id']);
  assert.deepEqual(appels[0].outil.input_schema.properties.classements.items.properties.categorie.enum, CODES);
  assert.equal(r.categories.size, 25);
  assert.deepEqual(r.rejets, []);
});

test('hors liste : une nouvelle tentative pour les seules rejetées, puis « à classer manuellement »', async () => {
  const { appelerOutil, appels } = fauxModele(
    { classements: [{ id: 1, categorie: 'MEC' }, { id: 2, categorie: 'hydraulique' }, { id: 3, categorie: 'xxx' }] },
    { classements: [{ id: 2, categorie: 'ELE' }, { id: 3, categorie: 'yyy' }] },
  );
  const r = await classerInterventions([interv(1), interv(2), interv(3)], CATEGORIES, { appelerOutil });

  assert.equal(appels.length, 2);
  assert.deepEqual(appels[1].donnees.map((d) => d.id), [2, 3]);
  assert.deepEqual([...r.categories].sort(), [[1, 'MEC'], [2, 'ELE'], [3, A_CLASSER]]);
  // Ce que le modèle a renvoyé est conservé pour l'affichage.
  assert.deepEqual(r.rejets, [{ id: 3, renvoye: ['xxx', 'yyy'] }]);
});

test('réponse inexploitable du modèle : le lot est repris une fois', async () => {
  const { appelerOutil, appels } = fauxModele(
    new ErreurReponseModele('sans outil'),
    { classements: [{ id: 1, categorie: 'DIV' }] },
  );
  const r = await classerInterventions([interv(1)], CATEGORIES, { appelerOutil });
  assert.equal(appels.length, 2);
  assert.equal(r.categories.get(1), 'DIV');
});

test('erreur d\'API (réseau, clé…) : remonte telle quelle, sans être maquillée en « à classer »', async () => {
  const { appelerOutil } = fauxModele(new Error('Impossible de joindre l\'API Anthropic'));
  await assert.rejects(classerInterventions([interv(1)], CATEGORIES, { appelerOutil }), /joindre l'API/);
});
