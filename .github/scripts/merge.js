#!/usr/bin/env node
/*
 * The changes of an account sent by the app (repository_dispatch "sync"), merged into users/<account>.json.
 * Usage: node merge.js <event json> <users dir> [now ms]. Prints "changed" when the file was written (the workflow then commits it).
 *
 * The file: { v, rev, created, updated, seen, auth (SHA-256 of the account's write key), check (encrypted by the app: a wrong password
 * cannot read it), fails: { day, count }, items: { <id>: { t, d, x, c } } }. Every item is encrypted by the app; here only its time (t),
 * device (d) and removal (x) are read: the newer one of each id is kept (same time: the larger device name, so every run agrees).
 * A wrong write key counts as a failure; after MAX_FAILS in a day the account takes no more changes until the next day.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FAILS = 5;
const MAX_ITEMS = 2000; // per event
const MAX_ITEM = 100000; // characters of one encrypted item
const MAX_FILE = 8 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{32,64}$/;
const DEVICE = /^[\w-]{1,32}$/;
const B64 = /^[A-Za-z0-9+/=]*$/;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The payload as the app sends it, checked; null when it is not one. */
function readPayload(event) {
  const p = event && event.client_payload;
  if (!p || typeof p !== 'object') return null;
  if (!HEX64.test(p.account || '') || !HEX64.test(p.auth || '')) return null;
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length > MAX_ITEMS) return null;
  const valid = items.every(
    (it) =>
      it &&
      ID.test(it.i || '') &&
      Number.isInteger(it.t) &&
      it.t > 0 &&
      DEVICE.test(it.d || '') &&
      typeof it.x === 'boolean' &&
      typeof it.c === 'string' &&
      it.c.length <= MAX_ITEM &&
      B64.test(it.c),
  );
  if (!valid) return null;
  const check = p.create && typeof p.create.check === 'string' && p.create.check.length <= 2000 && B64.test(p.create.check) ? p.create.check : null;
  return { account: p.account, auth: p.auth, items, create: check ? { check } : null };
}

/** Merges a payload into the account's file (or creates it). Returns { file, changed, reason }. */
function merge(current, payload, now) {
  const today = dayOf(now);
  if (!current) {
    if (!payload.create) return { file: null, changed: false, reason: 'no such account' };
    current = { v: 1, rev: 0, created: new Date(now).toISOString(), updated: null, seen: today, auth: sha256(payload.auth), check: payload.create.check, fails: { day: today, count: 0 }, items: {} };
  } else {
    const fails = current.fails && current.fails.day === today ? current.fails.count : 0;
    if (fails >= MAX_FAILS) return { file: current, changed: false, reason: 'too many failures today' };
    if (sha256(payload.auth) !== current.auth) {
      current.fails = { day: today, count: fails + 1 };
      return { file: current, changed: true, reason: 'wrong key' };
    }
  }
  let changed = !current.updated && current.rev === 0;
  const maxTime = now + 24 * 3600 * 1000; // a device clock far ahead does not win for ever
  payload.items.forEach((it) => {
    const t = Math.min(it.t, maxTime);
    const old = current.items[it.i];
    if (old && (old.t > t || (old.t === t && old.d >= it.d))) return;
    current.items[it.i] = it.x ? { t, d: it.d, x: true, c: '' } : { t, d: it.d, x: false, c: it.c };
    changed = true;
  });
  if (changed) {
    current.rev += 1;
    current.updated = new Date(now).toISOString();
  }
  if (current.seen !== today) {
    current.seen = today; // the account is in use (cleanup.js)
    changed = true;
  }
  return { file: current, changed, reason: changed ? 'merged' : 'nothing new' };
}

function main() {
  const [eventPath, usersDir, nowArg] = process.argv.slice(2);
  const now = Number(nowArg) || Date.now();
  const payload = readPayload(JSON.parse(fs.readFileSync(eventPath, 'utf8')));
  if (!payload) {
    console.log('invalid payload: ignored');
    return;
  }
  const target = path.join(usersDir, `${payload.account}.json`);
  const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
  const { file, changed, reason } = merge(current, payload, now);
  console.log(`${payload.account.slice(0, 12)}…: ${reason}, ${payload.items.length} items sent`);
  if (!changed) return;
  const text = `${JSON.stringify(file)}\n`;
  if (text.length > MAX_FILE) {
    console.log('file too large: not written');
    return;
  }
  fs.mkdirSync(usersDir, { recursive: true });
  fs.writeFileSync(target, text);
  console.log('changed');
}

if (require.main === module) main();
module.exports = { readPayload, merge, MAX_FAILS };
