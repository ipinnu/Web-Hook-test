/** PM2 — webhook demo on port 3005 (separate from main dashboard on 3001) */
module.exports = {
  apps: [
    {
      name: 'jmg-webhook-demo',
      script: 'server.js',
      cwd: '/var/www/jmg-webhook-demo',
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
    },
  ],
}
