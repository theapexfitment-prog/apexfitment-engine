'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { generateQuotePdf } = require('./pdf_generator');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DATABASE_PATH
  || path.join(__dirname, '..', 'database', 'leadmechanic.db');

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('[ApexFitment] Failed to open database:', err.message);
    console.error('[ApexFitment] Run first: node src/init_db.js');
    process.exit(1);
  }
  console.log('[ApexFitment] Database connected (read-only).');
});

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ---------------------------------------------------------------------------
// Shared: extract + validate vehicle params from request body
// ---------------------------------------------------------------------------
function extractVehicleParams(body) {
  const { vehicle_chassis, powertrain } = body || {};
  if (!vehicle_chassis || !vehicle_chassis.year || !vehicle_chassis.make || !vehicle_chassis.model) {
    return { error: true };
  }
  const {
    year,
    make,
    model,
    submodel_payload_chassis: payload_chassis = null,
    cab_type = null,
    bed_length = null,
    drivetrain = null,
  } = vehicle_chassis;
  const engine_displacement = powertrain?.engine_displacement_liters ?? null;
  return { year, make, model, payload_chassis, cab_type, bed_length, engine_displacement, drivetrain };
}

// ---------------------------------------------------------------------------
// Shared: NULL-tolerant fitment WHERE clause + params builder
// ---------------------------------------------------------------------------
const FITMENT_WHERE = `
      f.fit_year  = ?
      AND f.fit_make  = ?
      AND f.fit_model = ?
      AND (? IS NULL OR f.fit_payload_chassis     IS NULL OR f.fit_payload_chassis     = ?)
      AND (? IS NULL OR f.fit_cab_type            IS NULL OR f.fit_cab_type            = ?)
      AND (? IS NULL OR f.fit_bed_length          IS NULL OR f.fit_bed_length          = ?)
      AND (? IS NULL OR f.fit_engine_displacement IS NULL OR f.fit_engine_displacement = ?)
      AND (? IS NULL OR f.fit_drivetrain          IS NULL OR f.fit_drivetrain          = ?)
`;

function buildFitmentParams({ year, make, model, payload_chassis, cab_type, bed_length, engine_displacement, drivetrain }) {
  return [
    year, make, model,
    payload_chassis,     payload_chassis,
    cab_type,            cab_type,
    bed_length,          bed_length,
    engine_displacement, engine_displacement,
    drivetrain,          drivetrain,
  ];
}

// ---------------------------------------------------------------------------
// POST /webhook/sms — fitment lookup
// ---------------------------------------------------------------------------
app.post('/webhook/sms', (req, res) => {
  const params = extractVehicleParams(req.body);
  if (params.error) {
    return res.status(400).json({
      error: 'INVALID_PAYLOAD',
      detail: 'Required fields: vehicle_chassis.year, .make, .model',
    });
  }

  const SQL = `
    SELECT
      p.product_id, p.part_number, p.brand, p.line_name, p.product_type,
      p.diameter_inches, p.material, p.base_price_usd,
      f.fit_year, f.fit_make, f.fit_model, f.fit_payload_chassis,
      f.fit_cab_type, f.fit_bed_length, f.fit_engine_displacement, f.fit_drivetrain
    FROM exhaust_fitment f
    JOIN products p ON p.product_id = f.product_id
    WHERE ${FITMENT_WHERE}
  `;

  db.all(SQL, buildFitmentParams(params), (err, rows) => {
    if (err) {
      console.error('[ApexFitment] /webhook/sms query error:', err.message);
      return res.status(500).json({
        error: 'QUERY_EXECUTION_FAILURE',
        detail: 'Internal fitment engine error. Check DB integrity.',
      });
    }
    if (rows.length === 0) {
      return res.status(404).json({
        status: 'NO_MATCH',
        message: 'No compatible fitment found for the specified build configuration.',
        query: params,
      });
    }
    return res.status(200).json({ status: 'MATCH_FOUND', count: rows.length, results: rows });
  });
});

// ---------------------------------------------------------------------------
// Shared: run quote SQL and build quoteData payload
// ---------------------------------------------------------------------------
function runQuoteQuery(params, product_type_filter, selected_part_numbers, callback) {
  const hasPnFilter = Array.isArray(selected_part_numbers) && selected_part_numbers.length > 0;
  const pnClause    = hasPnFilter
    ? `AND p.part_number IN (${selected_part_numbers.map(() => '?').join(', ')})`
    : '';

  const SQL = `
    SELECT
      p.part_number, p.brand, p.line_name, p.product_type, p.base_price_usd,
      COALESCE(lr.labor_hours,   0.0)   AS labor_hours,
      COALESCE(lr.rate_per_hour, 125.0) AS rate_per_hour
    FROM exhaust_fitment f
    JOIN products p ON p.product_id = f.product_id
    LEFT JOIN labor_rates lr ON lr.product_type = p.product_type
    WHERE ${FITMENT_WHERE}
      AND (? IS NULL OR p.product_type = ?)
      ${pnClause}
  `;

  const sqlParams = [
    ...buildFitmentParams(params),
    product_type_filter, product_type_filter,
    ...(hasPnFilter ? selected_part_numbers : []),
  ];

  db.all(SQL, sqlParams, (err, rows) => {
    if (err) return callback(err, null);
    if (rows.length === 0) return callback(null, null);

    let parts_total_usd = 0;
    let labor_total_usd = 0;

    const line_items = rows.map((r) => {
      const labor_cost_usd  = parseFloat((r.labor_hours * r.rate_per_hour).toFixed(2));
      const line_total_usd  = parseFloat((r.base_price_usd + labor_cost_usd).toFixed(2));
      parts_total_usd      += r.base_price_usd;
      labor_total_usd      += labor_cost_usd;
      return {
        part_number:    r.part_number,
        brand:          r.brand,
        line_name:      r.line_name,
        product_type:   r.product_type,
        base_price_usd: parseFloat(r.base_price_usd.toFixed(2)),
        labor_hours:    r.labor_hours,
        labor_cost_usd,
        line_total_usd,
      };
    });

    parts_total_usd = parseFloat(parts_total_usd.toFixed(2));
    labor_total_usd = parseFloat(labor_total_usd.toFixed(2));
    const grand_total_usd = parseFloat((parts_total_usd + labor_total_usd).toFixed(2));

    const { year, make, model, payload_chassis, cab_type, bed_length, engine_displacement, drivetrain } = params;

    const quoteData = {
      status: 'QUOTE_READY',
      build: { year, make, model, engine_displacement, payload_chassis, cab_type, bed_length, drivetrain },
      line_items,
      summary: { parts_total_usd, labor_total_usd, grand_total_usd, currency: 'USD' },
    };

    callback(null, quoteData);
  });
}

// ---------------------------------------------------------------------------
// POST /quote — fitment + labor cost estimate
// ---------------------------------------------------------------------------
app.post('/quote', (req, res) => {
  const params = extractVehicleParams(req.body);
  if (params.error) {
    return res.status(400).json({
      error: 'INVALID_PAYLOAD',
      detail: 'Required fields: vehicle_chassis.year, .make, .model',
    });
  }

  const product_type_filter    = req.body?.product_type_filter    ?? null;
  const selected_part_numbers  = req.body?.selected_part_numbers  ?? null;

  runQuoteQuery(params, product_type_filter, selected_part_numbers, (err, quoteData) => {
    if (err) {
      console.error('[ApexFitment] /quote query error:', err.message);
      return res.status(500).json({
        error: 'QUERY_EXECUTION_FAILURE',
        detail: 'Internal fitment engine error. Check DB integrity.',
      });
    }
    if (!quoteData) {
      return res.status(404).json({
        status: 'NO_QUOTE',
        message: 'No compatible parts found for this build configuration.',
      });
    }
    return res.status(200).json(quoteData);
  });
});

// ---------------------------------------------------------------------------
// POST /export-pdf — same as /quote but returns a downloadable PDF
// ---------------------------------------------------------------------------
app.post('/export-pdf', (req, res) => {
  const params = extractVehicleParams(req.body);
  if (params.error) {
    return res.status(400).json({
      error: 'INVALID_PAYLOAD',
      detail: 'Required fields: vehicle_chassis.year, .make, .model',
    });
  }

  const product_type_filter   = req.body?.product_type_filter   ?? null;
  const selected_part_numbers = req.body?.selected_part_numbers ?? null;

  runQuoteQuery(params, product_type_filter, selected_part_numbers, (err, quoteData) => {
    if (err) {
      console.error('[ApexFitment] /export-pdf query error:', err.message);
      return res.status(500).json({
        error: 'QUERY_EXECUTION_FAILURE',
        detail: 'Internal fitment engine error. Check DB integrity.',
      });
    }
    if (!quoteData) {
      return res.status(404).json({
        status: 'NO_QUOTE',
        message: 'No compatible parts found for this build configuration.',
      });
    }

    const { make, model, year } = quoteData.build;
    const safeName = [make, model, year].map(v => String(v || '').replace(/\s+/g, '-')).join('-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ApexFitment-Quote-${safeName}.pdf"`);

    generateQuotePdf(quoteData, res);
  });
});

// ---------------------------------------------------------------------------
// Health-check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'apexfitment-core' }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[ApexFitment] Server listening at http://localhost:${PORT}`);
  console.log(`[ApexFitment] Endpoints: POST /webhook/sms  POST /quote  POST /export-pdf`);
});
