#!/bin/bash
# One-time / update deploy for webhook demo on the droplet.
# No new domain, no GitHub Actions — just port 3005 next to main app on 3001.
#
# On the droplet — pick ONE approach:
#
# A) Same repo, no second clone (if /var/www/jmg-dashboard already exists):
#    cd /var/www/jmg-dashboard
#    git fetch origin webhook-demo
#    git worktree add /var/www/jmg-webhook-demo webhook-demo
#    bash /var/www/jmg-webhook-demo/deploy/setup-webhook-demo.sh
#
# B) Separate public repo (no GitHub login on server):
#    git clone https://github.com/YOUR_USER/Bpl-JMG-Webhook-Demo.git /var/www/jmg-webhook-demo
#    bash /var/www/jmg-webhook-demo/deploy/setup-webhook-demo.sh
#
# C) Upload from your PC (if fetch fails on droplet):
#    scp -r ./BPL-Chevron-Dashboard root@DROPLET_IP:/var/www/jmg-webhook-demo
#    then SSH in and run this script.
#
# Do NOT use: curl raw.githubusercontent.com — private repos return 404.

set -e

APP_DIR=/var/www/jmg-webhook-demo
MAIN_ENV=/var/www/jmg-dashboard/.env
REPO=https://github.com/ipinnu/Bpl-JMG-Dashboard.git
BRANCH=webhook-demo
PORT=3005

PUBLIC_IP=$(curl -sf ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo "==> Webhook demo deploy (port ${PORT})"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "==> Cloning ${BRANCH} into ${APP_DIR}"
  git clone -b "$BRANCH" "$REPO" "$APP_DIR"
else
  echo "==> Updating ${APP_DIR}"
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  if [ -f "$MAIN_ENV" ]; then
    echo "==> Copying env from main dashboard"
    cp "$MAIN_ENV" .env
  else
    echo "ERROR: No .env found. Copy one to ${APP_DIR}/.env first (need API_SECRET, VITE_*, MIX_WEBHOOK_SECRET, Clerk keys)."
    exit 1
  fi
fi

# Ensure demo port + webhook URL shown in UI (IP only — no extra domain)
grep -q '^PORT=' .env && sed -i "s/^PORT=.*/PORT=${PORT}/" .env || echo "PORT=${PORT}" >> .env
grep -q '^WEBHOOK_PUBLIC_URL=' .env && sed -i "s|^WEBHOOK_PUBLIC_URL=.*|WEBHOOK_PUBLIC_URL=http://${PUBLIC_IP}:${PORT}/api/mix-webhook|" .env || echo "WEBHOOK_PUBLIC_URL=http://${PUBLIC_IP}:${PORT}/api/mix-webhook" >> .env

echo "==> npm install + build"
npm install
npm run build

echo "==> pm2"
if pm2 describe jmg-webhook-demo >/dev/null 2>&1; then
  pm2 restart deploy/ecosystem.webhook-demo.config.cjs
else
  pm2 start deploy/ecosystem.webhook-demo.config.cjs
fi
pm2 save

if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow "${PORT}/tcp" 2>/dev/null || true
fi

sleep 2
curl -sf "http://127.0.0.1:${PORT}/api/mix-webhook/health" && echo "" || echo "WARN: health check failed — run: pm2 logs jmg-webhook-demo"

echo ""
echo "=========================================="
echo "  Webhook demo: http://${PUBLIC_IP}:${PORT}"
echo "  Health:       http://${PUBLIC_IP}:${PORT}/api/mix-webhook/health"
echo "  Main dashboard unchanged on port 3001"
echo "=========================================="
echo "Clerk: add http://${PUBLIC_IP}:${PORT} to allowed origins if sign-in fails."
