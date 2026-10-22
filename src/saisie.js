import { lireJournal, lireMachines, ajouterIntervention, estDateValide, estEntierPositif } from './csv.js';
import { choisirDansListe, saisirTexte, demanderConfirmation } from './menu.js';

const DESCRIPTION_MIN = 5;
const DESCRIPTION_MAX = 300;

/** Date locale du jour au format AAAA-MM-JJ (toISOString donnerait la date UTC, fausse autour de minuit). */
export function dateDuJour(maintenant = new Date()) {
  const deuxChiffres = (n) => String(n).padStart(2, '0');
  return `${maintenant.getFullYear()}-${deuxChiffres(maintenant.getMonth() + 1)}-${deuxChiffres(maintenant.getDate())}`;
}

// Les validateurs renvoient true ou un message d'erreur, comme l'attend inquirer.

export function validerDate(texte, aujourdhui = dateDuJour()) {
  const t = texte.trim();
  if (!estDateValide(t)) return 'Date invalide : format attendu AAAA-MM-JJ (ex. 2026-03-15).';
  // Comparaison de chaînes valable car le format AAAA-MM-JJ est triable.
  if (t > aujourdhui) return `La date ne peut pas être dans le futur (aujourd'hui : ${aujourdhui}).`;
  return true;
}

export function validerDescription(texte) {
  const t = texte.trim();
  if (t.length < DESCRIPTION_MIN) return `Décrivez la panne en au moins ${DESCRIPTION_MIN} caractères.`;
  if (t.length > DESCRIPTION_MAX) return `Description trop longue (${t.length} caractères, maximum ${DESCRIPTION_MAX}).`;
  return true;
}

export function validerDuree(texte) {
  const t = texte.trim();
  if (!estEntierPositif(t)) return 'Durée invalide : nombre entier de minutes supérieur à 0 (ex. 45).';
  return true;
}

export function prochainId(interventions) {
  return interventions.reduce((max, i) => Math.max(max, i.id), 0) + 1;
}

/** Option 1 du menu : saisie guidée d'une intervention, ajoutée à data/journal.csv après confirmation. */
export async function saisirIntervention() {
  // Lus avant les questions : si un fichier manque ou est invalide, on le dit tout de suite.
  const [machines, journal] = await Promise.all([lireMachines(), lireJournal()]);

  const date = await saisirTexte('Date de l\'intervention (AAAA-MM-JJ) :', {
    defaut: dateDuJour(),
    valider: (v) => validerDate(v),
  });

  const lignes = [...new Set(machines.map((m) => m.ligne))];
  const ligne = await choisirDansListe('Ligne de production :', lignes);

  const machinesDeLaLigne = machines.filter((m) => m.ligne === ligne).map((m) => m.machine);
  const machine = await choisirDansListe('Machine :', machinesDeLaLigne);

  const description = await saisirTexte('Description de la panne :', { valider: validerDescription });
  const duree = await saisirTexte('Durée d\'arrêt (minutes) :', { valider: validerDuree });

  const intervention = {
    id: prochainId(journal),
    date,
    ligne,
    machine,
    description,
    duree_arret_min: Number(duree),
    categorie: '', // classée plus tard, à l'option « Consulter le bilan »
  };

  console.log('\nRécapitulatif :');
  console.log(`  N°           ${intervention.id}`);
  console.log(`  Date         ${intervention.date}`);
  console.log(`  Ligne        ${intervention.ligne}`);
  console.log(`  Machine      ${intervention.machine}`);
  console.log(`  Description  ${intervention.description}`);
  console.log(`  Arrêt        ${intervention.duree_arret_min} min\n`);

  if (!(await demanderConfirmation('Enregistrer cette intervention ?'))) {
    console.log('Saisie abandonnée, rien n\'a été enregistré.');
    return;
  }

  await ajouterIntervention(intervention);
  console.log(`Intervention n° ${intervention.id} enregistrée dans data/journal.csv.`);
}
