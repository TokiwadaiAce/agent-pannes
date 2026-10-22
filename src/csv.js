import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Chemins résolus depuis la racine du projet : l'application marche quel que soit le dossier courant.
export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHEMINS = {
  journal: join(RACINE, 'data', 'journal.csv'),
  journalEnrichi: join(RACINE, 'data', 'journal_enrichi.csv'),
  categories: join(RACINE, 'data', 'categories.csv'),
  machines: join(RACINE, 'data', 'machines.csv'),
  rapport: join(RACINE, 'out', 'bilan_revue.md'),
};

export const COLONNES = {
  journal: ['id', 'date', 'ligne', 'machine', 'description', 'duree_arret_min', 'categorie'],
  categories: ['code', 'libelle', 'description'],
  machines: ['ligne', 'machine'],
};

/** Lit un CSV avec en-têtes et vérifie que les colonnes attendues sont présentes. */
export async function lireCsv(chemin, colonnesAttendues) {
  let contenu;
  try {
    contenu = await readFile(chemin, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Fichier introuvable : ${chemin}. Lancez d'abord « npm run seed ».`);
    }
    throw new Error(`Impossible de lire ${chemin} : ${err.message}`);
  }

  let lignes;
  try {
    lignes = parse(contenu, { columns: true, bom: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    throw new Error(`CSV mal formé (${chemin}) : ${err.message}`);
  }

  const entete = Object.keys(lignes[0] ?? {});
  // Fichier ne contenant que l'en-tête : parse renvoie [], on relit la première ligne.
  const colonnesPresentes = entete.length ? entete : contenu.replace(/^﻿/, '').split(/\r?\n/)[0].split(',');
  const manquantes = colonnesAttendues.filter((c) => !colonnesPresentes.includes(c));
  if (manquantes.length) {
    throw new Error(`Colonnes manquantes dans ${chemin} : ${manquantes.join(', ')}`);
  }
  return lignes;
}

/** Écrit (ou remplace) un CSV complet, en-tête compris. */
export async function ecrireCsv(chemin, lignes, colonnes) {
  await mkdir(dirname(chemin), { recursive: true });
  await writeFile(chemin, stringify(lignes, { header: true, columns: colonnes }), 'utf8');
}

/** Ajoute une ligne en fin de CSV existant, sans réécrire le reste. */
export async function ajouterLigneCsv(chemin, ligne, colonnes) {
  // Un fichier réenregistré par un tableur peut ne pas finir par un saut de ligne : sans ce test,
  // la nouvelle ligne serait collée à la dernière.
  const contenu = await readFile(chemin, 'utf8');
  const prefixe = contenu.length && !contenu.endsWith('\n') ? '\n' : '';
  await appendFile(chemin, prefixe + stringify([ligne], { header: false, columns: colonnes }), 'utf8');
}

// --- Fichiers métier -------------------------------------------------------

export const lireMachines = () => lireCsv(CHEMINS.machines, COLONNES.machines);
export const lireCategories = () => lireCsv(CHEMINS.categories, COLONNES.categories);

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function estDateValide(texte) {
  if (!FORMAT_DATE.test(texte)) return false;
  const d = new Date(`${texte}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texte;
}

export function estEntierPositif(texte) {
  return /^\d+$/.test(String(texte)) && Number(texte) > 0;
}

/**
 * Lit le journal et valide chaque champ.
 * Renvoie les interventions typées (id et durée en nombres). Lève une erreur listant les lignes invalides.
 */
export async function lireJournal(chemin = CHEMINS.journal) {
  const lignes = await lireCsv(chemin, COLONNES.journal);
  const erreurs = [];
  const idsVus = new Set();

  const interventions = lignes.map((l, i) => {
    const numLigne = i + 2; // +1 pour l'en-tête, +1 car les lignes d'un fichier commencent à 1
    if (!estEntierPositif(l.id)) erreurs.push(`ligne ${numLigne} : id invalide « ${l.id} »`);
    else if (idsVus.has(l.id)) erreurs.push(`ligne ${numLigne} : id ${l.id} en double`);
    idsVus.add(l.id);
    if (!estDateValide(l.date)) erreurs.push(`ligne ${numLigne} : date invalide « ${l.date} »`);
    if (!l.ligne) erreurs.push(`ligne ${numLigne} : ligne de production vide`);
    if (!l.machine) erreurs.push(`ligne ${numLigne} : machine vide`);
    if (!l.description) erreurs.push(`ligne ${numLigne} : description vide`);
    if (!estEntierPositif(l.duree_arret_min)) {
      erreurs.push(`ligne ${numLigne} : durée invalide « ${l.duree_arret_min} »`);
    }
    return { ...l, id: Number(l.id), duree_arret_min: Number(l.duree_arret_min) };
  });

  if (erreurs.length) {
    const apercu = erreurs.slice(0, 10).join('\n  - ');
    const reste = erreurs.length > 10 ? `\n  … et ${erreurs.length - 10} autre(s)` : '';
    throw new Error(`Journal invalide (${chemin}) :\n  - ${apercu}${reste}`);
  }
  return interventions;
}

export async function ajouterIntervention(intervention) {
  await ajouterLigneCsv(CHEMINS.journal, intervention, COLONNES.journal);
}

export async function ecrireJournalEnrichi(interventions) {
  await ecrireCsv(CHEMINS.journalEnrichi, interventions, COLONNES.journal);
}
