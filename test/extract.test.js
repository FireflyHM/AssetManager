import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAssets, fromText, looksLikeSerial, splitSerials, matchHeader } from '../public/js/extract.js';

const pick = (rows) => rows.map(({ brand, model, serial }) => ({ brand, model, serial }));

test('reads a spreadsheet with brand, model and serial columns', () => {
  const { rows } = extractAssets({
    kind: 'grid',
    rows: [
      ['Delivery Order DO-1042'],
      [],
      ['No.', 'Brand', 'Model', 'Description', 'Qty', 'Serial Number'],
      ['1', 'Dell', 'PowerEdge R760', '2U rack server', '2', '7XK2Q93, 7XK2Q94'],
      ['2', 'Cisco', 'C9300-48P', 'Catalyst switch', '1', 'FOC2415X0AB'],
      ['', '', '', 'Total', '3', ''],
    ],
  });
  assert.deepEqual(pick(rows), [
    { brand: 'Dell', model: 'PowerEdge R760', serial: '7XK2Q93' },
    { brand: 'Dell', model: 'PowerEdge R760', serial: '7XK2Q94' },
    { brand: 'Cisco', model: 'C9300-48P', serial: 'FOC2415X0AB' },
  ]);
  assert.equal(rows[0].found.brand, 'read');
});

test('guesses the brand from the description when there is no brand column', () => {
  const { rows } = extractAssets({
    kind: 'grid',
    rows: [
      ['Item', 'Item Description', 'S/N'],
      ['1', 'HPE ProLiant DL380 Gen11', 'SGH331ABCD'],
    ],
  });
  assert.deepEqual(pick(rows), [{ brand: 'HPE', model: 'ProLiant DL380 Gen11', serial: 'SGH331ABCD' }]);
  assert.equal(rows[0].found.brand, 'guessed');
});

test('a row with only serials continues the item above', () => {
  const { rows } = extractAssets({
    kind: 'grid',
    rows: [
      ['Brand', 'Model', 'Serial'],
      ['Lenovo', 'ThinkSystem SR650 V3', 'J30A1B2C'],
      ['', '', 'J30A1B2D'],
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].model, 'ThinkSystem SR650 V3');
});

test('reads label: value text from a scanned delivery order', () => {
  const rows = fromText([
    'Supplier: Acme Systems Pte Ltd',
    'Brand: Fortinet   Model: FortiGate 200F',
    'Serial No: FG200FT922901234',
    'S/N: FG200FT922901235',
  ]);
  assert.deepEqual(pick(rows), [
    { brand: 'Fortinet', model: 'FortiGate 200F', serial: 'FG200FT922901234' },
    { brand: 'Fortinet', model: 'FortiGate 200F', serial: 'FG200FT922901235' },
  ]);
});

test('builds columns from positioned words (PDF or OCR)', () => {
  const w = (text, x0, width = text.length * 6) => ({ text, x0, x1: x0 + width, h: 10 });
  const { rows, fields } = extractAssets({
    kind: 'positioned',
    lines: [
      { words: [w('Vendor:', 40), w('Acme', 90), w('Systems', 122)] },
      { words: [w('Brand', 40), w('Model', 140), w('Serial', 320), w('No.', 358)] },
      { words: [w('Dell', 40), w('PowerEdge', 140), w('R660', 202), w('9QW2LM3', 320)] },
      { words: [w('Cisco', 40), w('C9300-48P', 140), w('FOC2415X0AC', 320)] },
    ],
  });
  assert.deepEqual(pick(rows), [
    { brand: 'Dell', model: 'PowerEdge R660', serial: '9QW2LM3' },
    { brand: 'Cisco', model: 'C9300-48P', serial: 'FOC2415X0AC' },
  ]);
  assert.equal(fields.vendor, 'Acme Systems');
});

test('keeps an equipment row whose serial is unreadable, with the serial blank', () => {
  const { rows } = extractAssets({
    kind: 'grid',
    rows: [
      ['Make', 'Model', 'Qty', 'Serial No.'],
      ['NetApp', 'AFF A250', '1', '721934000123'],
      ['NetApp', 'DS224C Shelf', '1', '~ ='],
      ['', '', 'Total', '2'],
    ],
  });
  assert.deepEqual(pick(rows), [
    { brand: 'NetApp', model: 'AFF A250', serial: '721934000123' },
    { brand: 'NetApp', model: 'DS224C Shelf', serial: '' },
  ]);
  assert.equal(rows[1].found.serial, 'missing');
});

test('flags OCR words read with low confidence for checking', () => {
  const w = (text, x0, conf) => ({ text, x0, x1: x0 + text.length * 6, h: 10, conf });
  const { rows } = extractAssets({
    kind: 'positioned',
    lines: [
      { words: [w('Make', 40, 96), w('Model', 140, 96), w('Serial', 320, 96)] },
      { words: [w('Cisco', 40, 95), w('N9K-C93180YC-FX', 140, 89), w('"FDO24310ABC', 320, 0)] },
      { words: [w('Cisco', 40, 95), w('N9K-C93180YC-FX', 140, 89), w('FDO24310ABD', 320, 92)] },
    ],
  });
  assert.deepEqual(rows.map((r) => [r.serial, r.found.serial]), [
    ['FDO24310ABC', 'guessed'],
    ['FDO24310ABD', 'read'],
  ]);
});

test('notices a table row that OCR could not read at all', () => {
  const w = (text, x0) => ({ text, x0, x1: x0 + text.length * 6, h: 10, conf: 95 });
  const line = (y, ...words) => ({ y, words });
  const { rows, missedRows } = extractAssets({
    kind: 'positioned',
    lines: [
      line(100, w('Make', 40), w('Model', 140), w('Serial', 320)),
      line(130, w('Vertiv', 40), w('APM150', 140), w('APM1509921B', 320)),
      line(160, w('Eaton', 40), w('93PM', 140), w('EA93P5003341', 320)),
      // a folded row at y=190 left no text
      line(220, w('APC', 40), w('AP8853', 140), w('ZA2341005600', 320)),
      line(600, w('Received', 40), w('by', 100)),
    ],
  });
  assert.equal(rows.length, 3);
  assert.equal(missedRows, 1);
});

test('serial checks reject words, dates and placeholders', () => {
  for (const s of ['7XK2Q93', 'FOC2415X0AB', 'SGH331ABCD', 'CN-0ABC12']) assert.ok(looksLikeSerial(s), s);
  for (const s of ['N/A', 'TBC', 'Total', '2026-10-21', '12/10/2026', 'abc', 'Received']) {
    assert.ok(!looksLikeSerial(s), s);
  }
  assert.deepEqual(splitSerials('Received in good condition by John 1'), []);
});

test('a header needs a serial column plus brand or model', () => {
  assert.equal(matchHeader(['Serial', 'Qty']), null);
  assert.deepEqual(matchHeader(['Make', 'Model No', 'S/N']), {
    serial: 2,
    brand: 0,
    model: 1,
    brandInModel: false,
  });
});
