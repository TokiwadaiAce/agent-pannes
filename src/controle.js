// Étape S4 du BPMN : chaque nombre cité par le modèle doit exister dans les chiffres calculés par le code.
// Module pur, sans I/O ni LLM.

const ESPACES = '[ \\u00a0\\u202f]'; // espace, insécable, fine insécable (séparateurs de milliers en français)
// « 1 410 », « 38,4 », « 38.4 », « 120 ». Les nombres groupés sont essayés d'abord.
const NOMBRE = new RegExp(`\\d{1,3}(?:${ESPACES}\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?`, 'g');
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// Nombres écrits en lettres : le modèle s'en sert parfois pour compter lui-même (« quatre catégories »).
// « un/une » (articles) et « neuf » (« un joint neuf ») sont exclus pour éviter les faux positifs.
const EN_LETTRES = {
  deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, onze: 11,
  douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20,
};
const MOT_NOMBRE = new RegExp(`(?<!\\p{L})(${Object.keys(EN_LETTRES).join('|')})(?!\\p{L})`, 'giu');

const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const versNombre = (texte) => Number(texte.replace(new RegExp(ESPACES, 'g'), '').replace(',', '.'));

/**
 * Tous les nombres présents dans les données fournies au modèle : valeurs numériques,
 * plus jour, mois et année des dates (le modèle peut écrire « du 1er au 31 mars 2026 »).
 */
export function nombresAutorises(donnees) {
  const autorises = new Set();
  const parcourir = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) autorises.add(v);
    else if (typeof v === 'string' && DATE_ISO.test(v)) v.match(DATE_ISO).slice(1).forEach((p) => autorises.add(Number(p)));
    else if (Array.isArray(v)) v.forEach(parcourir);
    else if (v && typeof v === 'object') Object.values(v).forEach(parcourir);
  };
  parcourir(donnees);
  return autorises;
}

/**
 * Extrait les nombres cités dans un texte, après avoir retiré les noms qui contiennent des chiffres
 * (« M03 Presse 1 », « Ligne 2 ») : ce sont des identifiants, pas des chiffres du bilan.
 */
export function extraireNombres(texte, identifiants = []) {
  let nettoye = texte;
  // Les plus longs d'abord, pour retirer « M03 Presse 1 » avant « M03 ».
  for (const id of [...identifiants].sort((a, b) => b.length - a.length)) {
    nettoye = nettoye.replace(new RegExp(echapperRegex(id), 'gi'), ' ');
  }
  return [...nettoye.matchAll(NOMBRE)].map((m) => m[0]);
}

/**
 * @param {string[]} textes textes rédigés par le modèle
 * @param {object} donnees JSON envoyé au modèle
 * @param {string[]} identifiants noms de machines, de lignes… à ignorer
 * @returns {{ ok: boolean, cites: string[], inconnus: string[] }}
 */
export function verifierChiffres(textes, donnees, identifiants = []) {
  const autorises = nombresAutorises(donnees);
  const estAutorise = (n) => autorises.has(n);
  const cites = [];
  const inconnus = [];

  for (const texte of textes) {
    for (const brut of extraireNombres(texte, identifiants)) {
      cites.push(brut);
      if (estAutorise(versNombre(brut))) continue;
      // « les 3 100 min » : lu comme 3100, mais peut-être « 3 » puis « 100 ». Accepté si chaque morceau existe.
      const morceaux = brut.split(new RegExp(ESPACES));
      if (morceaux.length > 1 && morceaux.every((m) => estAutorise(versNombre(m)))) continue;
      inconnus.push(brut);
    }
    for (const [mot] of texte.matchAll(MOT_NOMBRE)) {
      cites.push(mot);
      if (!estAutorise(EN_LETTRES[mot.toLowerCase()])) inconnus.push(mot);
    }
  }
  return { ok: inconnus.length === 0, cites, inconnus: [...new Set(inconnus)] };
}
