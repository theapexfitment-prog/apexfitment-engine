'use strict';

const fs      = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const DB_PATH = process.env.DATABASE_PATH
  || path.join(__dirname, '..', 'database', 'leadmechanic.db');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[ApexFitment] Failed to open database:', err.message);
    process.exit(1);
  }
  console.log('[ApexFitment] Connected to SQLite at:', DB_PATH);
});

function insertProduct(p, f) {
  db.run(
    `INSERT OR IGNORE INTO products
       (part_number, brand, line_name, product_type, diameter_inches, material, base_price_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [p.part_number, p.brand, p.line_name, p.product_type, p.diameter_inches, p.material, p.base_price_usd],
    function (err) {
      if (err) { console.error(`[ApexFitment] Error inserting ${p.part_number}:`, err.message); return; }
      if (this.lastID === 0) return;
      db.run(
        `INSERT OR IGNORE INTO exhaust_fitment
           (product_id, fit_year, fit_make, fit_model,
            fit_payload_chassis, fit_cab_type, fit_bed_length,
            fit_engine_displacement, fit_drivetrain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.lastID, f.year, f.make, f.model,
         f.payload_chassis, f.cab_type, f.bed_length,
         f.engine_displacement, f.drivetrain],
        (err2) => { if (err2) console.error(`[ApexFitment] Fitment error for ${p.part_number}:`, err2.message); }
      );
    }
  );
}

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  // ── shops ──────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS shops (
      shop_id                INTEGER PRIMARY KEY AUTOINCREMENT,
      clerk_user_id          TEXT    NOT NULL UNIQUE,
      shop_name              TEXT    NOT NULL,
      owner_name             TEXT    NOT NULL,
      email                  TEXT    NOT NULL UNIQUE,
      phone                  TEXT,
      city                   TEXT,
      state                  TEXT    DEFAULT 'TX',
      logo_url               TEXT,
      labor_rate             REAL    NOT NULL DEFAULT 125.00,
      labor_rate_fabrication REAL    NOT NULL DEFAULT 250.00,
      fabrication_capable    INTEGER NOT NULL DEFAULT 0,
      status                 TEXT    NOT NULL DEFAULT 'pending',
      plan                   TEXT    NOT NULL DEFAULT 'starter',
      created_at             TEXT    DEFAULT (datetime('now'))
    )
  `);

  // ── quotes_history ─────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS quotes_history (
      quote_id        INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id         INTEGER NOT NULL REFERENCES shops(shop_id),
      vehicle_year    INTEGER,
      vehicle_make    TEXT,
      vehicle_model   TEXT,
      vehicle_engine  TEXT,
      parts_total     REAL,
      labor_total     REAL,
      grand_total     REAL,
      line_items_json TEXT,
      created_at      TEXT    DEFAULT (datetime('now'))
    )
  `);

  // ── labor_rates ────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS labor_rates (
      product_type    TEXT PRIMARY KEY,
      labor_hours     REAL NOT NULL,
      rate_per_hour   REAL NOT NULL DEFAULT 125.00
    )
  `);

  const laborRates = [
    ['Cat-Back',           1.5, 125.00],
    ['Long Tube Headers',  4.0, 125.00],
    ['Supercharger Kit',   8.0, 125.00],
    ['Cold Air Intake',    0.5, 125.00],
    ['Camshaft Kit',       6.0, 125.00],
    ['Transmission',      10.0, 125.00],
  ];
  for (const [pt, lh, rph] of laborRates) {
    db.run(`INSERT OR IGNORE INTO labor_rates (product_type, labor_hours, rate_per_hour) VALUES (?, ?, ?)`,
      [pt, lh, rph]);
  }

  // ── products ───────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      product_id        INTEGER PRIMARY KEY AUTOINCREMENT,
      part_number       TEXT    NOT NULL UNIQUE,
      brand             TEXT    NOT NULL,
      line_name         TEXT,
      product_type      TEXT    NOT NULL,
      diameter_inches   REAL    NOT NULL,
      material          TEXT,
      base_price_usd    REAL    NOT NULL,
      shop_id           INTEGER REFERENCES shops(shop_id)
    )
  `);

  // ── exhaust_fitment ────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS exhaust_fitment (
      fitment_id              INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id              INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      fit_year                INTEGER NOT NULL,
      fit_make                TEXT    NOT NULL,
      fit_model               TEXT    NOT NULL,
      fit_payload_chassis     TEXT,
      fit_cab_type            TEXT,
      fit_bed_length          TEXT,
      fit_engine_displacement TEXT,
      fit_drivetrain          TEXT,
      clash_detected          INTEGER DEFAULT 0,
      clash_level             INTEGER DEFAULT 0,
      clash_variable          TEXT,
      clash_value             REAL,
      clash_tolerance         REAL,
      clash_delta_mm          REAL
    )
  `);

  // ── Products 1-3 (GMT800 originals) ───────────────────────────────────────
  insertProduct(
    { part_number: '15795',    brand: 'Magnaflow', line_name: 'Street Series',    product_type: 'Cat-Back',          diameter_inches: 3.0,   material: 'Stainless Steel',       base_price_usd: 489.99  },
    { year: 2004, make: 'GMC',       model: 'Sierra 1500',      payload_chassis: null,     cab_type: 'Extended Cab', bed_length: 'Standard Bed', engine_displacement: '5.3L', drivetrain: null }
  );
  insertProduct(
    { part_number: '817540',   brand: 'Flowmaster', line_name: 'Force II',        product_type: 'Cat-Back',          diameter_inches: 3.5,   material: 'Aluminized Steel',      base_price_usd: 379.99  },
    { year: 2001, make: 'Chevrolet', model: 'Silverado 1500HD', payload_chassis: '1500HD', cab_type: 'Crew Cab',     bed_length: 'Standard Bed', engine_displacement: '6.0L', drivetrain: null }
  );
  insertProduct(
    { part_number: 'LTH-LS-5700', brand: 'Hooker', line_name: 'BlackHeart Series', product_type: 'Long Tube Headers', diameter_inches: 1.875, material: 'Stainless Steel 304', base_price_usd: 1199.99 },
    { year: 2000, make: 'Chevrolet', model: 'Silverado 1500',   payload_chassis: null,     cab_type: 'Regular Cab', bed_length: null,           engine_displacement: '5.7L', drivetrain: 'RWD' }
  );

  // ── Products 4-5 (Cat-Backs) ───────────────────────────────────────────────
  insertProduct(
    { part_number: 'CB-COYOTE-GT',   brand: 'Borla',     line_name: 'ATAK',               product_type: 'Cat-Back', diameter_inches: 3.0, material: 'Stainless Steel 304', base_price_usd: 1349.99 },
    { year: 2018, make: 'Ford',   model: 'Mustang GT',   payload_chassis: null, cab_type: null, bed_length: null, engine_displacement: '5.0L', drivetrain: 'RWD' }
  );
  insertProduct(
    { part_number: 'CB-HELLCAT-68',  brand: 'Magnaflow', line_name: 'Competition Series',  product_type: 'Cat-Back', diameter_inches: 3.5, material: 'Stainless Steel 304', base_price_usd: 1599.99 },
    { year: 2019, make: 'Dodge', model: 'Challenger',    payload_chassis: 'SRT Hellcat', cab_type: null, bed_length: null, engine_displacement: '6.2L', drivetrain: 'RWD' }
  );

  // ── Products 6-8 (Long Tube Headers) ──────────────────────────────────────
  insertProduct(
    { part_number: 'LTH-COYOTE-S550', brand: 'Kooks',                     line_name: 'Green Catted',      product_type: 'Long Tube Headers', diameter_inches: 1.875, material: 'Stainless Steel 304', base_price_usd: 1899.99 },
    { year: 2018, make: 'Ford',    model: 'Mustang GT',   payload_chassis: null,          cab_type: null, bed_length: null, engine_displacement: '5.0L', drivetrain: 'RWD' }
  );
  insertProduct(
    { part_number: 'LTH-LS3-CAMARO',  brand: 'Hooker',                    line_name: 'BlackHeart Series', product_type: 'Long Tube Headers', diameter_inches: 1.875, material: 'Stainless Steel 304', base_price_usd: 1249.99 },
    { year: 2012, make: 'Chevrolet', model: 'Camaro SS', payload_chassis: null,          cab_type: null, bed_length: null, engine_displacement: '6.2L', drivetrain: 'RWD' }
  );
  insertProduct(
    { part_number: 'LTH-HEMI-392',    brand: 'American Racing Headers',   line_name: 'ARH Street',        product_type: 'Long Tube Headers', diameter_inches: 1.875, material: 'Stainless Steel 304', base_price_usd: 1449.99 },
    { year: 2020, make: 'Dodge',   model: 'Challenger',   payload_chassis: 'R/T Scat Pack', cab_type: null, bed_length: null, engine_displacement: '6.4L', drivetrain: 'RWD' }
  );

  // ── Products 9-10 (Supercharger Kits) ─────────────────────────────────────
  insertProduct(
    { part_number: 'SC-TVS2650-COYOTE', brand: 'Whipple',    line_name: 'W175FF 2.65L',    product_type: 'Supercharger Kit', diameter_inches: 0.0, material: 'Billet Aluminum', base_price_usd: 8499.99 },
    { year: 2018, make: 'Ford',      model: 'Mustang GT', payload_chassis: null, cab_type: null, bed_length: null, engine_displacement: '5.0L', drivetrain: 'RWD' }
  );
  insertProduct(
    { part_number: 'SC-TVS1900-LS3',    brand: 'Edelbrock',  line_name: 'E-Force Stage 1', product_type: 'Supercharger Kit', diameter_inches: 0.0, material: 'Cast Aluminum',  base_price_usd: 6299.99 },
    { year: 2012, make: 'Chevrolet', model: 'Camaro SS',  payload_chassis: null, cab_type: null, bed_length: null, engine_displacement: '6.2L', drivetrain: 'RWD' }
  );

  // ── Products 11-12 (Cold Air Intakes) ─────────────────────────────────────
  insertProduct(
    { part_number: 'CAI-COYOTE-GT',    brand: 'Roush', line_name: 'Cold Air Kit',   product_type: 'Cold Air Intake', diameter_inches: 0.0, material: 'Composite', base_price_usd: 399.99 },
    { year: 2018, make: 'Ford',  model: 'Mustang GT', payload_chassis: null, cab_type: null, bed_length: null, engine_displacement: '5.0L', drivetrain: null }
  );
  insertProduct(
    { part_number: 'CAI-HEMI-CHARGER', brand: 'K&N',   line_name: 'Typhoon Series', product_type: 'Cold Air Intake', diameter_inches: 0.0, material: 'Composite', base_price_usd: 449.99 },
    { year: 2019, make: 'Dodge', model: 'Charger',     payload_chassis: 'R/T', cab_type: null, bed_length: null, engine_displacement: '5.7L', drivetrain: null }
  );

  // ── Products 13-14 (Camshaft Kits) ────────────────────────────────────────
  insertProduct(
    { part_number: 'CAM-LS3-STAGE2', brand: 'Texas Speed',    line_name: 'Stage 2 Truck Cam', product_type: 'Camshaft Kit', diameter_inches: 0.0, material: 'Billet Steel', base_price_usd: 649.99 },
    { year: 2012, make: 'Chevrolet', model: 'Camaro SS',  payload_chassis: null, cab_type: null, bed_length: null, engine_displacement: '6.2L', drivetrain: null }
  );
  insertProduct(
    { part_number: 'CAM-COYOTE-VMP', brand: 'VMP Performance', line_name: 'Gen3R Cam',         product_type: 'Camshaft Kit', diameter_inches: 0.0, material: 'Billet Steel', base_price_usd: 899.99 },
    { year: 2018, make: 'Ford',      model: 'Mustang GT', payload_chassis: null, cab_type: null, bed_length: null, engine_displacement: '5.0L', drivetrain: null }
  );

  // ── Product 15 (Transmission) ──────────────────────────────────────────────
  insertProduct(
    { part_number: 'TR-TREMEC-T56MAG', brand: 'TREMEC', line_name: 'Magnum 6-Speed', product_type: 'Transmission', diameter_inches: 0.0, material: 'Aluminum/Steel', base_price_usd: 4299.99 },
    { year: 2018, make: 'Ford', model: 'Mustang GT', payload_chassis: null, cab_type: null, bed_length: null, engine_displacement: null, drivetrain: 'RWD' }
  );

  // ── Products 16-19 (Hellcat-specific) ─────────────────────────────────────
  insertProduct(
    { part_number: 'LTH-HEMI-HELLCAT', brand: 'American Racing Headers', line_name: 'ARH 1-7/8 Catted',      product_type: 'Long Tube Headers', diameter_inches: 1.875, material: 'Stainless Steel 304', base_price_usd: 1649.99 },
    { year: 2019, make: 'Dodge', model: 'Challenger', payload_chassis: 'SRT Hellcat', cab_type: null, bed_length: null, engine_displacement: '6.2L', drivetrain: 'RWD' }
  );
  insertProduct(
    { part_number: 'SC-HELLCAT-UPGRADE', brand: 'Whipple', line_name: 'W250AX 3.0L Upgrade',  product_type: 'Supercharger Kit', diameter_inches: 0.0, material: 'Billet Aluminum', base_price_usd: 5999.99 },
    { year: 2019, make: 'Dodge', model: 'Challenger', payload_chassis: 'SRT Hellcat', cab_type: null, bed_length: null, engine_displacement: '6.2L', drivetrain: 'RWD' }
  );
  insertProduct(
    { part_number: 'CAI-HELLCAT-K&N', brand: 'K&N', line_name: '69 Series Typhoon',           product_type: 'Cold Air Intake', diameter_inches: 0.0, material: 'Composite', base_price_usd: 449.99 },
    { year: 2019, make: 'Dodge', model: 'Challenger', payload_chassis: 'SRT Hellcat', cab_type: null, bed_length: null, engine_displacement: '6.2L', drivetrain: null }
  );
  insertProduct(
    { part_number: 'CAM-HELLCAT-COMP', brand: 'Comp Cams', line_name: 'Stage 2 Blower Cam',   product_type: 'Camshaft Kit', diameter_inches: 0.0, material: 'Billet Steel', base_price_usd: 899.99 },
    { year: 2019, make: 'Dodge', model: 'Challenger', payload_chassis: 'SRT Hellcat', cab_type: null, bed_length: null, engine_displacement: '6.2L', drivetrain: null }
  );

  // Seed admin account — survives all redeploys
  db.run(`
    INSERT OR IGNORE INTO shops
    (clerk_user_id, shop_name, owner_name, email, status, plan)
    VALUES (
      'user_3E3OfwVriqSqf1KCtisnKWC20ZD',
      'ApexFitment HQ',
      'Emiliano Silva',
      'theapexfitment@gmail.com',
      'active',
      'admin'
    )
  `, function (err) {
    if (err) {
      console.error('[ApexFitment] Admin seed error:', err.message);
    } else {
      console.log('[ApexFitment] Admin account verified.');
    }
  });

  db.run('SELECT 1', () => {
    console.log('[ApexFitment] Database initialized: 19 products, 6 labor rate categories, fitment matrix loaded.');
    console.log('[ApexFitment] Schema: shops, quotes_history, labor_rates, products (with shop_id), exhaust_fitment (with clash columns).');
    db.close();
  });
});
