// Étape S5 du BPMN : assemble la note de revue. Tous les tableaux viennent des chiffres calculés ;
// seuls les paragraphes « bilan » et les points à étudier viennent du modèle (déjà contrôlés).
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CHEMINS } from './csv.js';
import { A_CLASSER } from './stats.js';

const nombre = (n) => n.toLocaleString('fr-FR');
const pct = (n) => `${n.toLocaleString('fr-FR')} %`;
const dateLongue = (iso) =>
  new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .replace(/^1 /, '1er ');

function tableau(entetes, lignes, alignements) {
  const sep = alignements.map((a) => (a === 'd' ? '---:' : '---'));
  return [entetes, sep, ...lignes].map((l) => `| ${l.join(' | ')} |`).join('\n');
}

/**
 * @param {object} p
 * @param {object} p.stats résultat de calculerStats
 * @param {Array} p.categories référentiel (ordre des colonnes)
 * @param {Array<{machine, ligne, bilan, points}>} p.bilans
 * @param {Array} p.aClasser interventions marquées « à classer manuellement »
 * @param {string} p.modele nom du modèle utilisé
 * @param {string} p.genereLe date de génération (AAAA-MM-JJ)
 */
export function genererRapport({ stats, categories, bilans, aClasser = [], modele, genereLe }) {
  const libelles = new Map(categories.map((c) => [c.code, c.libelle]));
  // Colonnes : les catégories présentes, dans l'ordre du référentiel, puis « à classer » s'il y en a.
  const colonnes = [...categories.map((c) => c.code), A_CLASSER].filter((code) => stats.parCategorie[code]);
  const entete = (code) => (code === A_CLASSER ? 'À classer' : code);
  const nomCategorie = (code) => (code === A_CLASSER ? A_CLASSER.toLowerCase() : libelles.get(code) ?? code);
  const cellule = (c) => (c ? nombre(c.minutes) : '–');

  const md = [];
  md.push('# Bilan des pannes de maintenance', '');
  if (stats.periode) {
    md.push(`**Période :** du ${dateLongue(stats.periode.debut)} au ${dateLongue(stats.periode.fin)}  `);
  }
  md.push(`**Interventions :** ${nombre(stats.nbInterventions)}  `);
  md.push(`**Temps d'arrêt total :** ${nombre(stats.totalMin)} min  `);
  md.push(`**Généré le :** ${dateLongue(genereLe)}`, '');

  md.push('## Temps d\'arrêt par machine et par catégorie (minutes)', '');
  md.push(
    tableau(
      ['Machine', 'Ligne', ...colonnes.map(entete), '**Total**', 'Part'],
      [
        ...stats.parMachine.map((m) => [
          m.machine,
          m.ligne,
          ...colonnes.map((code) => cellule(m.parCategorie[code])),
          `**${nombre(m.totalMin)}**`,
          pct(m.partDuTotalPct),
        ]),
        ['**Total**', '', ...colonnes.map((code) => `**${cellule(stats.parCategorie[code])}**`), `**${nombre(stats.totalMin)}**`, pct(100)],
      ],
      ['g', 'g', ...colonnes.map(() => 'd'), 'd', 'd'],
    ),
  );
  md.push('', `Légende : ${colonnes.filter((c) => c !== A_CLASSER).map((c) => `${c} = ${libelles.get(c)}`).join(', ')}.`, '');

  md.push('## Top 3 des machines les plus touchées', '');
  md.push(
    tableau(
      ['Rang', 'Machine', 'Ligne', 'Arrêt (min)', 'Interventions', 'Part du total'],
      stats.top.map((t) => [t.rang, t.machine, t.ligne, nombre(t.totalMin), t.nbInterventions, pct(t.partDuTotalPct)]),
      ['d', 'g', 'g', 'd', 'd', 'd'],
    ),
    '',
  );

  md.push(`## Pannes répétées (au moins ${stats.seuilRepetition} fois sur une même machine)`, '');
  if (stats.pannesRepetees.length) {
    md.push(
      tableau(
        ['Machine', 'Ligne', 'Catégorie', 'Interventions', 'Arrêt (min)'],
        stats.pannesRepetees.map((p) => [p.machine, p.ligne, nomCategorie(p.categorie), p.nb, nombre(p.minutes)]),
        ['g', 'g', 'g', 'd', 'd'],
      ),
      '',
    );
  } else {
    md.push('Aucune panne répétée sur la période.', '');
  }

  md.push('## Bilan par machine', '');
  for (const b of bilans) {
    md.push(`### ${b.machine} (${b.ligne})`, '', b.bilan, '');
  }

  md.push('## Points à étudier', '');
  md.push('_Pistes proposées pour examen par le responsable maintenance. Ce ne sont pas des décisions._', '');
  const avecPoints = bilans.filter((b) => b.points.length);
  if (avecPoints.length) {
    for (const b of avecPoints) {
      md.push(`**${b.machine}**`, '', ...b.points.map((p) => `- ${p}`), '');
    }
  } else {
    md.push('Aucun point proposé.', '');
  }

  if (aClasser.length) {
    md.push('## Interventions à classer manuellement', '');
    md.push(...aClasser.map((i) => `- n° ${i.id} (${i.date}, ${i.machine}) : ${i.description}`), '');
  }

  md.push('---', '');
  md.push(
    `_Chiffres et tableaux calculés par le programme. Textes rédigés par le modèle ${modele}, `
      + 'puis contrôlés : chaque nombre cité existe dans les chiffres calculés._',
  );
  return md.join('\n') + '\n';
}

export async function ecrireRapport(contenu) {
  await mkdir(dirname(CHEMINS.rapport), { recursive: true });
  await writeFile(CHEMINS.rapport, contenu, 'utf8');
  return CHEMINS.rapport;
}
