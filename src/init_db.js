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

// ── GMT800 helpers ────────────────────────────────────────────────────────
function yrs(s, e) { const r = []; for (let y = s; y <= e; y++) r.push(y); return r; }

function insertGMT(p, clash, specs) {
  db.run(
    `INSERT OR IGNORE INTO products
       (part_number, brand, line_name, product_type, diameter_inches, material, base_price_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [p.part_number, p.brand, p.line_name, p.product_type, p.diameter_inches, p.material, p.base_price_usd],
    function (err) {
      if (err) { console.error(`[GMT800] ${p.part_number}:`, err.message); return; }
      if (this.lastID === 0) return;
      const id = this.lastID;
      const cd  = clash?.clash_detected  ?? 0,    cl  = clash?.clash_level     ?? 0;
      const cv  = clash?.clash_variable  ?? null,  cva = clash?.clash_value     ?? null;
      const ct  = clash?.clash_tolerance ?? null,  cd2 = clash?.clash_delta_mm  ?? null;

      specs.forEach(s => {
        // Per-spec clash overrides the product-level default clash
        const sc  = s.clash !== undefined ? s.clash : clash;
        const cd  = sc?.clash_detected  ?? 0,    cl  = sc?.clash_level     ?? 0;
        const cv  = sc?.clash_variable  ?? null,  cva = sc?.clash_value     ?? null;
        const ct  = sc?.clash_tolerance ?? null,  cd2 = sc?.clash_delta_mm  ?? null;

        const years = s.yearRange ? yrs(s.yearRange[0], s.yearRange[1]) : [s.year];
        const pairs = s.pairs || [{ make: s.make, model: s.model }];
        const engs  = s.engines     || [s.engine     ?? null];
        const dts   = s.drivetrains || [s.drivetrain ?? null];
        const cabs  = s.cabTypes    || [null];
        const beds  = s.bedLengths  || [null];
        const pays  = s.payloads    || [null];

        years.forEach(yr => pairs.forEach(({ make, model }) =>
          engs.forEach(eng => dts.forEach(dt => cabs.forEach(cab => beds.forEach(bed => pays.forEach(pay =>
            db.run(
              `INSERT OR IGNORE INTO exhaust_fitment
               (product_id, fit_year, fit_make, fit_model, fit_payload_chassis,
                fit_cab_type, fit_bed_length, fit_engine_displacement, fit_drivetrain,
                clash_detected, clash_level, clash_variable, clash_value, clash_tolerance, clash_delta_mm)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, yr, make, model, pay, cab, bed, eng, dt, cd, cl, cv, cva, ct, cd2],
              e2 => { if (e2) console.error(`[GMT800] fitment ${p.part_number}:`, e2.message); }
            )
          )))))));
      });
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

  // ── verified_builds ────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS verified_builds (
      verification_id    TEXT    PRIMARY KEY,
      shop_id            INTEGER NOT NULL REFERENCES shops(shop_id),
      vehicle_year       INTEGER,
      vehicle_make       TEXT,
      vehicle_model      TEXT,
      vehicle_submodel   TEXT,
      vehicle_engine     TEXT,
      vehicle_drivetrain TEXT,
      line_items_json    TEXT,
      parts_total        REAL,
      labor_total        REAL,
      fabrication_total  REAL,
      grand_total        REAL,
      friction_score     REAL,
      friction_label     TEXT,
      variables_count    INTEGER DEFAULT 8,
      created_at         TEXT    DEFAULT (datetime('now'))
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

  // ── GMT800 Platform (1999–2007) ─────────────────────────────────────────
  // Long Tube Headers
  insertGMT({part_number:'LTH-GMT800-BBK-153',brand:'BBK Performance',line_name:'1-5/8 Shorty Headers',product_type:'Long Tube Headers',diameter_inches:1.625,material:'Chrome Steel',base_price_usd:289.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L','5.3L'],drivetrains:['2WD','4WD']},
    {yearRange:[2000,2006],pairs:[{make:'Chevrolet',model:'Tahoe'},{make:'Chevrolet',model:'Suburban 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'LTH-GMT800-HOOKER-178-2WD',brand:'Hooker',line_name:'BlackHeart 1-7/8 Long Tube',product_type:'Long Tube Headers',diameter_inches:1.875,material:'Stainless Steel 304',base_price_usd:849.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['2WD']},
    {yearRange:[2001,2006],pairs:[{make:'Chevrolet',model:'Suburban 1500'},{make:'Chevrolet',model:'Tahoe'}],engines:['5.3L'],drivetrains:['2WD']},
  ]);
  insertGMT({part_number:'LTH-GMT800-HOOKER-178-4WD',brand:'Hooker',line_name:'BlackHeart 1-7/8 Long Tube 4WD',product_type:'Long Tube Headers',diameter_inches:1.875,material:'Stainless Steel 304',base_price_usd:949.99},{clash_detected:1,clash_level:1,clash_variable:'transfer_case_clearance',clash_value:28.0,clash_tolerance:36.0,clash_delta_mm:-8.0},[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['4WD']},
    {yearRange:[2001,2006],pairs:[{make:'Chevrolet',model:'Suburban 1500'},{make:'Chevrolet',model:'Tahoe'}],engines:['5.3L'],drivetrains:['4WD']},
  ]);
  insertGMT({part_number:'LTH-GMT800-KOOKS-175-60L',brand:'Kooks',line_name:'Green Catted 1-3/4 Long Tube',product_type:'Long Tube Headers',diameter_inches:1.750,material:'Stainless Steel 304',base_price_usd:1299.99},null,[
    {yearRange:[2001,2007],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
    {yearRange:[2002,2006],pairs:[{make:'Chevrolet',model:'Suburban 2500'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'LTH-GMT800-ARH-178-LSX',brand:'American Racing Headers',line_name:'ARH LS Swap Long Tube',product_type:'Long Tube Headers',diameter_inches:1.875,material:'Stainless Steel 304',base_price_usd:1449.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L','6.0L'],drivetrains:['2WD']},
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L','6.0L'],drivetrains:['4WD'],clash:{clash_detected:1,clash_level:2,clash_variable:'4WD_front_axle_header_conflict',clash_value:null,clash_tolerance:null,clash_delta_mm:15.0}},
  ]);
  insertGMT({part_number:'LTH-GMT800-BBK-175-81L',brand:'BBK Performance',line_name:'1-3/4 Heavy Duty',product_type:'Long Tube Headers',diameter_inches:1.750,material:'Chrome Steel',base_price_usd:379.99},{clash_detected:1,clash_level:2,clash_variable:'block_width_incompatible',clash_value:null,clash_tolerance:null,clash_delta_mm:22.0},[
    {yearRange:[2001,2006],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'},{make:'Chevrolet',model:'Silverado 3500'},{make:'GMC',model:'Sierra 3500'}],engines:['8.1L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'LTH-GMT800-SWAP-LSXR-178',brand:'LSX Racing',line_name:'LS Swap Long Tube GMT800',product_type:'Long Tube Headers',diameter_inches:1.875,material:'Stainless Steel 304',base_price_usd:1099.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L','6.0L'],drivetrains:['2WD']},
  ]);
  insertGMT({part_number:'LTH-GMT800-SWAP-HOOKER-4WD',brand:'Hooker',line_name:'LS Swap 4WD Specific GMT800',product_type:'Long Tube Headers',diameter_inches:1.875,material:'Stainless Steel 304',base_price_usd:1249.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L','6.0L'],drivetrains:['4WD']},
  ]);

  // Cat-Back Exhausts
  insertGMT({part_number:'CB-GMT800-FLOW-409-48L',brand:'Flowmaster',line_name:'409S Series Cat-Back',product_type:'Cat-Back',diameter_inches:3.0,material:'Stainless Steel 409',base_price_usd:529.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L','5.3L'],drivetrains:['2WD','4WD'],cabTypes:['Regular Cab','Extended Cab'],bedLengths:['Standard Bed']},
  ]);
  insertGMT({part_number:'CB-GMT800-FLOW-409-60L-CC',brand:'Flowmaster',line_name:'409S Crew Cab Cat-Back',product_type:'Cat-Back',diameter_inches:3.0,material:'Stainless Steel 409',base_price_usd:569.99},null,[
    {yearRange:[2000,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD'],cabTypes:['Crew Cab'],bedLengths:['Short Bed','Standard Bed']},
  ]);
  insertGMT({part_number:'CB-GMT800-MAGNA-16584',brand:'Magnaflow',line_name:'Street Series Cat-Back',product_type:'Cat-Back',diameter_inches:3.0,material:'Stainless Steel 304',base_price_usd:649.99},null,[
    {yearRange:[2004,2007],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD'],cabTypes:['Extended Cab','Crew Cab'],bedLengths:['Standard Bed','Short Bed']},
  ]);
  insertGMT({part_number:'CB-GMT800-BORLA-140307',brand:'Borla',line_name:'S-Type Cat-Back',product_type:'Cat-Back',diameter_inches:3.0,material:'Stainless Steel 304',base_price_usd:849.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500HD'},{make:'GMC',model:'Sierra 1500HD'},{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'}],engines:['5.3L','6.0L'],drivetrains:['2WD','4WD'],cabTypes:['Extended Cab','Crew Cab']},
  ]);
  insertGMT({part_number:'CB-GMT800-MAGNA-SUBURBAN',brand:'Magnaflow',line_name:'Competition Series SUV',product_type:'Cat-Back',diameter_inches:2.5,material:'Stainless Steel 304',base_price_usd:549.99},null,[
    {yearRange:[2000,2006],pairs:[{make:'Chevrolet',model:'Suburban 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
    {yearRange:[2000,2006],pairs:[{make:'Chevrolet',model:'Tahoe'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
    {yearRange:[2000,2006],pairs:[{make:'GMC',model:'Yukon'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CB-GMT800-BORLA-ESCALADE',brand:'Borla',line_name:'ATAK Cat-Back',product_type:'Cat-Back',diameter_inches:2.5,material:'Stainless Steel 304',base_price_usd:949.99},null,[
    {yearRange:[2002,2006],pairs:[{make:'Cadillac',model:'Escalade'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CB-GMT800-FLOW-HD-2500',brand:'Flowmaster',line_name:'Force II Heavy Duty',product_type:'Cat-Back',diameter_inches:3.5,material:'Aluminized Steel',base_price_usd:429.99},null,[
    {yearRange:[2001,2006],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'},{make:'Chevrolet',model:'Silverado 3500'},{make:'GMC',model:'Sierra 3500'}],engines:['6.0L','8.1L'],drivetrains:['2WD','4WD'],cabTypes:['Regular Cab','Extended Cab','Crew Cab']},
  ]);

  // Cold Air Intakes
  insertGMT({part_number:'CAI-GMT800-KN-57-3040',brand:'K&N',line_name:'57 Series FIPK',product_type:'Cold Air Intake',diameter_inches:0.0,material:'Composite/Oiled Cotton',base_price_usd:389.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L','5.3L'],drivetrains:['2WD','4WD']},
    {yearRange:[2000,2006],pairs:[{make:'Chevrolet',model:'Tahoe'},{make:'Chevrolet',model:'Suburban 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAI-GMT800-VOLANT-15850',brand:'Volant',line_name:'Cold Air with PowerCore',product_type:'Cold Air Intake',diameter_inches:0.0,material:'Composite',base_price_usd:449.99},null,[
    {yearRange:[2003,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAI-GMT800-SB-75-5069',brand:'S&B Filters',line_name:'Cold Air Intake Kit',product_type:'Cold Air Intake',diameter_inches:0.0,material:'Composite/Dry Extendable',base_price_usd:329.99},null,[
    {yearRange:[2003,2007],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAI-GMT800-AIRAID-200-108',brand:'Airaid',line_name:'MXP Series Intake',product_type:'Cold Air Intake',diameter_inches:0.0,material:'Composite',base_price_usd:359.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L','5.3L'],drivetrains:['2WD','4WD']},
    {yearRange:[2000,2006],pairs:[{make:'GMC',model:'Yukon'},{make:'GMC',model:'Yukon XL'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAI-GMT800-JLT-50330',brand:'JLT Performance',line_name:'Series 3 Cold Air',product_type:'Cold Air Intake',diameter_inches:0.0,material:'Composite',base_price_usd:299.99},null,[
    {yearRange:[2001,2006],pairs:[{make:'Chevrolet',model:'Suburban 2500'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAI-GMT800-KN-ESCALADE',brand:'K&N',line_name:'Typhoon Performance Intake',product_type:'Cold Air Intake',diameter_inches:0.0,material:'Composite',base_price_usd:419.99},null,[
    {yearRange:[2002,2006],pairs:[{make:'Cadillac',model:'Escalade'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
  ]);

  // Camshaft Kits
  insertGMT({part_number:'CAM-GMT800-TSP-STAGE1-53',brand:'Texas Speed',line_name:'Stage 1 Truck Cam 5.3L',product_type:'Camshaft Kit',diameter_inches:0.0,material:'Billet Steel',base_price_usd:549.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAM-GMT800-TSP-STAGE2-53',brand:'Texas Speed',line_name:'Stage 2 Truck Cam 5.3L',product_type:'Camshaft Kit',diameter_inches:0.0,material:'Billet Steel',base_price_usd:649.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
    {yearRange:[2000,2006],pairs:[{make:'Chevrolet',model:'Tahoe'},{make:'Chevrolet',model:'Suburban 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAM-GMT800-COMP-XER-60L',brand:'Comp Cams',line_name:'XER Hydraulic Roller 6.0L',product_type:'Camshaft Kit',diameter_inches:0.0,material:'Billet Steel',base_price_usd:699.99},null,[
    {yearRange:[2001,2007],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
    {yearRange:[2001,2006],pairs:[{make:'Chevrolet',model:'Suburban 2500'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAM-GMT800-LUNATI-VOODOO-53',brand:'Lunati',line_name:'Voodoo Series Truck Cam',product_type:'Camshaft Kit',diameter_inches:0.0,material:'Billet Steel',base_price_usd:579.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L','5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAM-GMT800-TSP-STAGE3-60L',brand:'Texas Speed',line_name:'Stage 3 Heavy Duty Cam',product_type:'Camshaft Kit',diameter_inches:0.0,material:'Billet Steel',base_price_usd:749.99},null,[
    {yearRange:[2001,2007],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'},{make:'Chevrolet',model:'Silverado 3500'},{make:'GMC',model:'Sierra 3500'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'CAM-GMT800-MOTION-RACE-48',brand:'Cam Motion',line_name:'Race Series 4.8L Stroker',product_type:'Camshaft Kit',diameter_inches:0.0,material:'Billet Steel',base_price_usd:829.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L'],drivetrains:['2WD','4WD']},
  ]);

  // Supercharger Kits
  insertGMT({part_number:'SC-GMT800-MAGNUSON-TVS1900',brand:'Magnuson',line_name:'TVS1900 Truck Supercharger',product_type:'Supercharger Kit',diameter_inches:0.0,material:'Cast Aluminum',base_price_usd:5499.99},null,[
    {yearRange:[2002,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'SC-GMT800-EDEL-EFORCE-53',brand:'Edelbrock',line_name:'E-Force Stage 1 5.3L',product_type:'Supercharger Kit',diameter_inches:0.0,material:'Cast Aluminum',base_price_usd:5999.99},null,[
    {yearRange:[2002,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
    {yearRange:[2002,2006],pairs:[{make:'Chevrolet',model:'Tahoe'},{make:'Chevrolet',model:'Suburban 1500'}],engines:['5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'SC-GMT800-PROCHARGER-D1SC',brand:'Procharger',line_name:'D1SC Head Unit Kit',product_type:'Supercharger Kit',diameter_inches:0.0,material:'Billet Aluminum',base_price_usd:4299.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L','5.3L'],drivetrains:['2WD']},
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L','5.3L'],drivetrains:['4WD'],clash:{clash_detected:1,clash_level:1,clash_variable:'front_diff_clearance',clash_value:22.0,clash_tolerance:28.0,clash_delta_mm:-6.0}},
  ]);
  insertGMT({part_number:'SC-GMT800-MAGNUSON-TVS2300-60L',brand:'Magnuson',line_name:'TVS2300 HD Supercharger',product_type:'Supercharger Kit',diameter_inches:0.0,material:'Cast Aluminum',base_price_usd:6799.99},null,[
    {yearRange:[2001,2007],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'}],engines:['6.0L'],drivetrains:['2WD','4WD']},
  ]);

  // Transmissions
  insertGMT({part_number:'TR-GMT800-4L80E-PERF',brand:'Performance Automatic',line_name:'4L80-E Street/Strip',product_type:'Transmission',diameter_inches:0.0,material:'Aluminum/Steel',base_price_usd:2899.99},null,[
    {yearRange:[1999,2007],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'},{make:'Chevrolet',model:'Silverado 3500'},{make:'GMC',model:'Sierra 3500'}],engines:['6.0L','8.1L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'TR-GMT800-4L60E-BUILT',brand:'Gearstar Performance',line_name:'Level 3 4L60-E',product_type:'Transmission',diameter_inches:0.0,material:'Aluminum/Steel',base_price_usd:2199.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['4.8L','5.3L'],drivetrains:['2WD','4WD']},
  ]);
  insertGMT({part_number:'TR-GMT800-TREMEC-T56-LS',brand:'TREMEC',line_name:'T56 Magnum LS Swap',product_type:'Transmission',diameter_inches:0.0,material:'Aluminum/Steel',base_price_usd:4299.99},null,[
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L','6.0L'],drivetrains:['2WD']},
    {yearRange:[1999,2006],pairs:[{make:'Chevrolet',model:'Silverado 1500'},{make:'GMC',model:'Sierra 1500'}],engines:['5.3L','6.0L'],drivetrains:['4WD'],clash:{clash_detected:1,clash_level:2,clash_variable:'transmission_tunnel_4WD_conflict',clash_value:null,clash_tolerance:null,clash_delta_mm:18.0}},
  ]);
  insertGMT({part_number:'TR-GMT800-ALLISON-1000-REMAN',brand:'Jasper Engines',line_name:'Allison 1000 Remanufactured',product_type:'Transmission',diameter_inches:0.0,material:'Aluminum/Steel',base_price_usd:3499.99},null,[
    {yearRange:[2001,2007],pairs:[{make:'Chevrolet',model:'Silverado 2500HD'},{make:'GMC',model:'Sierra 2500HD'},{make:'Chevrolet',model:'Silverado 3500'},{make:'GMC',model:'Sierra 3500'}],engines:['6.6L','6.0L'],drivetrains:['2WD','4WD']},
  ]);

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
    console.log('[ApexFitment] Database initialized: 54 products (19 muscle + 35 GMT800), 6 labor rate categories, fitment matrix loaded.');
    console.log('[ApexFitment] Schema: shops, quotes_history, labor_rates, products, exhaust_fitment, verified_builds.');
    db.close();
  });
});
