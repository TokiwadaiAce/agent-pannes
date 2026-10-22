// Étapes A2 (le LLM rédige) et S4/G1 (le code contrôle, sinon réécriture) du BPMN.
import { appelerOutil as appelerOutilParDefaut, ErreurReponseModele } from './llm.js';
import { verifierChiffres } from './controle.js';
import { A_CLASSER } from './stats.js';

export const MAX_ESSAIS = 3;
const NOM_OUTIL = 'rediger_bilan';

const OUTIL = {
  name: NOM_OUTIL,
  description: 'Enregistre le bilan rédigé pour une machine et les points à étudier.',
  input_schema: {
    type: 'object',
    properties: {
      bilan: { type: 'string', description: 'Bilan d\'intervention de la machine, 3 à 5 phrases.' },
      points_a_etudier: {
        type: 'array',
        items: { type: 'string' },
        description: '1 à 3 pistes préventives, chacune formulée comme un point à étudier.',
      },
    },
    required: ['bilan', 'points_a_etudier'],
    additionalProperties: false,
  },
};

const SYSTEME = `Tu rédiges le bilan d'intervention d'une machine pour la revue de maintenance d'une fonderie.
Tu reçois en JSON des chiffres déjà calculés par un programme. Règles strictes :
1. N'utilise que les nombres présents dans le JSON, recopiés à l'identique (même arrondi), écrits en chiffres, avec une virgule décimale (9,5 %).
2. Ne fais aucun calcul : ni addition, ni différence, ni moyenne, ni conversion (minutes en heures), ni pourcentage, ni ratio, ni classement qui ne figure pas dans le JSON.
3. « par_categorie » est déjà trié par minutes décroissantes : suis cet ordre. Deux catégories aux minutes identiques sont à égalité.
4. « bilan » : 3 à 5 phrases factuelles en français : volume d'arrêt, catégories principales, pannes répétées s'il y en a. La période et le total de l'usine figurent déjà en tête du rapport : ne les répète pas.
5. « points_a_etudier » : 1 à 3 pistes préventives liées aux catégories dominantes et aux pannes répétées, formulées comme des points à étudier (« Étudier… », « Examiner l'opportunité de… », « Vérifier si… »). Jamais de décision ni d'ordre : pas de « il faut », « doit », « remplacer », « mettre en place ».
6. Cite la machine par son nom tel qu'il figure dans le JSON.
Réponds uniquement en appelant l'outil ${NOM_OUTIL}.`;

/** Les chiffres d'une machine, tels qu'envoyés au modèle. Rien d'autre (pas de description, pas de technicien). */
export function donneesMachine(stats, machine, libelles) {
  const nom = (code) => (code === A_CLASSER ? A_CLASSER.toLowerCase() : libelles.get(code) ?? code);
  const rang = stats.top.find((t) => t.machine === machine.machine)?.rang ?? null;
  return {
    machine: machine.machine,
    ligne: machine.ligne,
    // Ni période ni total usine : ils sont dans l'en-tête du rapport, et chaque nombre en moins resserre le contrôle.
    nb_interventions: machine.nbInterventions,
    temps_arret_total_min: machine.totalMin,
    part_du_temps_arret_usine_pct: machine.partDuTotalPct,
    rang_dans_le_top3: rang,
    seuil_panne_repetee: stats.seuilRepetition,
    nb_categories_en_panne_repetee: stats.pannesRepetees.filter((p) => p.machine === machine.machine).length,
    par_categorie: Object.entries(machine.parCategorie)
      .map(([code, c]) => ({ categorie: nom(code), nb_interventions: c.nb, minutes: c.minutes }))
      .sort((a, b) => b.minutes - a.minutes || a.categorie.localeCompare(b.categorie, 'fr')),
    pannes_repetees: stats.pannesRepetees
      .filter((p) => p.machine === machine.machine)
      .map((p) => ({ categorie: nom(p.categorie), nb_interventions: p.nb, minutes: p.minutes })),
  };
}

/** Noms contenant des chiffres (« M03 Ébarbeuse 1 », « M03 », « Ligne 1 ») que le contrôle doit ignorer. */
export function identifiantsDuParc(machines) {
  return [...new Set(machines.flatMap((m) => [m.machine, m.machine.split(' ')[0], m.ligne]))];
}

/**
 * Fait rédiger le bilan d'une machine, contrôle les chiffres cités, fait réécrire si besoin.
 * Lève une erreur après MAX_ESSAIS tentatives incohérentes.
 */
export async function redigerBilanMachine(donnees, identifiants, options = {}) {
  const { appelerOutil = appelerOutilParDefaut, maxEssais = MAX_ESSAIS } = options;
  let probleme = null;

  for (let essai = 1; essai <= maxEssais; essai++) {
    let message = JSON.stringify(donnees, null, 1);
    if (probleme) {
      message += `\n\nTa version précédente a été rejetée : ${probleme}. Réécris le bilan en respectant strictement les règles.`;
    }

    let reponse;
    try {
      reponse = await appelerOutil({ systeme: SYSTEME, outil: OUTIL, message, maxTokens: 4000 });
    } catch (err) {
      if (!(err instanceof ErreurReponseModele)) throw err;
      probleme = err.message;
      continue;
    }

    const bilan = String(reponse?.bilan ?? '').trim();
    const points = (Array.isArray(reponse?.points_a_etudier) ? reponse.points_a_etudier : [])
      .map((p) => String(p).trim())
      .filter(Boolean);
    if (!bilan) {
      probleme = 'le bilan était vide';
      continue;
    }

    const controle = verifierChiffres([bilan, ...points], donnees, identifiants);
    if (controle.ok) return { bilan, points, essais: essai };
    probleme = `ces nombres n'existent pas dans les données fournies : ${controle.inconnus.join(', ')}`;
  }

  throw new Error(
    `Bilan de ${donnees.machine} : chiffres incohérents après ${maxEssais} essais (${probleme}). `
      + 'Le rapport n\'a pas été généré.',
  );
}

/** Exécute `fn` sur chaque élément avec au plus `limite` appels simultanés ; conserve l'ordre. */
async function enParallele(elements, limite, fn) {
  const resultats = new Array(elements.length);
  let suivant = 0;
  const travailleur = async () => {
    while (suivant < elements.length) {
      const i = suivant++;
      resultats[i] = await fn(elements[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, elements.length) }, travailleur));
  return resultats;
}

/**
 * Bilan de chaque machine. Les machines sans intervention reçoivent un texte fixe, sans appel au modèle.
 * @returns {Promise<Array<{machine, ligne, bilan, points, essais}>>} dans l'ordre de stats.parMachine
 */
export async function redigerBilans(stats, categories, options = {}) {
  const { concurrence = 4, surProgression = () => {}, ...reste } = options;
  const libelles = new Map(categories.map((c) => [c.code, c.libelle]));
  const identifiants = identifiantsDuParc(stats.parMachine);
  const aRediger = stats.parMachine.filter((m) => m.nbInterventions > 0);
  let faits = 0;

  return enParallele(stats.parMachine, concurrence, async (m) => {
    if (m.nbInterventions === 0) {
      return { machine: m.machine, ligne: m.ligne, bilan: 'Aucune intervention sur la période.', points: [], essais: 0 };
    }
    const r = await redigerBilanMachine(donneesMachine(stats, m, libelles), identifiants, reste);
    surProgression(++faits, aRediger.length, m.machine, r.essais);
    return { machine: m.machine, ligne: m.ligne, ...r };
  });
}
