# Solar Shop ERP

Stock, godowns, goods received, dispatch / GST invoices, employees and salary for a solar shop.

## Run on a computer (Windows / Mac / Linux)
Needs Node.js 22+ (https://nodejs.org). No `npm install` required.

    cd solar-erp
    node server.js

Open http://localhost:3000 — first login: **admin / admin123** (change it in Settings).
`localhost` works only on the same computer. On the same WiFi use `http://<computer-IP>:3000`
(allow port 3000 in Windows Firewall).

## Run on the internet (VPS, Ubuntu 22.04/24.04)

    unzip solar-erp-vps.zip && cd solar-erp
    sudo bash deploy.sh                 # or: sudo bash deploy.sh yourdomain.com

This installs Node, HTTPS (Caddy), an auto-restart service, a firewall and a daily backup.
With no domain, a free `https://<ip>.sslip.io` address is used.

## Updating
Re-run `sudo bash deploy.sh` with the new files. Data in `/opt/solar-erp/data` is never touched.
Anything entered in the software (products, bills, settings, staff) is stored on the server,
so it shows up on every phone/PC after a refresh.

## Data and backup
Everything is in `data/solar.db` (SQLite). Daily backups (VPS): `/opt/solar-erp/data/backups`.
Settings -> Download Backup gives a copy at any time.
