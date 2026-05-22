'use strict';
require('dotenv').config();
const axios   = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const DB_PATH    = process.env.DATABASE_PATH
  || path.join(__dirname, '../../database/leadmechanic.db');
const EBAY_APP_ID  = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;

// ---------------------------------------------------------------------------
// Search targets — American Muscle performance parts
// ---------------------------------------------------------------------------
const SEARCH_QUERIES = [
  {
    query: 'long tube headers Mustang GT 5.0 S550',
    product_type: 'Long Tube Headers',
    platforms: [
      { year: 2018, make: 'Ford', model: 'Mustang GT', engine: '5.0L', drivetrain: 'RWD' },
    ],
  },
  {
    query: 'long tube headers Camaro SS LS3 6.2',
    product_type: 'Long Tube Headers',
    platforms: [
      { year: 2012, make: 'Chevrolet', model: 'Camaro SS', engine: '6.2L', drivetrain: 'RWD' },
    ],
  },
  {
    query: 'long tube headers Challenger Hellcat 6.2 Hemi',
    product_type: 'Long Tube Headers',
    platforms: [
      { year: 2019, make: 'Dodge', model: 'Challenger', submodel: 'SRT Hellcat', engine: '6.2L', drivetrain: 'RWD' },
    ],
  },
  {
    query: 'supercharger kit Mustang GT 5.0 Coyote S550',
    product_type: 'Supercharger Kit',
    platforms: [
      { year: 2018, make: 'Ford', model: 'Mustang GT', engine: '5.0L', drivetrain: 'RWD' },
    ],
  },
  {
    query: 'supercharger kit Camaro SS LS3 5th gen',
    product_type: 'Supercharger Kit',
    platforms: [
      { year: 2012, make: 'Chevrolet', model: 'Camaro SS', engine: '6.2L', drivetrain: 'RWD' },
    ],
  },
  {
    query: 'cat back exhaust Mustang GT S550 2015 2016 2017 2018',
    product_type: 'Cat-Back',
    platforms: [
      { year: 2018, make: 'Ford', model: 'Mustang GT', engine: '5.0L', drivetrain: 'RWD' },
      { year: 2016, make: 'Ford', model: 'Mustang GT', engine: '5.0L', drivetrain: 'RWD' },
    ],
  },
  {
    query: 'cat back exhaust Challenger Hellcat SRT 6.2',
    product_type: 'Cat-Back',
    platforms: [
      { year: 2019, make: 'Dodge', model: 'Challenger', submodel: 'SRT Hellcat', engine: '6.2L', drivetrain: 'RWD' },
    ],
  },
  {
    query: 'camshaft kit LS3 Camaro SS performance stage 2',
    product_type: 'Camshaft Kit',
    platforms: [
      { year: 2012, make: 'Chevrolet', model: 'Camaro SS', engine: '6.2L' },
    ],
  },
  {
    query: 'camshaft kit Coyote 5.0 Mustang GT performance',
    product_type: 'Camshaft Kit',
    platforms: [
      { year: 2018, make: 'Ford', model: 'Mustang GT', engine: '5.0L' },
    ],
  },
  {
    query: 'cold air intake Mustang GT 5.0 S550',
    product_type: 'Cold Air Intake',
    platforms: [
      { year: 2018, make: 'Ford', model: 'Mustang GT', engine: '5.0L' },
    ],
  },
  {
    query: 'cold air intake Camaro SS LS3 2010 2011 2012',
    product_type: 'Cold Air Intake',
    platforms: [
      { year: 2012, make: 'Chevrolet', model: 'Camaro SS', engine: '6.2L' },
    ],
  },
  {
    query: 'TREMEC T56 Magnum transmission Mustang',
    product_type: 'Transmission',
    platforms: [
      { year: 2018, make: 'Ford', model: 'Mustang GT', drivetrain: 'RWD' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Brand allowlist — skip unknown vendors
// ---------------------------------------------------------------------------
const TARGET_BRANDS = [
  'Kooks', 'Hooker', 'American Racing Headers', 'BBK',
  'Borla', 'Magnaflow', 'Flowmaster', 'Corsa', 'Stainless Works',
  'Whipple', 'Procharger', 'Edelbrock', 'Vortech', 'Paxton',
  'Texas Speed', 'Comp Cams', 'Lunati', 'Cam Motion',
  'Roush', 'K&N', 'JLT', 'Ford Performance',
  'TREMEC', 'Richmond', 'T56',
];

// ---------------------------------------------------------------------------
// eBay OAuth — client credentials grant
// ---------------------------------------------------------------------------
async function getEbayToken() {
  const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
  const response = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  return response.data.access_token;
}

// ---------------------------------------------------------------------------
// eBay Browse API search
// ---------------------------------------------------------------------------
async function searchEbayItems(token, query, limit = 50) {
  const response = await axios.get(
    'https://api.ebay.com/buy/browse/v1/item_summary/search',
    {
      params: {
        q: query,
        category_ids: '33743', // eBay Motors > Parts > Exhaust & Emissions
        limit,
        filter: 'conditionIds:{1000}', // New items only
      },
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    }
  );
  return response.data.itemSummaries || [];
}

// ---------------------------------------------------------------------------
// Field extractors
// ---------------------------------------------------------------------------
function extractBrand(title) {
  const upper = title.toUpperCase();
  for (const brand of TARGET_BRANDS) {
    if (upper.includes(brand.toUpperCase())) return brand;
  }
  return null;
}

function extractDiameter(title) {
  const match = title.match(/(\d+[-\/]\d+|\d+\.\d+)\s*[""in]/i);
  if (match) {
    const raw = match[1].replace('-', '/');
    if (raw.includes('/')) {
      const [num, den] = raw.split('/');
      return parseFloat(num) / parseFloat(den);
    }
    return parseFloat(raw);
  }
  return 0.0;
}

function extractMaterial(title) {
  if (/stainless.*304/i.test(title))  return 'Stainless Steel 304';
  if (/stainless/i.test(title))       return 'Stainless Steel';
  if (/aluminized/i.test(title))      return 'Aluminized Steel';
  if (/titanium/i.test(title))        return 'Titanium';
  if (/billet.*aluminum/i.test(title))return 'Billet Aluminum';
  if (/aluminum/i.test(title))        return 'Aluminum';
  return 'Steel';
}

// ---------------------------------------------------------------------------
// DB upsert — product + fitment rows
// ---------------------------------------------------------------------------
function upsertProduct(db, item, searchConfig) {
  return new Promise((resolve, reject) => {
    const brand = extractBrand(item.title);
    if (!brand) return resolve(null); // skip unknown vendors

    const partNumber = item.itemId;
    const lineName   = item.title.substring(0, 60);
    const price      = parseFloat(item.price?.value || 0);
    const diameter   = extractDiameter(item.title);
    const material   = extractMaterial(item.title);

    db.run(
      `INSERT OR IGNORE INTO products
         (part_number, brand, line_name, product_type,
          diameter_inches, material, base_price_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [partNumber, brand, lineName, searchConfig.product_type,
       diameter, material, price],
      function (err) {
        if (err) return reject(err);
        if (this.lastID === 0) return resolve(null); // already existed

        const productId = this.lastID;
        let pending = searchConfig.platforms.length;

        searchConfig.platforms.forEach(p => {
          db.run(
            `INSERT OR IGNORE INTO exhaust_fitment
               (product_id, fit_year, fit_make, fit_model,
                fit_payload_chassis, fit_engine_displacement, fit_drivetrain)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [productId, p.year, p.make, p.model,
             p.submodel || null, p.engine || null, p.drivetrain || null],
            (fitErr) => {
              if (fitErr) console.error('[eBay Scraper] Fitment insert error:', fitErr.message);
              if (--pending === 0) resolve(productId);
            }
          );
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function runScraper() {
  if (!EBAY_APP_ID || !EBAY_CERT_ID) {
    console.error('[eBay Scraper] ERROR: EBAY_APP_ID and EBAY_CERT_ID must be set in .env');
    console.error('[eBay Scraper] Get credentials at: developer.ebay.com');
    process.exit(1);
  }

  const t0 = Date.now();
  console.log('[eBay Scraper] Starting eBay Motors fitment scrape…');
  console.log(`[eBay Scraper] Queries: ${SEARCH_QUERIES.length} · DB: ${DB_PATH}`);

  let token;
  try {
    token = await getEbayToken();
    console.log('[eBay Scraper] OAuth token acquired.');
  } catch (e) {
    console.error('[eBay Scraper] OAuth failed:', e.response?.data || e.message);
    process.exit(1);
  }

  const db = new sqlite3.Database(DB_PATH);
  db.run('PRAGMA foreign_keys = ON');

  let totalItems     = 0;
  let productsAdded  = 0;
  let skippedBrand   = 0;
  let skippedDupe    = 0;
  let errors         = 0;

  for (const config of SEARCH_QUERIES) {
    console.log(`\n[eBay Scraper] Searching: "${config.query}"`);
    let items = [];

    try {
      items = await searchEbayItems(token, config.query);
      console.log(`[eBay Scraper]   → ${items.length} results`);
    } catch (e) {
      console.error(`[eBay Scraper]   → Search failed: ${e.response?.data?.errors?.[0]?.message || e.message}`);
      errors++;
      continue;
    }

    for (const item of items) {
      totalItems++;
      try {
        const result = await upsertProduct(db, item, config);
        if (result === null) {
          // Distinguish brand-skip from dupe by checking extractBrand
          if (!extractBrand(item.title)) skippedBrand++;
          else skippedDupe++;
        } else {
          productsAdded++;
        }
      } catch (e) {
        console.error(`[eBay Scraper]   → DB error for ${item.itemId}: ${e.message}`);
        errors++;
      }
    }

    // Polite delay between queries — avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  await new Promise(resolve => db.close(resolve));

  const duration = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n[eBay Scraper] Scrape Complete');
  console.log('─────────────────────────────────────');
  console.log(`Queries run:        ${SEARCH_QUERIES.length}`);
  console.log(`Items evaluated:    ${totalItems}`);
  console.log(`Products added:     ${productsAdded}`);
  console.log(`Skipped (no brand): ${skippedBrand}`);
  console.log(`Skipped (dupes):    ${skippedDupe}`);
  console.log(`Errors:             ${errors}`);
  console.log(`Duration:           ${duration}s`);
  console.log('─────────────────────────────────────');
}

runScraper().catch(err => {
  console.error('[eBay Scraper] Fatal:', err.message);
  process.exit(1);
});
