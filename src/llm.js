// Seul module qui parle à l'API Anthropic. Les autres modules lui passent un outil (schéma JSON)
// et reçoivent l'objet que le modèle a rempli, ou une erreur avec un message en français.
import Anthropic from '@anthropic-ai/sdk';

let client;

/** Le modèle a répondu, mais pas comme demandé (refus, réponse tronquée, outil non utilisé) : on peut retenter. */
export class ErreurReponseModele extends Error {}

function config() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim();
  if (!apiKey) throw new Error('Clé API manquante : renseignez ANTHROPIC_API_KEY dans le fichier .env.');
  if (!model) throw new Error('Modèle manquant : renseignez ANTHROPIC_MODEL dans le fichier .env.');
  // Le SDK relance lui-même les erreurs passagères (réseau, 429, 5xx) : 3 tentatives supplémentaires.
  client ??= new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  return { model };
}

function traduireErreur(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error('Clé API refusée (401) : vérifiez ANTHROPIC_API_KEY dans .env.');
  if (err instanceof Anthropic.PermissionDeniedError) return new Error('Accès refusé par l\'API (403) : la clé n\'a pas les droits nécessaires.');
  if (err instanceof Anthropic.NotFoundError) return new Error(`Modèle introuvable (404) : vérifiez ANTHROPIC_MODEL dans .env (${process.env.ANTHROPIC_MODEL}).`);
  if (err instanceof Anthropic.RateLimitError) return new Error('Trop de requêtes (429), même après plusieurs essais : réessayez dans quelques minutes.');
  if (err instanceof Anthropic.BadRequestError) return new Error(`Requête refusée par l'API (400) : ${err.message}`);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new Error('L\'API ne répond pas (délai dépassé) : réessayez plus tard.');
  if (err instanceof Anthropic.APIConnectionError) return new Error('Impossible de joindre l\'API Anthropic : vérifiez la connexion réseau.');
  if (err instanceof Anthropic.APIError) return new Error(`Erreur de l'API (${err.status ?? 'inconnue'}) : ${err.message}`);
  return err;
}

/**
 * Envoie un message et attend que le modèle appelle l'outil fourni.
 * Renvoie l'argument de l'appel d'outil (objet déjà parsé par le SDK).
 * Lève une erreur si le modèle refuse, est coupé, ou répond sans appeler l'outil.
 */
export async function appelerOutil({ systeme, message, outil, maxTokens = 16000, effort = 'low' }) {
  const { model } = config();

  let reponse;
  try {
    reponse = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systeme,
      // `auto` + consigne + `strict` plutôt qu'un appel d'outil forcé, que les modèles récents refusent (400).
      tool_choice: { type: 'auto' },
      tools: [{ ...outil, strict: true }],
      output_config: { effort },
      messages: [{ role: 'user', content: message }],
    });
  } catch (err) {
    throw traduireErreur(err);
  }

  if (reponse.stop_reason === 'refusal') {
    throw new ErreurReponseModele('Le modèle a refusé de traiter la demande.');
  }
  if (reponse.stop_reason === 'max_tokens') {
    throw new ErreurReponseModele('Réponse du modèle tronquée (limite de longueur atteinte).');
  }
  const appel = reponse.content.find((b) => b.type === 'tool_use' && b.name === outil.name);
  if (!appel) {
    throw new ErreurReponseModele(`Le modèle a répondu sans utiliser l'outil « ${outil.name} ».`);
  }
  return appel.input;
}
