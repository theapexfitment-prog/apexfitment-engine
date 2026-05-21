'use strict';

const fs      = require('fs');
const path    = require('path');
const xml2js  = require('xml2js');
const sqlite3 = require('sqlite3').verbose();

const ACES_FILE = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(__dirname, '../data/sample_aces.xml');

const DB_PATH = process.env.DATABASE_PATH
  || path.join(__dirname, '../database/leadmechanic.db');

// ---------------------------------------------------------------------------
// Promisified db helpers
// ---------------------------------------------------------------------------
function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) reject(err); else resolve(db);
    });
  });
}

function dbRun(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(resolve));
}

// ---------------------------------------------------------------------------
// SubModel classifier: "1500HD", "2500HD", "3500" → payload_chassis
// Otherwise → suffix of model name
// ---------------------------------------------------------------------------
function classifySubModel(model, subModel) {
  const sm = (subModel || '').trim();
  if (!sm) return { fit_model: model.trim(), fit_payload_chassis: null };
  const isPayloadClass = /^\d/.test(sm) || /HD$/i.test(sm);
  if (isPayloadClass) {
    return { fit_model: model.trim(), fit_payload_chassis: sm };
  }
  return { fit_model: `${model.trim()} ${sm}`.trim(), fit_payload_chassis: null };
}

// ---------------------------------------------------------------------------
// Map one parsed <App> element to { product, fitment }
// ---------------------------------------------------------------------------
function mapApp(app) {
  const g = (key) => {
    const v = app[key];
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };

  const rawModel    = g('Model')    || '';
  const rawSubModel = g('SubModel') || '';
  const { fit_model, fit_payload_chassis } = classifySubModel(rawModel, rawSubModel);

  const rawNote = g('Note') || '';

  const product = {
    part_number:    g('MfrLabel'),
    brand:          g('Brand'),
    line_name:      rawNote.slice(0, 60) || null,
    product_type:   g('PartType'),
    diameter_inches: parseFloat(g('Diameter') || '0') || 0.0,
    material:       g('Material'),
    base_price_usd: parseFloat(g('Price') || '0') || 0.0,
  };

  const fitment = {
    fit_year:                parseInt(g('Year') || '0', 10),
    fit_make:                g('Make'),
    fit_model,
    fit_payload_chassis,
    fit_cab_type:            g('CabType'),
    fit_bed_length:          g('BedLength'),
    fit_engine_displacement: g('EngineDisplacement'),
    fit_drivetrain:          g('Drivetrain'),
  };

  return { product, fitment };
}

// ---------------------------------------------------------------------------
// Process a single App entry → upsert product + insert fitment
// ---------------------------------------------------------------------------
async function processApp(db, app, appId) {
  const { product, fitment } = mapApp(app);

  if (!product.part_number || !product.brand || !product.product_type) {
    throw new Error(`App id=${appId}: missing required field (MfrLabel/Brand/PartType)`);
  }
  if (!fitment.fit_year || !fitment.fit_make || !fitment.fit_model) {
    throw new Error(`App id=${appId}: missing required fitment field (Year/Make/Model)`);
  }

  // Upsert product (INSERT OR REPLACE: always gets a fresh product_id)
  const prodResult = await dbRun(db,
    `INSERT OR REPLACE INTO products
       (part_number, brand, line_name, product_type, diameter_inches, material, base_price_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [product.part_number, product.brand, product.line_name,
     product.product_type, product.diameter_inches, product.material,
     product.base_price_usd]
  );

  const productId = prodResult.lastID;

  // Insert fitment (INSERT OR IGNORE: skip duplicates)
  const fitResult = await dbRun(db,
    `INSERT OR IGNORE INTO exhaust_fitment
       (product_id, fit_year, fit_make, fit_model,
        fit_payload_chassis, fit_cab_type, fit_bed_length,
        fit_engine_displacement, fit_drivetrain)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId,
     fitment.fit_year, fitment.fit_make, fitment.fit_model,
     fitment.fit_payload_chassis, fitment.fit_cab_type, fitment.fit_bed_length,
     fitment.fit_engine_displacement, fitment.fit_drivetrain]
  );

  return { fitmentInserted: fitResult.changes > 0 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();

  if (!fs.existsSync(ACES_FILE)) {
    console.error(`[ApexFitment] ERROR: File not found: ${ACES_FILE}`);
    console.error(`[ApexFitment] Usage: node src/aces_parser.js [path/to/aces.xml]`);
    process.exit(1);
  }

  console.log(`[ApexFitment] Reading ACES file: ${ACES_FILE}`);
  const xml = fs.readFileSync(ACES_FILE, 'utf8');

  let parsed;
  try {
    parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, trim: true });
  } catch (e) {
    console.error('[ApexFitment] XML parse error:', e.message);
    process.exit(1);
  }

  const root = parsed.ACES;
  if (!root || !root.App) {
    console.error('[ApexFitment] ERROR: No <App> entries found in ACES file.');
    process.exit(1);
  }

  // Normalize: single App → array
  const apps = Array.isArray(root.App) ? root.App : [root.App];
  const fileName = path.basename(ACES_FILE);

  let productsUpserted = 0;
  let fitmentInserted  = 0;
  let skipped          = 0;
  let errors           = 0;

  const db = await openDb();
  await dbRun(db, 'PRAGMA foreign_keys = ON', []);

  for (const app of apps) {
    const appId = app.$ ? app.$.id : '?';
    try {
      const result = await processApp(db, app, appId);
      productsUpserted++;
      if (result.fitmentInserted) fitmentInserted++;
      else skipped++;
    } catch (err) {
      console.error(`[ApexFitment] SKIP App id=${appId}: ${err.message}`);
      errors++;
    }
  }

  await closeDb(db);

  const duration = Date.now() - t0;

  console.log('\n[ApexFitment] ACES Import Complete');
  console.log('─────────────────────────────────');
  console.log(`File:               ${fileName}`);
  console.log(`Apps processed:     ${apps.length}`);
  console.log(`Products upserted:  ${productsUpserted}`);
  console.log(`Fitments inserted:  ${fitmentInserted}`);
  console.log(`Skipped (dupes):    ${skipped}`);
  console.log(`Errors:             ${errors}`);
  console.log(`Duration:           ${duration}ms`);
  console.log('─────────────────────────────────');
}

main().catch((err) => {
  console.error('[ApexFitment] Fatal:', err.message);
  process.exit(1);
});
