#!/usr/bin/env node
/*
 * Daily cleanup of the accounts (cleanup.yml): an account not used for INACTIVE_DAYS days is removed, and one created without any data
 * after EMPTY_DAYS days. Usage: node cleanup.js <users dir> [now ms]. Prints the files removed.
 */
const fs = require('fs');
const path = require('path');

const INACTIVE_DAYS = 30;
const EMPTY_DAYS = 1;
const DAY = 24 * 3600 * 1000;

function expired(file, now) {
  const seen = Date.parse(`${file.seen || ''}T00:00:00Z`) || Date.parse(file.updated || '') || Date.parse(file.created || '') || 0;
  if (now - seen > INACTIVE_DAYS * DAY) return 'inactive';
  const empty = !file.items || !Object.keys(file.items).length;
  if (empty && now - (Date.parse(file.created || '') || 0) > EMPTY_DAYS * DAY) return 'empty';
  return '';
}

function main() {
  const [usersDir, nowArg] = process.argv.slice(2);
  const now = Number(nowArg) || Date.now();
  if (!fs.existsSync(usersDir)) return;
  fs.readdirSync(usersDir)
    .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
    .forEach((name) => {
      const full = path.join(usersDir, name);
      let reason = '';
      try {
        reason = expired(JSON.parse(fs.readFileSync(full, 'utf8')), now);
      } catch {
        reason = 'unreadable';
      }
      if (reason) {
        fs.rmSync(full);
        console.log(`removed ${name.slice(0, 12)}… (${reason})`);
      }
    });
}

if (require.main === module) main();
module.exports = { expired };
