// Daily backup: node backup.js  (keeps the last 14 copies in data/backups)
const { DatabaseSync } = require('node:sqlite'); const fs = require('fs'), path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, 'data'), out = path.join(dir, 'backups');
fs.mkdirSync(out, { recursive: true });
const f = path.join(out, `solar-${new Date().toISOString().slice(0, 10)}.db`);
if (fs.existsSync(f)) fs.unlinkSync(f);
new DatabaseSync(path.join(dir, 'solar.db')).exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
fs.readdirSync(out).sort().slice(0, -14).forEach(x => fs.unlinkSync(path.join(out, x)));
console.log('Backup created:', f);
