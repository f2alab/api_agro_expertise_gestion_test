// Configuration PM2 (production) - GAE ERP
//
// Usage :
//   npm install -g pm2
//   pm2 start ecosystem.config.js          # démarre l'API en cluster
//   pm2 logs gae-api                        # journaux
//   pm2 reload gae-api                      # rechargement sans coupure
//   pm2 startup ; pm2 save                  # démarrage automatique
//
// Pourquoi PM2 en plus du mode cluster intégré (CLUSTER_WORKERS) :
//   * redémarrage automatique en cas de plantage ;
//   * rechargement à chaud (une instance à la fois) lors d'un déploiement ;
//   * supervision mémoire/CPU par processus.
// N'utilisez QUE l'un des deux mécanismes : si PM2 gère le cluster, laissez
// CLUSTER_WORKERS=0 dans le .env (sinon chaque instance PM2 créerait à son tour
// autant de processus que de cœurs).
module.exports = {
  apps: [
    {
      name: 'gae-api',
      script: 'index.js',
      cwd: __dirname,
      // 'max' = un processus par cœur disponible
      instances: 'max',
      exec_mode: 'cluster',
      wait_ready: false,
      max_memory_restart: '600M',
      kill_timeout: 8000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        // Le cluster est géré par PM2 : ne pas surdimensionner les connexions
        // PostgreSQL (chaque instance ouvre DB_POOL_MAX connexions + 1 pour
        // l'écoute du canal temps réel).
        DB_POOL_MAX: 20,
        CLUSTER_WORKERS: 0,
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
