import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { openDatabase, ASSET_FIELDS, FIELD_LABELS } from './src/db.js';
import { aiConfig, extractWithAi } from './src/ai.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const store = openDatabase(path.join(dataDir, 'assets.db'));
const app = express();
app.disable('x-powered-by');
// AI reading can carry page images; everything else stays small.
app.use('/api/ai/extract', express.json({ limit: '20mb' }));
app.use(express.json({ limit: '2mb' }));

// Front end and the document-reading libraries it loads, all served locally so
// the app keeps working on a network that blocks public CDNs.
const nm = (p) => path.join(root, 'node_modules', p);
app.use(express.static(path.join(root, 'public')));
app.use('/vendor/pdfjs', express.static(nm('pdfjs-dist/build')));
app.use('/vendor/xlsx', express.static(nm('xlsx')));
app.use('/vendor/fflate', express.static(nm('fflate/esm')));
app.use('/vendor/tesseract', express.static(nm('tesseract.js/dist')));
app.use('/vendor/tesseract-core', express.static(nm('tesseract.js-core')));
app.use('/vendor/tessdata', express.static(nm('@tesseract.js-data/eng/4.0.0_best_int')));

const ALLOWED_TYPES = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  defParamCharset: 'utf8',
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = Object.hasOwn(ALLOWED_TYPES, path.extname(file.originalname).toLowerCase());
    cb(ok ? null : Object.assign(new Error('Upload a PDF, Excel, CSV, JPG or PNG file.'), { status: 400 }), ok);
  },
});

const by = (req) => req.body?.by ?? req.get('x-user-name');

app.get('/api/assets', (req, res) => {
  const { q = '', status = 'active', filter = '' } = req.query;
  res.json({ assets: store.list({ q, status, filter }), counts: store.counts() });
});

app.get('/api/assets/:id', (req, res) => {
  res.json({ asset: store.get(req.params.id), history: store.history({ assetId: Number(req.params.id) }) });
});

app.post('/api/assets', (req, res) => {
  res.status(201).json({ asset: store.create(req.body.fields, by(req)) });
});

app.put('/api/assets/:id', (req, res) => {
  res.json({ asset: store.update(req.params.id, req.body.fields, req.body.version, by(req)) });
});

app.post('/api/assets/:id/remove', (req, res) => {
  res.json({ asset: store.remove(req.params.id, req.body.reason, req.body.version, by(req)) });
});

app.post('/api/assets/:id/replace', (req, res) => {
  res.status(201).json(store.replace(req.params.id, req.body.fields, req.body.reason, req.body.version, by(req)));
});

app.post('/api/assets/:id/restore', (req, res) => {
  res.json({ asset: store.restore(req.params.id, by(req)) });
});

app.post('/api/serials/check', (req, res) => {
  const serials = Array.isArray(req.body.serials) ? req.body.serials.map(String) : [];
  res.json({ existing: store.findBySerials(serials) });
});

app.post('/api/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const doc = store.addDocument(
    {
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mime: ALLOWED_TYPES[ext],
      size: req.file.size,
    },
    req.get('x-user-name'),
  );
  res.status(201).json({ document: doc });
});

app.get('/api/documents/:id/file', (req, res) => {
  const doc = store.getDocument(req.params.id);
  res.type(doc.mime);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(path.join(uploadDir, path.basename(doc.stored_name)));
});

app.post('/api/import', (req, res) => {
  const assets = store.importRows(req.body.documentId ?? null, req.body.rows, by(req));
  res.status(201).json({ assets });
});

// Optional AI reading (src/ai.js). Only offered when an API key is configured.
app.get('/api/ai/status', (_req, res) => {
  const { apiKey, model } = aiConfig();
  res.json({ enabled: Boolean(apiKey), model, provider: 'OpenCode Go' });
});

app.post('/api/ai/extract', async (req, res) => {
  const { fileName, text, images } = req.body ?? {};
  res.json(await extractWithAi({ fileName, text, images }));
});

app.get('/api/history', (req, res) => {
  res.json({ history: store.history({ limit: req.query.limit }) });
});

// The standard list: one row per active asset, same columns every time.
app.get('/api/export.:format', (req, res) => {
  const { format } = req.params;
  if (format !== 'csv' && format !== 'xlsx') return res.status(404).json({ error: 'Unknown format.' });
  const header = ['Asset ID', ...ASSET_FIELDS.map((f) => FIELD_LABELS[f]), 'Source document', 'Added', 'Last updated'];
  const rows = store.list({}).map((a) => [
    a.id,
    ...ASSET_FIELDS.map((f) => a[f]),
    a.source_doc_name ?? '',
    a.created_at.slice(0, 10),
    a.updated_at.slice(0, 10),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Assets');
  const stamp = new Date().toISOString().slice(0, 10);
  res.attachment(`asset-list-${stamp}.${format}`);
  res.send(XLSX.write(book, { type: 'buffer', bookType: format }));
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, _req, res, _next) => {
  const status = err.status ?? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 && !err.expose ? 'Something went wrong on the server.' : err.message,
    ...(err.details ?? {}),
  });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Asset Manager running at http://localhost:${port}`));
