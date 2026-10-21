# Asset Manager

A web app that keeps the data centre asset list current. It's built from the first version of both product briefs:

- **[Product brief 1](PRODUCT_BRIEF_1.md)**: upload vendor documents (PDF, Excel, CSV, JPG/PNG scans, or a ZIP of them), check the brand, model and serial number the app read beside the document, fix any gaps, then add the rows to one standard list.
- **[Product brief 2](PRODUCT_BRIEF_2.md)**: anyone on the team can search for an asset, edit it, add a new one or remove one. The app shows clearly what is about to change and refuses entries that would make the list wrong.

## Run it

You need [Node.js](https://nodejs.org) 22.13 or newer.

```bash
npm install
npm start
```

Then open http://localhost:3000. The list is stored in `data/assets.db`, a SQLite file, and uploaded documents in `data/uploads/`. Back up the `data/` folder to keep the list.

Settings are read from environment variables, or from a `.env` file in the project folder. Copy `.env.example` to start one. `.env` is not committed to Git.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port the app listens on |
| `DATA_DIR` | `./data` | Where the list and uploaded documents are kept |
| `OPENCODE_API_KEY` | *(empty)* | Turns on AI reading (see below). Leave empty to keep it off |
| `AI_MODEL` | `deepseek-v4.1-flash` | Model used for AI reading |
| `AI_BASE_URL` | `https://opencode.ai/inference/go/openai/v1` | OpenAI-compatible API address |

## AI reading (optional)

The app reads documents with its own rules by default, and nothing leaves the machine. AI reading is an extra for documents the rules can't handle: unusual layouts, serials inside paragraphs, poor scans. It uses [OpenCode Go](https://opencode.ai/docs/go/) with DeepSeek V4.1 Flash.

**Turning it on:** put an OpenCode Go API key in `.env` as `OPENCODE_API_KEY=...` and restart the app. A **Read with AI** button then appears on each document on the **Add from documents** screen. The key stays on the server and is never sent to the browser.

**What happens when someone clicks it:**
1. The app asks first, naming the document and the outside service. Nothing is sent without that confirmation.
2. The server sends the text the app already read from the document to OpenCode Go. For scans, it also sends page images, scaled to at most 1344 px. If the service refuses images, the app retries with text only.
3. The model returns brand, model and serial rows, which go into the same review as always:
   - values the model wasn't sure of are amber, with its note under the row;
   - any serial that doesn't appear in the text the app read is amber too, because it may be a correction of an OCR misreading, or a mistake;
   - **Undo** puts the app's own reading back.

**Data policy:** AI reading sends document contents (equipment, serial numbers, vendor and project names) to a third party. Check that your organisation allows this before adding a key. Without a key, the app makes no outside calls.

**OpenCode Go's terms:** its docs describe it as "designed for OpenCode and other coding agents", and ask clients to send "typical coding agent traffic". Reading delivery documents isn't that, so check this use is acceptable before relying on it. Because the request is a standard OpenAI-compatible one, another provider can be used by changing `AI_BASE_URL`, `AI_MODEL` and the key. The app sends the `x-opencode-session` header and its own user agent, as OpenCode Go asks; other providers ignore them.

**Tested on 21 October 2026** against the real service with the samples in `samples/`:
- **Clean documents** were read correctly in a few seconds each.
- **Damaged scans:**
  - On the coffee-stain scan, it completed the truncated serial and read the stained one.
  - On the faded fax, it corrected every OCR misreading.
  - On the torn page, it recovered the row lost under the fold.
  - In each case the corrected values were amber, with a note explaining the change.
- **Unrelated documents** came back empty, each with an explanation.
- **One request failed** with a temporary "Endpoint is unavailable" error (429) from OpenCode Go. Trying again a few minutes later worked.

The server code is in [src/ai.js](src/ai.js) and the browser side in [public/js/ai.js](public/js/ai.js). The tests in `test/ai.test.js` use a fake service, so they need no key.

## Using it

**Add from documents**
1. Drop one or more vendor documents onto the page. A ZIP file is unpacked in the browser, including folders and zips inside it. Each document inside becomes its own entry, marked with the zip it came from, and files of other types are skipped and listed. A zip can hold up to 200 documents and 300 MB in total. The original zip isn't stored: each document's source is recorded as `zip name › document name`.
2. The app reads each one in the browser. Spreadsheets and PDFs with text are read directly. Scans (JPG/PNG, or PDFs without text) go through OCR, which takes longer and needs a closer check.
3. Check each row against the document shown beside it. Red fields weren't found. Amber fields are uncertain: OCR had low confidence, or the value was guessed, for example a brand worked out from the model name or carried down from the row above. A row whose serial can't be read is kept with the serial blank rather than dropped. Separate warnings appear when a scanned table seems to be missing a row, when an image file is incomplete, and when a document has nothing relevant in it. Damaged or mislabelled files get a plain explanation instead of a technical error. Project, vendor, location, warranty end and maintenance agreement apply to every row from that document.
4. **Add N assets to the list** stays disabled until every row has a brand, model and serial number, and no serial number is repeated or already on the list.

**Asset list**
- Search matches brand, model, serial, hostname, location, project, vendor, maintenance agreement and notes.
- Filters: assets not on a maintenance agreement, and warranties that have ended or end within 90 days.
- Click a row to edit it. Before anything is saved you see exactly what changes (old → new) and confirm it.
- Removing an asset requires a reason. Removed assets go to the **Removed** tab and can be put back.
- **Replace…** swaps an asset for a different one, for example after a failure or an upgrade, even if the brand and model differ. You give a reason and the new asset's details. Hostname, location, project, vendor and maintenance agreement are copied from the old asset; warranty and notes start blank. A confirmation shows the old and new values side by side. The old asset then moves to Removed and the new one is added in a single step, and each links to the other.
- If two people edit the same asset at once, the second save is refused instead of silently overwriting the first.
- **Download list** exports the standard list as Excel or CSV.

**Change history** records who added, edited, removed or put back each asset, and when. The app asks for your name the first time you open it in a browser.

## How documents are read

`public/js/readers.js` turns each file into rows of text with positions. It uses [SheetJS](https://sheetjs.com) for spreadsheets, [PDF.js](https://mozilla.github.io/pdf.js/) for PDFs, [Tesseract.js](https://tesseract.projectnaptha.com) for OCR and [fflate](https://github.com/101arrowz/fflate) for unpacking zips (`public/js/zip.js`). All of these are served from `node_modules`, so the app works on a network that blocks public CDNs.

`public/js/extract.js` then:
- finds a table heading with a serial column plus a brand and/or model column (`Brand`, `Make`, `Manufacturer`, `Model`, `Part No`, `Description`, `S/N`, `Serial No.`, …),
- splits cells that hold several serial numbers and carries a model over to the next row when that row holds only more serial numbers,
- otherwise reads `Label: value` text such as `Model: FortiGate 200F  S/N: FG200F…`,
- guesses the brand from the model name when there is no brand column,
- picks up `Vendor:`/`Supplier:` and `Project:` for the whole document.

## Samples and tests

`samples/` holds made-up documents of four kinds: clean vendor documents in every supported format, damaged ones (stained, faded, torn, cut-off or corrupted files), unrelated ones that should produce nothing, and zips mixing all of these. [samples/README.md](samples/README.md) lists what each file tests, what the app currently does with it, and how to rebuild the set.

```bash
npm test
```

## Not built yet

Leaving these out follows the briefs:
- comparing this year's list with last year's,
- renewal reminders for maintenance agreements,
- automatic updates to the maintenance agreement itself,
- logins. Names are self-reported, which is enough for a history on a trusted internal network but is not access control.
