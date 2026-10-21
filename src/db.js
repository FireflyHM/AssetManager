import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Fields a person can edit on an asset, in the order of the standard list.
export const ASSET_FIELDS = [
  'brand',
  'model',
  'serial',
  'hostname',
  'location',
  'project',
  'vendor',
  'warranty_end',
  'maintenance',
  'notes',
];

export const FIELD_LABELS = {
  brand: 'Brand',
  model: 'Model',
  serial: 'Serial number',
  hostname: 'Hostname / label',
  location: 'Location',
  project: 'Project',
  vendor: 'Vendor',
  warranty_end: 'Warranty end',
  maintenance: 'Maintenance agreement',
  notes: 'Notes',
};

const MAX_LENGTH = 500;

export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.status = 400;
    this.details = details;
  }
}

export class ConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.status = 409;
    this.details = details;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.status = 404;
  }
}

export function serialKey(serial) {
  return String(serial ?? '').trim().toUpperCase();
}

// Trims every field, checks the required ones and returns a clean copy.
export function cleanFields(input) {
  const out = {};
  for (const field of ASSET_FIELDS) {
    const value = input?.[field];
    out[field] = value == null ? '' : String(value).trim();
    if (out[field].length > MAX_LENGTH) {
      throw new ValidationError(`${FIELD_LABELS[field]} is too long (max ${MAX_LENGTH} characters).`, { field });
    }
  }
  if (!out.serial) throw new ValidationError('Serial number is required.', { field: 'serial' });
  if (!out.brand) throw new ValidationError('Brand is required.', { field: 'brand' });
  if (!out.model) throw new ValidationError('Model is required.', { field: 'model' });
  if (out.warranty_end && !isIsoDate(out.warranty_end)) {
    throw new ValidationError('Warranty end must be a date (YYYY-MM-DD).', { field: 'warranty_end' });
  }
  return out;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function cleanName(by) {
  const name = String(by ?? '').trim().slice(0, 100);
  return name || 'Unknown';
}

const now = () => new Date().toISOString();

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS documents (
      id            INTEGER PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      mime          TEXT NOT NULL,
      size          INTEGER NOT NULL,
      uploaded_by   TEXT NOT NULL,
      uploaded_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id             INTEGER PRIMARY KEY,
      brand          TEXT NOT NULL DEFAULT '',
      model          TEXT NOT NULL DEFAULT '',
      serial         TEXT NOT NULL,
      hostname       TEXT NOT NULL DEFAULT '',
      location       TEXT NOT NULL DEFAULT '',
      project        TEXT NOT NULL DEFAULT '',
      vendor         TEXT NOT NULL DEFAULT '',
      warranty_end   TEXT NOT NULL DEFAULT '',
      maintenance    TEXT NOT NULL DEFAULT '',
      notes          TEXT NOT NULL DEFAULT '',
      source_doc_id  INTEGER REFERENCES documents(id),
      status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
      removed_reason TEXT NOT NULL DEFAULT '',
      version        INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      serial_key     TEXT GENERATED ALWAYS AS (upper(trim(serial))) VIRTUAL
    );

    -- A serial number can only be on the active list once.
    CREATE UNIQUE INDEX IF NOT EXISTS assets_active_serial
      ON assets(serial_key) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS history (
      id          INTEGER PRIMARY KEY,
      asset_id    INTEGER NOT NULL REFERENCES assets(id),
      action      TEXT NOT NULL,
      changes     TEXT NOT NULL DEFAULT '{}',
      reason      TEXT NOT NULL DEFAULT '',
      document_id INTEGER REFERENCES documents(id),
      by_name     TEXT NOT NULL,
      at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_asset ON history(asset_id);
  `);
  // Columns added after the first release; existing databases get them here.
  const columns = db.prepare(`PRAGMA table_info(assets)`).all().map((c) => c.name);
  for (const column of ['replaces_id', 'replaced_by_id']) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE assets ADD COLUMN ${column} INTEGER REFERENCES assets(id)`);
  }
  return new AssetStore(db);
}

export class AssetStore {
  constructor(db) {
    this.db = db;
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  get(id) {
    const row = this.db
      .prepare(
        `SELECT a.*, d.original_name AS source_doc_name
           FROM assets a LEFT JOIN documents d ON d.id = a.source_doc_id
          WHERE a.id = ?`,
      )
      .get(Number(id));
    if (!row) throw new NotFoundError('Asset not found.');
    const asset = toAsset(row);
    // A short description of the asset on either side of a replacement.
    const brief = (otherId) =>
      otherId == null ? null : { ...this.db.prepare(`SELECT id, brand, model, serial, status FROM assets WHERE id = ?`).get(otherId) };
    asset.replaces = brief(row.replaces_id);
    asset.replaced_by = brief(row.replaced_by_id);
    return asset;
  }

  // status: 'active' | 'removed'; filter: '' | 'no-maintenance' | 'warranty-90'
  list({ q = '', status = 'active', filter = '' } = {}) {
    const where = ['a.status = ?'];
    const params = [status === 'removed' ? 'removed' : 'active'];
    const terms = String(q).trim().split(/\s+/).filter(Boolean);
    for (const term of terms) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        `(${['brand', 'model', 'serial', 'hostname', 'location', 'project', 'vendor', 'maintenance', 'notes']
          .map((f) => `a.${f} LIKE ? ESCAPE '\\'`)
          .join(' OR ')})`,
      );
      params.push(...Array(9).fill(like));
    }
    if (filter === 'no-maintenance') where.push(`a.maintenance = ''`);
    if (filter === 'warranty-90') {
      where.push(`a.warranty_end <> '' AND a.warranty_end <= date('now', '+90 days')`);
    }
    const rows = this.db
      .prepare(
        `SELECT a.*, d.original_name AS source_doc_name
           FROM assets a LEFT JOIN documents d ON d.id = a.source_doc_id
          WHERE ${where.join(' AND ')}
          ORDER BY lower(a.brand), lower(a.model), a.serial_key`,
      )
      .all(...params);
    return rows.map(toAsset);
  }

  counts() {
    const rows = this.db.prepare(`SELECT status, count(*) AS n FROM assets GROUP BY status`).all();
    const out = { active: 0, removed: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  // Returns the active assets whose serial matches any of the given serials.
  findBySerials(serials) {
    const keys = [...new Set(serials.map(serialKey).filter(Boolean))];
    if (!keys.length) return [];
    return this.db
      .prepare(
        `SELECT * FROM assets WHERE status = 'active' AND serial_key IN (${keys.map(() => '?').join(',')})`,
      )
      .all(...keys)
      .map(toAsset);
  }

  #assertSerialFree(serial, exceptId = null) {
    const existing = this.db
      .prepare(`SELECT * FROM assets WHERE status = 'active' AND serial_key = ? AND id IS NOT ?`)
      .get(serialKey(serial), exceptId);
    if (existing) {
      throw new ConflictError(
        `Serial number ${serial} is already on the list (${existing.brand} ${existing.model}).`,
        { field: 'serial', existing: toAsset(existing) },
      );
    }
  }

  #insert(fields, { by, documentId = null, action = 'added', reason = '', replacesId = null }) {
    this.#assertSerialFree(fields.serial);
    const at = now();
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO assets (${ASSET_FIELDS.join(', ')}, source_doc_id, replaces_id, created_at, updated_at)
         VALUES (${ASSET_FIELDS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
      )
      .run(...ASSET_FIELDS.map((f) => fields[f]), documentId, replacesId, at, at);
    const id = Number(lastInsertRowid);
    const changes = Object.fromEntries(ASSET_FIELDS.filter((f) => fields[f]).map((f) => [f, ['', fields[f]]]));
    this.#log(id, action, { changes, reason, documentId, by });
    return id;
  }

  // Throws unless the asset is on the list and unchanged since the person loaded it.
  #assertCurrent(current, version) {
    if (current.status !== 'active') throw new ConflictError('This asset has already been removed.');
    if (Number(version) !== current.version) {
      throw new ConflictError('Someone else changed this asset after you opened it. Review their changes and try again.', {
        current,
      });
    }
  }

  #log(assetId, action, { changes = {}, reason = '', documentId = null, by }) {
    this.db
      .prepare(
        `INSERT INTO history (asset_id, action, changes, reason, document_id, by_name, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(assetId, action, JSON.stringify(changes), reason, documentId, cleanName(by), now());
  }

  create(input, by) {
    const fields = cleanFields(input);
    return this.transaction(() => this.get(this.#insert(fields, { by })));
  }

  // Saves edited fields. `version` must match what the editor loaded, so two
  // people editing the same asset cannot silently overwrite each other.
  update(id, input, version, by) {
    const fields = cleanFields(input);
    return this.transaction(() => {
      const current = this.get(id);
      if (current.status !== 'active') throw new ConflictError('This asset has been removed. Restore it before editing.');
      if (Number(version) !== current.version) {
        throw new ConflictError('Someone else changed this asset after you opened it. Review their changes and try again.', {
          current,
        });
      }
      const changes = {};
      for (const f of ASSET_FIELDS) if (fields[f] !== current[f]) changes[f] = [current[f], fields[f]];
      if (!Object.keys(changes).length) return current;
      if (changes.serial) this.#assertSerialFree(fields.serial, current.id);
      this.db
        .prepare(
          `UPDATE assets SET ${ASSET_FIELDS.map((f) => `${f} = ?`).join(', ')},
                 version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(...ASSET_FIELDS.map((f) => fields[f]), now(), current.id);
      this.#log(current.id, 'edited', { changes, by });
      return this.get(current.id);
    });
  }

  remove(id, reason, version, by) {
    const why = String(reason ?? '').trim().slice(0, MAX_LENGTH);
    if (!why) throw new ValidationError('Say why the asset is being removed.', { field: 'reason' });
    return this.transaction(() => {
      const current = this.get(id);
      this.#assertCurrent(current, version);
      this.db
        .prepare(
          `UPDATE assets SET status = 'removed', removed_reason = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(why, now(), current.id);
      this.#log(current.id, 'removed', { reason: why, by });
      return this.get(current.id);
    });
  }

  // Swaps a failed or retired asset for a different one in a single step:
  // the old one moves to Removed, the new one is added, and each links to the
  // other so the history shows what took whose place.
  replace(id, input, reason, version, by) {
    const fields = cleanFields(input);
    const why = String(reason ?? '').trim().slice(0, MAX_LENGTH);
    if (!why) throw new ValidationError('Say why the asset is being replaced.', { field: 'reason' });
    return this.transaction(() => {
      const old = this.get(id);
      this.#assertCurrent(old, version);
      const label = (a) => `${a.brand} ${a.model} (${a.serial})`;
      // Take the old one off the list first so its serial is free, in case the
      // vendor sent back the same unit.
      this.db
        .prepare(
          `UPDATE assets SET status = 'removed', removed_reason = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(`${why}. Replaced by ${label(fields)}`, now(), old.id);
      const newId = this.#insert(fields, { by, reason: `Replaces ${label(old)}`, replacesId: old.id });
      this.db.prepare(`UPDATE assets SET replaced_by_id = ? WHERE id = ?`).run(newId, old.id);
      this.#log(old.id, 'replaced', { reason: `${why}. Replaced by ${label(fields)}`, by });
      return { old: this.get(old.id), asset: this.get(newId) };
    });
  }

  restore(id, by) {
    return this.transaction(() => {
      const current = this.get(id);
      if (current.status !== 'removed') throw new ConflictError('This asset is already on the list.');
      this.#assertSerialFree(current.serial, current.id);
      this.db
        .prepare(
          `UPDATE assets SET status = 'active', removed_reason = '', version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(now(), current.id);
      // Its replacement stays on the list, so say so in the history.
      const reason = current.replaced_by ? `Its replacement ${current.replaced_by.serial} is still on the list` : '';
      this.#log(current.id, 'restored', { reason, by });
      return this.get(current.id);
    });
  }

  addDocument({ originalName, storedName, mime, size }, by) {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO documents (original_name, stored_name, mime, size, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(originalName, storedName, mime, size, cleanName(by), now());
    return this.getDocument(Number(lastInsertRowid));
  }

  getDocument(id) {
    const doc = this.db.prepare(`SELECT * FROM documents WHERE id = ?`).get(Number(id));
    if (!doc) throw new NotFoundError('Document not found.');
    return { ...doc };
  }

  // Adds every confirmed row from one document, or none of them.
  importRows(documentId, inputRows, by) {
    if (!Array.isArray(inputRows) || !inputRows.length) throw new ValidationError('There are no rows to add.');
    const doc = documentId == null ? null : this.getDocument(documentId);
    const rows = inputRows.map((r, i) => {
      try {
        return cleanFields(r);
      } catch (err) {
        err.message = `Row ${i + 1}: ${err.message}`;
        err.details = { ...err.details, row: i };
        throw err;
      }
    });
    const seen = new Map();
    rows.forEach((r, i) => {
      const key = serialKey(r.serial);
      if (seen.has(key)) {
        throw new ValidationError(`Rows ${seen.get(key) + 1} and ${i + 1} have the same serial number ${r.serial}.`, {
          row: i,
          field: 'serial',
        });
      }
      seen.set(key, i);
    });
    const existing = this.findBySerials(rows.map((r) => r.serial));
    if (existing.length) {
      throw new ConflictError(
        `Already on the list: ${existing.map((a) => a.serial).join(', ')}. Remove those rows or edit the existing assets instead.`,
        { existing },
      );
    }
    return this.transaction(() =>
      rows.map((fields) => this.get(this.#insert(fields, { by, documentId: doc?.id ?? null, action: 'imported' }))),
    );
  }

  history({ assetId = null, limit = 200 } = {}) {
    const rows = this.db
      .prepare(
        `SELECT h.*, a.brand, a.model, a.serial, d.original_name AS document_name
           FROM history h
           JOIN assets a ON a.id = h.asset_id
           LEFT JOIN documents d ON d.id = h.document_id
          WHERE (? IS NULL OR h.asset_id = ?)
          ORDER BY h.id DESC
          LIMIT ?`,
      )
      .all(assetId, assetId, Math.min(Math.max(Number(limit) || 200, 1), 1000));
    return rows.map((r) => ({ ...r, changes: JSON.parse(r.changes) }));
  }
}

function toAsset(row) {
  const { serial_key, ...rest } = row;
  return { ...rest };
}
