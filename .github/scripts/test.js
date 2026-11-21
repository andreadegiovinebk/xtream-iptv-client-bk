// node --test .github/scripts/test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { readPayload, merge, MAX_FAILS } = require('./merge.js');
const { expired } = require('./cleanup.js');

const hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ACCOUNT = hex('account');
const AUTH = hex('auth');
const NOW = Date.parse('2026-11-20T10:00:00Z');
const item = (i, t, d = 'tv1', x = false) => ({ i: hex(i).slice(0, 32), t, d, x, c: x ? '' : 'QUJD' });
const payload = (extra) => readPayload({ client_payload: { account: ACCOUNT, auth: AUTH, items: [], ...extra } });

test('payloads are checked', () => {
  assert.strictEqual(readPayload({ client_payload: { account: 'x', auth: AUTH } }), null);
  assert.strictEqual(payload({ items: [{ i: 'zz', t: 1, d: 'tv', x: false, c: '' }] }), null);
  assert.strictEqual(payload({ items: [{ ...item('a', 1), c: '<script>' }] }), null);
  assert.ok(payload({ items: [item('a', 1)] }));
});

test('an account is created only when asked', () => {
  assert.strictEqual(merge(null, payload({ items: [item('a', 1)] }), NOW).file, null);
  const { file, changed } = merge(null, payload({ create: { check: 'Q0hL' }, items: [item('a', 1)] }), NOW);
  assert.ok(changed);
  assert.strictEqual(file.auth, hex(AUTH));
  assert.strictEqual(file.rev, 1);
  assert.strictEqual(Object.keys(file.items).length, 1);
});

test('the newer item wins; same time: the larger device; removals kept', () => {
  let { file } = merge(null, payload({ create: { check: 'Q0hL' }, items: [item('a', 100), item('b', 100, 'tv1')] }), NOW);
  ({ file } = merge(file, payload({ items: [item('a', 50, 'tv2'), item('b', 100, 'tv2'), item('c', 1, 'tv2', true)] }), NOW));
  const id = (s) => hex(s).slice(0, 32);
  assert.strictEqual(file.items[id('a')].t, 100);
  assert.strictEqual(file.items[id('b')].d, 'tv2');
  assert.deepStrictEqual(file.items[id('c')], { t: 1, d: 'tv2', x: true, c: '' });
  assert.strictEqual(file.rev, 2);
});

test('a time far in the future is cut to one day ahead', () => {
  const { file } = merge(null, payload({ create: { check: 'Q0hL' }, items: [item('a', NOW * 2)] }), NOW);
  assert.strictEqual(Object.values(file.items)[0].t, NOW + 24 * 3600 * 1000);
});

test('a wrong key counts; after the limit nothing is taken that day, also with the right key', () => {
  let { file } = merge(null, payload({ create: { check: 'Q0hL' } }), NOW);
  const wrong = readPayload({ client_payload: { account: ACCOUNT, auth: hex('other'), items: [item('a', 5)] } });
  for (let i = 0; i < MAX_FAILS; i += 1) {
    const r = merge(file, wrong, NOW);
    assert.strictEqual(r.reason, 'wrong key');
    file = r.file;
  }
  assert.strictEqual(merge(file, payload({ items: [item('a', 5)] }), NOW).reason, 'too many failures today');
  assert.strictEqual(merge(file, payload({ items: [item('a', 5)] }), NOW + 24 * 3600 * 1000).reason, 'merged');
});

test('a visit without changes marks the account as used once a day', () => {
  let { file } = merge(null, payload({ create: { check: 'Q0hL' } }), NOW);
  assert.strictEqual(merge(file, payload({}), NOW).changed, false);
  ({ file } = merge(file, payload({}), NOW + 3 * 24 * 3600 * 1000));
  assert.strictEqual(file.seen, '2026-11-23');
});

test('cleanup: inactive for 30 days, or empty after a day', () => {
  const day = 24 * 3600 * 1000;
  assert.strictEqual(expired({ seen: '2026-10-01', created: '2026-01-01T00:00:00Z', items: { a: {} } }, NOW), 'inactive');
  assert.strictEqual(expired({ seen: '2026-11-19', created: '2026-11-18T00:00:00Z', items: {} }, NOW), 'empty');
  assert.strictEqual(expired({ seen: '2026-11-20', created: new Date(NOW - day / 2).toISOString(), items: {} }, NOW), '');
  assert.strictEqual(expired({ seen: '2026-11-19', created: '2026-01-01T00:00:00Z', items: { a: {} } }, NOW), '');
});
