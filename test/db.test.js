import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';

const dell = { brand: 'Dell', model: 'PowerEdge R760', serial: '7XK2Q93', location: 'DC1 Rack A01' };

test('add, search, edit and remove an asset', () => {
  const store = openDatabase(':memory:');
  const a = store.create(dell, 'Sam');
  assert.equal(store.list({ q: 'r760' }).length, 1);
  assert.equal(store.list({ q: 'rack a01 dell' }).length, 1);
  assert.equal(store.list({ q: 'cisco' }).length, 0);

  const edited = store.update(a.id, { ...dell, location: 'DC2 Rack B07' }, a.version, 'Lee');
  assert.equal(edited.location, 'DC2 Rack B07');
  assert.equal(edited.version, 2);

  const removed = store.remove(a.id, 'Decommissioned', edited.version, 'Lee');
  assert.equal(removed.status, 'removed');
  assert.equal(store.list({}).length, 0);
  assert.equal(store.list({ status: 'removed' }).length, 1);

  const history = store.history({ assetId: a.id });
  assert.deepEqual(history.map((h) => h.action), ['removed', 'edited', 'added']);
  assert.deepEqual(history[1].changes, { location: ['DC1 Rack A01', 'DC2 Rack B07'] });
});

test('refuses a serial number that is already on the list', () => {
  const store = openDatabase(':memory:');
  store.create(dell, 'Sam');
  assert.throws(() => store.create({ ...dell, serial: ' 7xk2q93 ' }, 'Sam'), { status: 409 });
});

test('refuses a stale edit', () => {
  const store = openDatabase(':memory:');
  const a = store.create(dell, 'Sam');
  store.update(a.id, { ...dell, notes: 'first' }, a.version, 'Sam');
  assert.throws(() => store.update(a.id, { ...dell, notes: 'second' }, a.version, 'Lee'), { status: 409 });
});

test('requires brand, model and serial', () => {
  const store = openDatabase(':memory:');
  assert.throws(() => store.create({ brand: 'Dell', model: 'R760' }, 'Sam'), { status: 400 });
  assert.throws(() => store.create({ ...dell, warranty_end: '31/12/2027' }, 'Sam'), { status: 400 });
});

test('import adds all rows or none', () => {
  const store = openDatabase(':memory:');
  store.create(dell, 'Sam');
  const rows = [
    { brand: 'Cisco', model: 'C9300-48P', serial: 'FOC2415X0AB' },
    { brand: 'Dell', model: 'PowerEdge R760', serial: '7XK2Q93' },
  ];
  assert.throws(() => store.importRows(null, rows, 'Sam'), { status: 409 });
  assert.equal(store.counts().active, 1);
  const added = store.importRows(null, rows.slice(0, 1), 'Sam');
  assert.equal(added.length, 1);
  assert.equal(store.counts().active, 2);
});

test('replace removes the old asset, adds the new one, and links them', () => {
  const store = openDatabase(':memory:');
  const old = store.create({ ...dell, hostname: 'web-01', maintenance: 'MA-2026-01' }, 'Sam');
  const { old: gone, asset } = store.replace(
    old.id,
    { brand: 'HPE', model: 'ProLiant DL380 Gen11', serial: 'SGH331ZZZZ', hostname: 'web-01', location: 'DC1 Rack A01' },
    'Failed: motherboard',
    old.version,
    'Lee',
  );
  assert.equal(gone.status, 'removed');
  assert.match(gone.removed_reason, /Failed: motherboard\. Replaced by HPE ProLiant DL380 Gen11 \(SGH331ZZZZ\)/);
  assert.equal(gone.replaced_by.id, asset.id);
  assert.equal(asset.replaces.serial, '7XK2Q93');
  assert.deepEqual(store.list({}).map((a) => a.serial), ['SGH331ZZZZ']);
  assert.deepEqual(store.history({ assetId: old.id }).map((h) => h.action), ['replaced', 'added']);
  assert.match(store.history({ assetId: asset.id })[0].reason, /Replaces Dell PowerEdge R760 \(7XK2Q93\)/);
});

test('replace is all or nothing', () => {
  const store = openDatabase(':memory:');
  const old = store.create(dell, 'Sam');
  store.create({ brand: 'Cisco', model: 'C9300-48P', serial: 'FOC2415X0AB' }, 'Sam');
  // The new serial is already on the list, so nothing changes.
  assert.throws(
    () => store.replace(old.id, { brand: 'Cisco', model: 'C9300-48P', serial: 'foc2415x0ab' }, 'Failed', old.version, 'Sam'),
    { status: 409 },
  );
  assert.equal(store.get(old.id).status, 'active');
  assert.throws(() => store.replace(old.id, { brand: 'HPE', model: 'DL380', serial: 'SGH1' }, '', old.version, 'Sam'), {
    status: 400,
  });
  assert.throws(() => store.replace(old.id, { brand: 'HPE', model: 'DL380', serial: 'SGH1' }, 'Failed', 99, 'Sam'), {
    status: 409,
  });
});

test('a removed serial can be added again', () => {
  const store = openDatabase(':memory:');
  const a = store.create(dell, 'Sam');
  store.remove(a.id, 'Returned to vendor', a.version, 'Sam');
  assert.ok(store.create(dell, 'Sam').id);
  assert.throws(() => store.restore(a.id, 'Sam'), { status: 409 });
});
