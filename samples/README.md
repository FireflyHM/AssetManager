# Sample documents

These are made-up vendor documents for trying the **Add from documents** screen and checking changes to how documents are read. Every company, serial number and person in them is invented.

To try one, drop it, or a whole folder's worth, onto the import screen. The **Result** column shows what the app did with each file when it was last checked (21 October 2026).

How to read the results:
- **All correct**: every row was read with the right brand, model and serial, and nothing is flagged.
- **Red**: the value is missing. The app won't add the rows until it's filled in or the row is removed.
- **Amber**: the app isn't sure, either because OCR had low confidence or because it guessed the value. It doesn't block adding, so someone must compare it with the document.

## Clean documents

| File | What it tests | Result |
| --- | --- | --- |
| `DO-1042 Acme Systems.xlsx` | Spreadsheet with a title block above the table, two serials in one cell, and a total row | 5 rows, all correct |
| `PO-7781 Northwind IT.pdf` | PDF with no brand column (brand comes from the description), and a serial wrapped onto the next line | 5 rows, all correct; brands amber (guessed from the model) |
| `DO-2215 Contoso Power (scan).jpg` | Clean scan read with OCR, slightly tilted | 5 rows, all correct; brand and model of the last row amber (carried down from the row above) |
| `more-formats/DO-4471 Dell direct (old Excel).xls` | Old `.xls` format; Dell "Service Tag" instead of serial number | 3 rows, all correct |
| `more-formats/DO-5102 Northwind (2 pages).pdf` | Table running across two pages, with the heading repeated | 34 rows, all correct |
| `more-formats/IR-889 Initech install report (no table).pdf` | No table at all: `Brand: … Model: … Serial No: …` lines | 3 rows, all correct |
| `more-formats/PL-5520 Globex packing list.csv` | CSV with `Manufacturer`, `Part No`, `S/N` headings and three serials in one cell | 5 rows, all correct |
| `more-formats/Project handover pack.xlsx` | Workbook where the equipment is on the third sheet, after a cover and a contact list | 5 rows, all correct; project read from the cover |

## Damaged documents

| File | What's wrong with it | Result |
| --- | --- | --- |
| `damaged/DO-3307 Meridian (coffee stain).jpg` | A stain covers one serial and blurs the one above; the scan is tilted and speckled | 4 rows. The covered serial is **red**; the one above was read as `72193` (really `721934000123`) and is **amber**, as is the serial beside the stain |
| `damaged/DO-3307 Meridian (scanned to PDF).pdf` | The same scan inside a PDF with no text layer | Same as above |
| `damaged/DO-3310 Orion (faded fax).jpg` | Faint grey text, low resolution, heavy compression | 3 rows, every value red or amber. OCR misreads include `RH3122…` for `XH3122…` and `FGI00…` for `FG100…`. This is the case where checking matters most |
| `damaged/CD-0412 Contoso (torn page).png` | A fold line wipes out one row; the page is torn through the last row | 2 rows correct, plus 1 all-amber row from the torn edge. A warning says one row couldn't be read at all |
| `damaged/DO-2215 Contoso (half downloaded).jpg` | The image file stops partway, so the bottom of the page is grey | 1 garbled amber row, plus a warning that the file is incomplete |
| `damaged/DO-5102 Northwind (download cut off).pdf` | The PDF download stopped at 60% | Can't be read; message asks for a new copy |
| `damaged/DO-6002 Acme (corrupted).xlsx` | Spreadsheet contents overwritten with junk | Can't be read; message asks for a new copy |
| `damaged/DO-6004 (not really a PDF).pdf` | A "link expired" text message saved with a `.pdf` name | Message says it isn't a real PDF and shows the text inside |

## Unrelated documents

These should produce no assets. Each shows "nothing relevant found" and suggests removing the document.

| File | Why it's a trap |
| --- | --- |
| `unrelated/INV-2290 office supplies invoice.pdf` | An invoice with an Item / Description / Qty table, but no serials |
| `unrelated/Meeting minutes 14 Oct.pdf` | Mentions "serial number", "model" and "SN: N/A" in sentences |
| `unrelated/Staff leave roster.xlsx` | A table with ID-like `Staff No` values |
| `unrelated/Rack photo.jpg` | A picture of equipment with no text |
| `unrelated/Whiteboard notes.jpg` | Handwriting-style text about other things |

## Zips

| File | Contents | Result |
| --- | --- | --- |
| `October deliveries.zip` | The three top-level clean samples: one in a folder, one inside a second zip, plus a `.txt` | 3 documents opened, `Read me.txt` skipped |
| `Mixed batch (good, damaged, unrelated).zip` | Two clean files, the coffee-stain scan, the corrupted spreadsheet, the invoice, the rack photo, and a `.gif` | 6 documents opened, the `.gif` skipped; each behaves as in the tables above |

## Rebuilding them

On Windows, from the project folder:

```bash
powershell -ExecutionPolicy Bypass -File scripts/make-sample-scan.ps1
```

```bash
powershell -ExecutionPolicy Bypass -File scripts/make-sample-scans.ps1
```

```bash
npm run samples
```

The PowerShell scripts draw the scanned images, and `npm run samples` builds everything else. Close any sample that's open in Excel or a PDF viewer first, or the script will skip it and keep the old copy.
