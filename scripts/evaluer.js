// Compare le classement du modèle (data/journal_enrichi.csv) aux 20 interventions étiquetées à la main
// (sources/echantillon_etiquete.csv). Objectif de l'exercice : au moins 90 % d'accord.
//   npm run evaluer   (après un « Consulter le bilan »)
import { join } from 'node:path';
import { RACINE, CHEMINS, lireCsv, lireJournal, lireCategories } from '../src/csv.js';

const OBJECTIF_PCT = 90;

async function main() {
  const categories = await lireCategories();
  const codeParLibelle = new Map(categories.map((c) => [c.libelle, c.code]));
  const echantillon = await lireCsv(join(RACINE, 'sources', 'echantillon_etiquete.csv'), ['identifiant', 'categorie']);
  const enrichi = new Map((await lireJournal(CHEMINS.journalEnrichi)).map((i) => [i.id, i]));

  let accords = 0;
  for (const e of echantillon) {
    const id = Number(e.identifiant.replace(/\D/g, ''));
    const attendu = codeParLibelle.get(e.categorie) ?? e.categorie;
    const obtenu = enrichi.get(id)?.categorie ?? '(absente)';
    if (obtenu === attendu) {
      accords += 1;
    } else {
      console.log(`Écart ${e.identifiant} : attendu ${attendu}, obtenu ${obtenu} — ${enrichi.get(id)?.description ?? ''}`);
    }
  }

  const pct = Math.round((accords * 1000) / echantillon.length) / 10;
  console.log(`\nAccord : ${accords}/${echantillon.length} (${pct.toLocaleString('fr-FR')} %) — objectif ${OBJECTIF_PCT} %`);
  process.exit(pct >= OBJECTIF_PCT ? 0 : 1);
}

main().catch((err) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});
