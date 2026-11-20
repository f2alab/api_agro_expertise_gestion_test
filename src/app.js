
// Construction de l'application Express.
// Séparé du démarrage du serveur pour faciliter les tests d'intégration.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env.js';
import { limiteurGeneral } from './middlewares/limiteRequetes.js';
import { gestionnaireErreurs, routeIntrouvable } from './middlewares/gestionErreurs.js';
import { logger } from './utils/logger.js';
import routes from './routes/index.js';

export function creerApplication() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // En-têtes de sécurité HTTP (XSS, sniffing, clickjacking...)
  app.use(helmet());

  // CORS : seules les origines déclarées dans .env sont acceptées
  app.use(
    cors({
      origin: config.cors.origines,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Journalisation des requêtes (méthode, URL, statut, durée)
  app.use((req, res, next) => {
    const debut = Date.now();
    res.on('finish', () => {
      logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - debut} ms)`);
    });
    next();
  });

  // Page d'accueil de l'API (documentation minimale)
  app.get('/', (_req, res) => {
    res.json({
      succes: true,
      donnees: {
        application: config.nomApplication,
        version: '1.0.0',
        documentation: '/api/sante',
        endpoints: [
          'POST   /api/auth/connexion',
          'POST   /api/auth/rafraichir',
          'POST   /api/auth/deconnexion',
          'GET    /api/auth/moi',
          'PUT    /api/auth/moi/photo',
          'DELETE /api/auth/moi/photo',
          'GET    /api/utilisateurs',
          'GET    /api/utilisateurs/:id/photo',
          'PUT    /api/utilisateurs/:id/photo',
          'GET    /api/roles',
          'GET    /api/permissions',
          'GET    /api/departements',
          'GET    /api/journal-audit',
          'GET    /api/tableau-de-bord',
          'GET    /api/temps-reel/flux',
          'GET    /api/temps-reel/etat',
        ],
      },
    });
  });

  // Toutes les routes métier sont préfixées par /api et limitées en débit
  app.use('/api', limiteurGeneral, routes);

  // 404 puis gestionnaire d'erreurs global (toujours en dernier)
  app.use(routeIntrouvable);
  app.use(gestionnaireErreurs);

  return app;
}