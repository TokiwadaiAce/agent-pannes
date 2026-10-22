import { join } from 'node:path';
import dotenv from 'dotenv';
import { RACINE } from './csv.js';
import { menuPrincipal, ACTIONS } from './menu.js';
import { saisirIntervention } from './saisie.js';
import { consulterBilan } from './pipeline.js';

// .env lu depuis la racine du projet, et non depuis le dossier courant.
dotenv.config({ path: join(RACINE, '.env'), quiet: true });

// Ctrl+C pendant une question : inquirer lève ExitPromptError, on quitte proprement.
const estInterruption = (err) => err?.name === 'ExitPromptError';

async function executer(action) {
  switch (action) {
    case ACTIONS.SAISIR:
      await saisirIntervention();
      break;
    case ACTIONS.BILAN:
      await consulterBilan();
      break;
  }
}

async function main() {
  console.log('=== Analyse des pannes de maintenance ===\n');
  while (true) {
    let action;
    try {
      action = await menuPrincipal();
    } catch (err) {
      if (estInterruption(err)) break;
      throw err;
    }
    if (action === ACTIONS.QUITTER) break;

    // Toute erreur d'une action est affichée puis on revient au menu : le menu ne plante jamais.
    try {
      await executer(action);
    } catch (err) {
      if (estInterruption(err)) {
        console.log('\nAction annulée.');
      } else {
        console.error(`\nErreur : ${err.message}`);
      }
    }
    console.log();
  }
  console.log('Au revoir.');
}

main();
