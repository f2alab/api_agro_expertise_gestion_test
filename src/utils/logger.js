
// Journalisation applicative minimaliste (console structurée).
// Suffisant pour le module IAM ; remplaçable par pino/winston en production.

const horodatage = () => new Date().toISOString();

const ecrire = (niveau, message, ...details) => {
  const ligne = `[${horodatage()}] [${niveau}] ${message}`;
  if (niveau === 'ERROR') console.error(ligne, ...details);
  else if (niveau === 'WARN') console.warn(ligne, ...details);
  else console.log(ligne, ...details);
};

export const logger = {
  info: (message, ...details) => ecrire('INFO', message, ...details),
  warn: (message, ...details) => ecrire('WARN', message, ...details),
  error: (message, ...details) => ecrire('ERROR', message, ...details),
  debug: (message, ...details) => ecrire('DEBUG', message, ...details),
};