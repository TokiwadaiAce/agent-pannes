// Importe les données de l'exercice (sources/, ancien format d'export) dans data/, au nouveau format du journal.
// Les fichiers sources ne sont jamais modifiés.
//   npm run seed             → refuse d'écraser un journal existant
//   npm run seed -- --force  → réinitialise data/ (journal, enrichi, catégories, machines)
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RACINE, CHEMINS, COLONNES, lireCsv, ecrireCsv } from '../src/csv.js';

const SOURCE = join(RACINE, 'sources');
const SOURCES = {
  journal: join(SOURCE, 'journal_pannes_mois.csv'),
  categories: join(SOURCE, 'categories_panne.csv'),
};
const COLONNES_ANCIEN_JOURNAL = ['identifiant', 'date', 'ligne', 'machine', 'symptome', 'action', 'duree_arret_min'];

async function existe(chemin) {
  try {
    await access(chemin);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force && (await existe(CHEMINS.journal))) {
    console.error(`${CHEMINS.journal} existe déjà (il contient peut-être des saisies).`);
    console.error('Relancez avec « npm run seed -- --force » pour le réinitialiser.');
    process.exit(1);
  }

  const ancien = await lireCsv(SOURCES.journal, COLONNES_ANCIEN_JOURNAL);
  const categories = await lireCsv(SOURCES.categories, COLONNES.categories);

  // « INT-007 » → 7 : id numérique auto-incrémentable, et la correspondance avec l'échantillon étiqueté reste simple.
  const journal = ancien.map((l) => ({
    id: Number(l.identifiant.replace(/\D/g, '')),
    date: l.date,
    ligne: l.ligne,
    machine: l.machine,
    // Le symptôme seul est souvent ambigu (« le vérin ne rentre plus ») : l'action réalisée aide au classement.
    description: `${l.symptome} (action : ${l.action})`,
    duree_arret_min: l.duree_arret_min,
    categorie: '',
  }));

  const machines = [...new Map(ancien.map((l) => [l.machine, { ligne: l.ligne, machine: l.machine }])).values()]
    .sort((a, b) => a.machine.localeCompare(b.machine, 'fr'));

  await ecrireCsv(CHEMINS.journal, journal, COLONNES.journal);
  await ecrireCsv(CHEMINS.categories, categories, COLONNES.categories);
  await ecrireCsv(CHEMINS.machines, machines, COLONNES.machines);
  // Les catégories déjà classées correspondaient à l'ancien journal : on repart de zéro.
  await rm(CHEMINS.journalEnrichi, { force: true });

  const nbLignes = new Set(machines.map((m) => m.ligne)).size;
  console.log(`Journal : ${journal.length} interventions → ${CHEMINS.journal}`);
  console.log(`Catégories : ${categories.length} → ${CHEMINS.categories}`);
  console.log(`Machines : ${machines.length} sur ${nbLignes} lignes → ${CHEMINS.machines}`);
}

main().catch((err) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});
