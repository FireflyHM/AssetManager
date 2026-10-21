// Writes made-up vendor documents into samples/ for trying the import:
//   powershell -ExecutionPolicy Bypass -File scripts/make-sample-scan.ps1    (Windows)
//   powershell -ExecutionPolicy Bypass -File scripts/make-sample-scans.ps1   (Windows)
//   npm run samples
// The PowerShell scripts draw the scanned images; this script builds everything
// else, including PDFs and zips that reuse those images when they exist.
// samples/README.md lists what each file contains and what the app should do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { zipSync, strToU8 } from 'fflate';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');
for (const dir of ['', 'more-formats', 'damaged', 'unrelated']) fs.mkdirSync(path.join(out, dir), { recursive: true });

const file = (name) => path.join(out, name);
const exists = (name) => fs.existsSync(file(name));
const read = (name) => new Uint8Array(fs.readFileSync(file(name)));

// A sample that's open in Excel can't be overwritten; keep the old copy.
function save(name, data) {
  try {
    fs.writeFileSync(file(name), data);
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
    console.warn(`Skipped ${name}: it's open in another program.`);
  }
}

function sheetFile(name, sheets, bookType = 'xlsx') {
  const book = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  save(name, XLSX.write(book, { type: 'buffer', bookType }));
}

function pdfFile(name, draw, options = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, ...options });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const data = Buffer.concat(chunks);
      save(name, data);
      resolve(data);
    });
    draw(doc);
    doc.end();
  });
}

// Draws a simple table; returns the y position after the last row.
function table(doc, cols, head, rows, y, { rowHeight = 22 } = {}) {
  doc.rect(45, y - 6, 505, 22).fill('#e8eefc').fillColor('#000');
  doc.font('Helvetica-Bold');
  head.forEach((h, i) => doc.text(h, cols[i], y, { lineBreak: false }));
  doc.font('Helvetica');
  for (const row of rows) {
    y += rowHeight;
    row.forEach((cell, i) => doc.text(String(cell), cols[i], y, { lineBreak: false }));
    doc.moveTo(45, y + 15).lineTo(550, y + 15).strokeColor('#cccccc').stroke();
  }
  return y;
}

// ---------- Clean documents ----------

// 1. Spreadsheet delivery order, with a title block above the table.
sheetFile('DO-1042 Acme Systems.xlsx', {
  'Delivery Order': [
    ['ACME SYSTEMS PTE LTD'],
    ['Delivery Order', '', '', '', 'DO No:', 'DO-1042'],
    ['Project: DC1 Compute Refresh', '', '', '', 'Date:', '2026-09-14'],
    [],
    ['No.', 'Brand', 'Model', 'Description', 'Qty', 'Serial Number'],
    [1, 'Dell', 'PowerEdge R760', '2U rack server, 2x Xeon Gold 6430', 2, '7XK2Q93, 7XK2Q94'],
    [2, 'Dell', 'PowerEdge R660', '1U rack server', 1, '9QW2LM3'],
    [3, 'Cisco', 'C9300-48P', 'Catalyst 9300 48-port PoE+ switch', 1, 'FOC2415X0AB'],
    [4, 'APC', 'SRT6KRMXLI', 'Smart-UPS SRT 6000VA', 1, 'AS2338120456'],
    ['', '', '', 'Total', 5, ''],
    [],
    ['Received in good condition by: ____________'],
  ],
});

// 2. PDF completion document with a drawn table and no brand column.
await pdfFile('PO-7781 Northwind IT.pdf', (doc) => {
  doc.font('Helvetica-Bold').fontSize(18).text('NORTHWIND IT SOLUTIONS', 50, 50);
  doc.font('Helvetica').fontSize(10).text('12 Harbour Road, #04-01', 50, 74);
  doc.font('Helvetica-Bold').fontSize(14).text('COMPLETION DOCUMENT', 50, 110);
  doc.font('Helvetica').fontSize(10);
  doc.text('Vendor: Northwind IT Solutions', 50, 140);
  doc.text('Project: DR Site Network Upgrade', 50, 156);
  doc.text('PO Ref: PO-7781', 360, 140);
  doc.text('Date: 02 Oct 2026', 360, 156);
  const y = table(doc, [50, 90, 300, 345], ['Item', 'Item Description', 'Qty', 'S/N'], [
    ['1', 'HPE ProLiant DL380 Gen11', '1', 'SGH331ABCD'],
    ['2', 'HPE ProLiant DL380 Gen11', '1', 'SGH331ABCE'],
    ['3', 'Fortinet FortiGate 200F', '2', 'FG200FT922901234'],
    ['', '', '', 'FG200FT922901235'],
    ['4', 'Arista 7050SX3-48YC8', '1', 'JPE23401122'],
  ], 200, { rowHeight: 24 });
  doc.text('All equipment delivered and installed at DR site, Hall B.', 50, y + 50);
  doc.text('Accepted by: ______________________', 50, y + 90);
});

// ---------- More formats ----------

// 3. CSV packing list: different headings, several serials in one cell.
save(
  'more-formats/PL-5520 Globex packing list.csv',
  [
    'Packing List PL-5520,,,,,',
    'Supplier: Globex Technology,,,,,',
    ',,,,,',
    'Line,Manufacturer,Part No,Description,Qty,S/N',
    '1,Supermicro,SYS-621C-TN12R,GPU-ready 2U server,3,"S41922010441; S41922010442; S41922010443"',
    '2,Ubiquiti,USW-Pro-48,UniFi switch,1,F4E2C6A1B2C3',
    '3,Synology,RS2423RP+,Rackmount NAS,1,2290QPN712345',
  ].join('\r\n'),
);

// 4. Old-style .xls with Dell "Service Tag" instead of serial number.
sheetFile(
  'more-formats/DO-4471 Dell direct (old Excel).xls',
  {
    Sheet1: [
      ['Dell Technologies - Shipment Notification'],
      ['Order: DO-4471', '', 'Ship date: 2026-10-03'],
      [],
      ['Make', 'Model No', 'Service Tag', 'Qty'],
      ['Dell', 'PowerEdge R750xs', '5TQ8KX3', 1],
      ['Dell', 'PowerEdge R750xs', '5TQ8KX4', 1],
      ['Dell', 'PowerVault ME5024', 'HV2M8Q3', 1],
    ],
  },
  'biff8',
);

// 5. Handover pack: the equipment table is on the third sheet, after a cover
//    sheet and a contact list that have nothing the app needs.
sheetFile('more-formats/Project handover pack.xlsx', {
  Cover: [['PROJECT HANDOVER PACK'], ['Project: DC3 Fit-out Phase 1'], ['Prepared by: Initech Integration'], ['Revision: B']],
  Contacts: [
    ['Name', 'Role', 'Phone'],
    ['Jordan Lee', 'Project manager', '+65 6000 1001'],
    ['Priya Nair', 'Site engineer', '+65 6000 1002'],
  ],
  Equipment: [
    ['Brand', 'Model', 'Serial', 'Rack', 'Remarks'],
    ['Lenovo', 'ThinkSystem SR650 V3', 'J30A1B2C', 'R01', ''],
    ['Lenovo', 'ThinkSystem SR650 V3', 'J30A1B2D', 'R01', ''],
    ['Pure Storage', 'FlashArray//X20', 'PCTFL2316012F', 'R02', 'Controller A'],
    ['Pure Storage', 'FlashArray//X20', 'PCTFL2316013G', 'R02', 'Controller B'],
    ['Arista', '7280R3', 'JPE23409988', 'R03', ''],
  ],
});

// 6. Installation report written as "Label: value" text, no table at all.
await pdfFile('more-formats/IR-889 Initech install report (no table).pdf', (doc) => {
  doc.font('Helvetica-Bold').fontSize(16).text('INSTALLATION REPORT IR-889', 50, 50);
  doc.font('Helvetica').fontSize(10);
  doc.text('Vendor: Initech Integration', 50, 80);
  doc.text('Project: DC3 Fit-out Phase 1', 50, 95);
  let y = 130;
  const block = (lines) => {
    doc.rect(45, y - 6, 505, lines.length * 16 + 10).strokeColor('#bbbbbb').stroke();
    for (const l of lines) {
      doc.text(l, 55, y);
      y += 16;
    }
    y += 20;
  };
  block(['Equipment 1', 'Brand: Lenovo', 'Model: ThinkSystem SR630 V3', 'Serial No: J30C7781', 'Location: DC3 Hall 1, Rack R04, U20']);
  block(['Equipment 2', 'Brand: Lenovo', 'Model: ThinkSystem SR630 V3', 'Serial No: J30C7782', 'Location: DC3 Hall 1, Rack R04, U22']);
  block(['Equipment 3', 'Manufacturer: NetApp    Model: AFF A250    S/N: 721934009876']);
  doc.text('Engineer remarks: all units powered on and passed burn-in.', 50, y);
});

// 7. Two-page delivery order: the table carries on, heading repeated, on page 2.
await pdfFile('more-formats/DO-5102 Northwind (2 pages).pdf', (doc) => {
  const rows = [];
  for (let i = 1; i <= 34; i++) {
    const kind = i % 3 === 0 ? ['Cisco', 'C9200L-24T-4G', 'JAE2509'] : ['HPE', 'Aruba 6300M 48G', 'SG2C'];
    rows.push([String(i), kind[0], kind[1], '1', `${kind[2]}${String(1000 + i).padStart(5, '0')}`]);
  }
  const cols = [50, 90, 190, 380, 420];
  const head = ['No', 'Brand', 'Model', 'Qty', 'Serial No'];
  doc.font('Helvetica-Bold').fontSize(16).text('NORTHWIND IT SOLUTIONS - DELIVERY ORDER DO-5102', 50, 50);
  doc.font('Helvetica').fontSize(10).text('Vendor: Northwind IT Solutions     Project: Campus Access Switches', 50, 75);
  table(doc, cols, head, rows.slice(0, 26), 110);
  doc.addPage();
  doc.font('Helvetica').fontSize(10).text('DO-5102 (continued) - page 2 of 2', 50, 50);
  table(doc, cols, head, rows.slice(26), 80);
});

// ---------- Damaged ----------

const coffee = 'damaged/DO-3307 Meridian (coffee stain).jpg';
if (exists(coffee)) {
  // 8. The coffee-stained scan saved as a PDF with no text layer.
  await pdfFile('damaged/DO-3307 Meridian (scanned to PDF).pdf', (doc) => doc.image(file(coffee), 0, 0, { width: 595 }), { margin: 0 });
}

// 9. A PDF download that stopped partway: the second page is cut off.
{
  const whole = read('more-formats/DO-5102 Northwind (2 pages).pdf');
  save('damaged/DO-5102 Northwind (download cut off).pdf', whole.slice(0, Math.floor(whole.length * 0.6)));
}

// 10. A spreadsheet whose contents have been overwritten with junk.
{
  const bytes = read('DO-1042 Acme Systems.xlsx').slice();
  for (let i = 400; i < bytes.length - 400; i += 7) bytes[i] ^= 0x5a;
  save('damaged/DO-6002 Acme (corrupted).xlsx', bytes);
}

// 11. A scan that only half downloaded: the bottom of the image is missing.
const fullScan = 'DO-2215 Contoso Power (scan).jpg';
if (exists(fullScan)) {
  const bytes = read(fullScan);
  save('damaged/DO-2215 Contoso (half downloaded).jpg', bytes.slice(0, Math.floor(bytes.length * 0.45)));
}

// 12. A file named .pdf that is really a text file.
save('damaged/DO-6004 (not really a PDF).pdf', 'Your download link has expired. Please contact the sender.\r\n');

// ---------- Unrelated ----------

// 13. An invoice for office supplies: a table, but no serial numbers.
await pdfFile('unrelated/INV-2290 office supplies invoice.pdf', (doc) => {
  doc.font('Helvetica-Bold').fontSize(18).text('PAPERCLIP STATIONERS - TAX INVOICE', 50, 50);
  doc.font('Helvetica').fontSize(10).text('Invoice No: INV-2290     Date: 07 Oct 2026', 50, 80);
  const y = table(doc, [50, 90, 330, 380, 470], ['Item', 'Description', 'Qty', 'Unit Price', 'Amount'], [
    ['1', 'A4 copier paper, 80gsm (box of 5 reams)', '10', '32.00', '320.00'],
    ['2', 'Ballpoint pens, blue (box of 50)', '4', '12.50', '50.00'],
    ['3', 'Toner cartridge TN-2480', '6', '58.00', '348.00'],
    ['4', 'Whiteboard markers, assorted', '8', '6.90', '55.20'],
  ], 120);
  doc.text('Total: 773.20     Payment due within 30 days.', 50, y + 40);
});

// 14. Meeting minutes that mention serial numbers and models in passing.
await pdfFile('unrelated/Meeting minutes 14 Oct.pdf', (doc) => {
  doc.font('Helvetica-Bold').fontSize(16).text('Infrastructure team - meeting minutes', 50, 50);
  doc.font('Helvetica').fontSize(11).moveDown();
  for (const line of [
    'Date: 14 Oct 2026     Attendees: Jordan, Priya, Sam',
    '',
    '1. Support process: please quote the serial number of your device when calling the helpdesk.',
    '2. Asset list: the team agreed to try the new asset tool for one month.',
    '3. New model of laptop for engineers: TBC, waiting on quotes.',
    '4. Spare parts: SN: N/A for consumables; no need to record them.',
    '5. Next meeting: 28 Oct 2026, Room 4B.',
  ]) {
    doc.text(line, { width: 495 });
    doc.moveDown(0.4);
  }
});

// 15. A staff leave roster with "No." columns but nothing about equipment.
sheetFile('unrelated/Staff leave roster.xlsx', {
  Roster: [
    ['Staff No', 'Name', 'From', 'To', 'Type'],
    ['E10234', 'Jordan Lee', '2026-12-22', '2026-12-31', 'Annual'],
    ['E10288', 'Priya Nair', '2026-11-03', '2026-11-04', 'Medical'],
    ['E10302', 'Sam Tan', '2026-12-24', '2027-01-02', 'Annual'],
  ],
});

// ---------- Zips ----------

// 16. The first three documents as a vendor might email them.
{
  const files = {
    'DO-1042 Acme Systems.xlsx': read('DO-1042 Acme Systems.xlsx'),
    'Completion/PO-7781 Northwind IT.pdf': read('PO-7781 Northwind IT.pdf'),
    'Read me.txt': strToU8('Delivery documents for October.'),
  };
  if (exists(fullScan)) files['Scans.zip'] = zipSync({ [fullScan]: read(fullScan) });
  save('October deliveries.zip', zipSync(files));
}

// 17. A realistic mixed batch: good, damaged and unrelated files together.
{
  const pick = [
    'more-formats/PL-5520 Globex packing list.csv',
    'more-formats/IR-889 Initech install report (no table).pdf',
    'damaged/DO-3307 Meridian (coffee stain).jpg',
    'damaged/DO-6002 Acme (corrupted).xlsx',
    'unrelated/INV-2290 office supplies invoice.pdf',
    'unrelated/Rack photo.jpg',
  ].filter(exists);
  const files = Object.fromEntries(pick.map((p) => [p, read(p)]));
  files['Email signature logo.gif'] = new Uint8Array([71, 73, 70, 56, 57, 97]);
  save('Mixed batch (good, damaged, unrelated).zip', zipSync(files));
}

console.log(`Samples written to ${out}`);
