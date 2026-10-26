#!/bin/bash
# Solar ERP - automatic setup on a VPS (Ubuntu 22.04/24.04).   Usage:  sudo bash deploy.sh [your-domain.com]
set -e
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo:  sudo bash deploy.sh"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/solar-erp
IP="$(curl -4 -s https://api.ipify.org)"
DOMAIN="${1:-${IP//./-}.sslip.io}"     # no domain? a free sslip.io name is used (with HTTPS)

echo ">> 1/6 System update and required packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y curl ca-certificates gnupg ufw debian-keyring debian-archive-keyring apt-transport-https

echo ">> 2/6 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
fi

echo ">> 3/6 Copy app (data folder is preserved)"
mkdir -p $APP
cp -r "$SRC/server.js" "$SRC/backup.js" "$SRC/package.json" "$SRC/public" $APP/
mkdir -p $APP/data

echo ">> 4/6 Auto-start service"
cat > /etc/systemd/system/solar-erp.service <<UNIT
[Unit]
Description=Solar Shop ERP
After=network.target
[Service]
WorkingDirectory=$APP
Environment=PORT=3000
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node $APP/server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now solar-erp && systemctl restart solar-erp

echo ">> 5/6 HTTPS (Caddy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl restart caddy

echo ">> 6/6 Firewall and daily backup"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
echo "30 2 * * * root cd $APP && /usr/bin/node backup.js >> /var/log/solar-backup.log 2>&1" > /etc/cron.d/solar-backup

sleep 3
echo
echo "=========================================================="
echo " Done!  Open your software here:"
echo "     https://$DOMAIN"
echo " Login: admin / admin123   (CHANGE THE PASSWORD IMMEDIATELY)"
echo " Daily backup at 2:30 AM:  $APP/data/backups"
echo "=========================================================="
