// Unpacks a .zip upload into the documents inside it, so each one goes
// through the same read → review → confirm steps as a single upload.
//   unzipDocuments(file) → { files: { file: File, from: string }[], skipped: string[] }

const TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

// Limits keep a malformed or malicious zip from filling the browser's memory.
const MAX_FILES = 200;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // same as the server's upload limit
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_DEPTH = 3; // zips inside zips

const extOf = (name) => (name.includes('.') ? name.toLowerCase().split('.').pop() : '');
const baseName = (path) => path.split('/').pop();

export const isZip = (file) => extOf(file.name) === 'zip';

export async function unzipDocuments(file) {
  const { unzipSync } = await import('/vendor/fflate/browser.js');
  const result = { files: [], skipped: [] };
  const budget = { files: 0, bytes: 0 };
  expand(unzipSync, new Uint8Array(await file.arrayBuffer()), file.name, 0, budget, result);
  return result;
}

function expand(unzipSync, data, zipName, depth, budget, result) {
  let entries;
  try {
    entries = unzipSync(data, {
      // Runs before each entry is decompressed, so skipped entries cost nothing.
      filter: ({ name, originalSize }) => {
        const base = baseName(name);
        if (name.endsWith('/') || name.startsWith('__MACOSX/') || base.startsWith('.')) return false;
        const ext = extOf(base);
        if (!TYPES[ext] && !(ext === 'zip' && depth < MAX_DEPTH)) {
          result.skipped.push(base);
          return false;
        }
        if (ext !== 'zip' && originalSize > MAX_FILE_BYTES) {
          result.skipped.push(`${base} (over 25 MB)`);
          return false;
        }
        budget.files += 1;
        budget.bytes += originalSize;
        if (budget.files > MAX_FILES) throw new LimitError(`it holds more than ${MAX_FILES} documents`);
        if (budget.bytes > MAX_TOTAL_BYTES) throw new LimitError('its contents are larger than 300 MB');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof LimitError) throw new Error(`${zipName} wasn't opened because ${err.message}. Split it into smaller zips.`);
    throw new Error(`${zipName} couldn't be opened. It may be damaged or password-protected.`);
  }

  for (const [path, bytes] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    const base = baseName(path);
    const ext = extOf(base);
    if (ext === 'zip') {
      expand(unzipSync, bytes, `${zipName} › ${base}`, depth + 1, budget, result);
    } else {
      result.files.push({ file: new File([bytes], base, { type: TYPES[ext] }), from: zipName });
    }
  }
}

class LimitError extends Error {}
