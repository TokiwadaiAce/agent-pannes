// Tous les calculs du bilan. Module pur : aucune lecture de fichier, aucun appel au LLM,
// pas de date courante ni d'aléatoire. Mêmes entrées → mêmes sorties, quel que soit l'ordre des interventions.

/** Valeur de la colonne `categorie` quand le LLM n'a pas su classer (exclue des pannes répétées). */
export const A_CLASSER = 'À classer manuellement';

export const SEUIL_REPETITION = 3;
export const TAILLE_TOP = 3;

const comparerTexte = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Part en pourcentage arrondie au dixième, calculée en entiers pour éviter les erreurs d'arrondi flottant. */
export function pourcentage(partie, total) {
  if (total === 0) return 0;
  return Math.round((partie * 1000) / total) / 10;
}

function verifier(interventions) {
  for (const i of interventions) {
    if (!Number.isInteger(i.duree_arret_min) || i.duree_arret_min <= 0) {
      throw new Error(`Intervention ${i.id} : durée invalide (${i.duree_arret_min}).`);
    }
    if (!i.categorie) {
      throw new Error(`Intervention ${i.id} : catégorie manquante, le classement doit précéder les calculs.`);
    }
  }
}

function ajouter(compteurs, cle, minutes) {
  const c = compteurs[cle] ?? (compteurs[cle] = { nb: 0, minutes: 0 });
  c.nb += 1;
  c.minutes += minutes;
}

/** Trie les clés d'un objet pour que l'ordre de sortie ne dépende pas de l'ordre d'entrée. */
function trierCles(objet) {
  return Object.fromEntries(Object.keys(objet).sort(comparerTexte).map((k) => [k, objet[k]]));
}

/**
 * @param {Array<{id, date, ligne, machine, duree_arret_min: number, categorie: string}>} interventions classées
 * @param {object} [options]
 * @param {Array<{ligne, machine}>} [options.machines] parc complet : les machines sans panne apparaissent à 0
 * @param {number} [options.seuilRepetition] nombre d'interventions à partir duquel une panne est « répétée »
 * @param {number} [options.tailleTop]
 */
export function calculerStats(interventions, options = {}) {
  const { machines = [], seuilRepetition = SEUIL_REPETITION, tailleTop = TAILLE_TOP } = options;
  verifier(interventions);

  const parMachine = new Map();
  const initialiser = (machine, ligne) => {
    if (!parMachine.has(machine)) {
      parMachine.set(machine, { machine, ligne, nbInterventions: 0, totalMin: 0, parCategorie: {} });
    }
    return parMachine.get(machine);
  };
  for (const m of machines) initialiser(m.machine, m.ligne);

  const parCategorie = {};
  let totalMin = 0;
  for (const i of interventions) {
    const m = initialiser(i.machine, i.ligne);
    m.nbInterventions += 1;
    m.totalMin += i.duree_arret_min;
    ajouter(m.parCategorie, i.categorie, i.duree_arret_min);
    ajouter(parCategorie, i.categorie, i.duree_arret_min);
    totalMin += i.duree_arret_min;
  }

  const listeMachines = [...parMachine.values()]
    .map((m) => ({ ...m, partDuTotalPct: pourcentage(m.totalMin, totalMin), parCategorie: trierCles(m.parCategorie) }))
    .sort((a, b) => comparerTexte(a.machine, b.machine));

  // Égalité de temps d'arrêt : départage par nom de machine, pour un classement stable.
  const top = listeMachines
    .filter((m) => m.totalMin > 0)
    .sort((a, b) => b.totalMin - a.totalMin || comparerTexte(a.machine, b.machine))
    .slice(0, tailleTop)
    .map((m, index) => ({
      rang: index + 1,
      machine: m.machine,
      ligne: m.ligne,
      totalMin: m.totalMin,
      nbInterventions: m.nbInterventions,
      partDuTotalPct: m.partDuTotalPct,
    }));

  const pannesRepetees = listeMachines
    .flatMap((m) =>
      Object.entries(m.parCategorie)
        .filter(([categorie, c]) => categorie !== A_CLASSER && c.nb >= seuilRepetition)
        .map(([categorie, c]) => ({ machine: m.machine, ligne: m.ligne, categorie, nb: c.nb, minutes: c.minutes })),
    )
    .sort(
      (a, b) =>
        b.nb - a.nb ||
        b.minutes - a.minutes ||
        comparerTexte(a.machine, b.machine) ||
        comparerTexte(a.categorie, b.categorie),
    );

  const dates = interventions.map((i) => i.date).sort(comparerTexte);
  const periode = dates.length ? { debut: dates[0], fin: dates.at(-1) } : null;

  return {
    periode,
    nbInterventions: interventions.length,
    totalMin,
    seuilRepetition,
    parCategorie: trierCles(parCategorie),
    parMachine: listeMachines,
    top,
    pannesRepetees,
  };
}
