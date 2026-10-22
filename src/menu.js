import { select, input } from '@inquirer/prompts';

export const ACTIONS = {
  SAISIR: 'saisir',
  BILAN: 'bilan',
  QUITTER: 'quitter',
};

export function menuPrincipal() {
  return select({
    message: 'Que voulez-vous faire ?',
    choices: [
      { name: 'Saisir une intervention', value: ACTIONS.SAISIR },
      { name: 'Consulter le bilan', value: ACTIONS.BILAN },
      { name: 'Quitter', value: ACTIONS.QUITTER },
    ],
  });
}

/** Sélecteur à flèches sur une liste de chaînes. */
export function choisirDansListe(message, valeurs) {
  return select({ message, choices: valeurs.map((v) => ({ name: v, value: v })) });
}

/**
 * Saisie libre. `valider` renvoie true si la valeur est acceptée, sinon le message d'erreur :
 * inquirer l'affiche et redemande tant que la valeur est invalide.
 */
export async function saisirTexte(message, { defaut, valider } = {}) {
  const valeur = await input({ message, default: defaut, validate: valider });
  return valeur.trim();
}

// Sélecteur Oui/Non plutôt que `confirm` d'inquirer, qui affiche « (Y/n) » et « Yes » en anglais.
export function demanderConfirmation(message) {
  return select({
    message,
    choices: [
      { name: 'Oui', value: true },
      { name: 'Non', value: false },
    ],
  });
}
