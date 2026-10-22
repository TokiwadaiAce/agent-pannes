// Option 2 : enchaîne les étapes du BPMN, de la lecture du journal à la note de revue.
import { access } from 'node:fs/promises';
import { CHEMINS, lireJournal, lireCategories, lireMachines, ecrireJournalEnrichi } from './csv.js';
import { classerInterventions } from './classifier.js';
import { calculerStats, A_CLASSER } from './stats.js';
import { redigerBilans } from './redacteur.js';
import { genererRapport, ecrireRapport } from './rapport.js';
import { dateDuJour } from './saisie.js';

async function existe(chemin) {
  try {
    await access(chemin);
    return true;
  } catch {
    return false;
  }
}

/** S1 : contrôles croisés entre le journal et les référentiels (machines, catégories). */
export function validerReferentiels(journal, machines, codes) {
  const lignesParMachine = new Map(machines.map((m) => [m.machine, m.ligne]));
  const categoriesAdmises = new Set([...codes, A_CLASSER]);
  const erreurs = [];
  for (const i of journal) {
    if (!lignesParMachine.has(i.machine)) {
      erreurs.push(`intervention ${i.id} : machine inconnue « ${i.machine} »`);
    } else if (lignesParMachine.get(i.machine) !== i.ligne) {
      erreurs.push(`intervention ${i.id} : ${i.machine} n'appartient pas à « ${i.ligne} »`);
    }
    if (i.categorie && !categoriesAdmises.has(i.categorie)) {
      erreurs.push(`intervention ${i.id} : catégorie inconnue « ${i.categorie} »`);
    }
  }
  if (erreurs.length) {
    const reste = erreurs.length > 10 ? `\n  … et ${erreurs.length - 10} autre(s)` : '';
    throw new Error(`Journal incohérent avec les référentiels :\n  - ${erreurs.slice(0, 10).join('\n  - ')}${reste}`);
  }
}

/**
 * Catégories déjà attribuées lors d'un bilan précédent, pour ne pas repayer le classement.
 * Reprises seulement si la description n'a pas changé depuis.
 */
async function lireClassementsPrecedents(codes) {
  if (!(await existe(CHEMINS.journalEnrichi))) return new Map();
  try {
    const admises = new Set([...codes, A_CLASSER]);
    const precedents = await lireJournal(CHEMINS.journalEnrichi);
    return new Map(precedents.filter((i) => admises.has(i.categorie)).map((i) => [i.id, i]));
  } catch (err) {
    console.warn(`Journal enrichi précédent ignoré (${err.message.split('\n')[0]}) : tout sera reclassé.`);
    return new Map();
  }
}

/** S1 → A1 → S2 : lit, classe ce qui ne l'est pas, écrit le journal enrichi. */
export async function classerJournal() {
  const [journal, categories, machines] = await Promise.all([lireJournal(), lireCategories(), lireMachines()]);
  const codes = categories.map((c) => c.code);
  validerReferentiels(journal, machines, codes);

  const precedents = await lireClassementsPrecedents(codes);
  const enrichi = journal.map((i) => {
    if (i.categorie) return { ...i };
    const p = precedents.get(i.id);
    return { ...i, categorie: p && p.description === i.description ? p.categorie : '' };
  });

  const aClasser = enrichi.filter((i) => !i.categorie);
  let rejets = [];
  if (aClasser.length) {
    console.log(`Classement de ${aClasser.length} intervention(s) par le modèle…`);
    const resultat = await classerInterventions(aClasser, categories, {
      surProgression: (n, total) => console.log(`  lot ${n}/${total}`),
    });
    for (const i of aClasser) i.categorie = resultat.categories.get(i.id);
    rejets = resultat.rejets;
  } else {
    console.log('Toutes les interventions sont déjà classées : aucun appel au modèle.');
  }

  await ecrireJournalEnrichi(enrichi);
  return { enrichi, categories, machines, nbClassees: aClasser.length, rejets };
}

/** Option 2 complète : S1 → A1 → S2 → S3 → A2 ⇄ S4 → S5, puis affichage. */
export async function consulterBilan() {
  // S1 → A1 → S2
  const { enrichi, categories, machines, nbClassees, rejets } = await classerJournal();
  console.log(`Journal enrichi écrit (${nbClassees} classée(s) à l'instant) : ${CHEMINS.journalEnrichi}`);
  for (const r of rejets) {
    const vu = r.renvoye.length ? r.renvoye.map((c) => `« ${c} »`).join(', ') : 'aucune réponse';
    console.log(`  Intervention ${r.id} → ${A_CLASSER} (réponses rejetées : ${vu})`);
  }

  // S3 : tous les chiffres, en code
  const stats = calculerStats(enrichi, { machines });

  // A2 ⇄ S4 : rédaction, contrôle des chiffres cités, réécriture si besoin
  console.log('\nRédaction des bilans par machine…');
  const bilans = await redigerBilans(stats, categories, {
    surProgression: (n, total, machine, essais) =>
      console.log(`  ${n}/${total} ${machine}${essais > 1 ? ` (accepté au ${essais}e essai)` : ''}`),
  });

  // S5
  const rapport = genererRapport({
    stats,
    categories,
    bilans,
    aClasser: enrichi.filter((i) => i.categorie === A_CLASSER),
    modele: process.env.ANTHROPIC_MODEL,
    genereLe: dateDuJour(),
  });
  const chemin = await ecrireRapport(rapport);

  console.log(`\n${'─'.repeat(70)}\n`);
  console.log(rapport);
  console.log(`${'─'.repeat(70)}`);
  console.log(`Bilan enregistré : ${chemin}`);
}
