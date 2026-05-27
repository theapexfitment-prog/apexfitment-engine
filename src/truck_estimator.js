'use strict';

require('dotenv').config();

const express  = require('express');
const sqlite3  = require('sqlite3').verbose();
const path     = require('path');
const { generateQuotePdf }      = require('./pdf_generator');
const { calculateFrictionScore } = require('./friction_score');
const { requireAuth, requireShop, requireAdmin } = require('./middleware/auth');

const PORT    = process.env.PORT || 3000;
const DB_PATH = process.env.DATABASE_PATH
  || path.join(__dirname, '..', 'database', 'leadmechanic.db');

// ---------------------------------------------------------------------------
// Database (read-write — needed for quotes_history, shop settings, admin)
// ---------------------------------------------------------------------------
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[ApexFitment] Failed to open database:', err.message);
    console.error('[ApexFitment] Run first: node src/init_db.js');
    process.exit(1);
  }
  console.log('[ApexFitment] Database connected.');
  db.run('PRAGMA foreign_keys = ON');
});

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ---------------------------------------------------------------------------
// Clash resolver
// ---------------------------------------------------------------------------
function resolveClash(row, shop) {
  if (!row.clash_detected || row.clash_level === 0) {
    return {
      ...row,
      fitment_status: 'CONFIRMED',
      fitment_label:  'Fitment Confirmed',
      diagnostics:    null,
      fabrication_required:     false,
      fabrication_labor_hours:  0,
      fabrication_labor_cost:   0,
    };
  }
  if (row.clash_level === 2) {
    return {
      ...row,
      fitment_status: 'INCOMPATIBLE',
      fitment_label:  'Hard Clash — Incompatible',
      diagnostics: `Conflict detected: Variable [${row.clash_variable}] value ${row.clash_value} exceeds subchassis tolerance by ${Math.abs(row.clash_delta_mm).toFixed(1)}mm. Part cannot be installed without chassis modification.`,
      fabrication_required:     false,
      fabrication_labor_hours:  0,
      fabrication_labor_cost:   0,
    };
  }
  if (row.clash_level === 1) {
    if (shop.fabrication_capable) {
      const fabHours = 2.0;
      const fabCost  = fabHours * shop.labor_rate_fabrication;
      return {
        ...row,
        fitment_status: 'FABRICATION_REQUIRED',
        fitment_label:  'Requires Fabrication',
        diagnostics: `Level 1 conflict: Variable [${row.clash_variable}] exceeds tolerance by ${Math.abs(row.clash_delta_mm).toFixed(1)}mm. Resolvable via precision cut/weld. ${fabHours}h fabrication labor added at $${shop.labor_rate_fabrication}/hr.`,
        fabrication_required:     true,
        fabrication_labor_hours:  fabHours,
        fabrication_labor_cost:   fabCost,
      };
    }
    return {
      ...row,
      fitment_status: 'CAUTION',
      fitment_label:  'Caution — Fabrication Needed',
      diagnostics: `Level 1 conflict: Variable [${row.clash_variable}] exceeds tolerance by ${Math.abs(row.clash_delta_mm).toFixed(1)}mm. Requires fabrication capability to resolve. Enable fabrication in shop settings if capable.`,
      fabrication_required:     true,
      fabrication_labor_hours:  0,
      fabrication_labor_cost:   0,
    };
  }
  return { ...row, fitment_status: 'CONFIRMED', fitment_label: 'Fitment Confirmed', diagnostics: null, fabrication_required: false, fabrication_labor_hours: 0, fabrication_labor_cost: 0 };
}

// ---------------------------------------------------------------------------
// Shared: extract + validate vehicle params
// ---------------------------------------------------------------------------
function extractVehicleParams(body) {
  const { vehicle_chassis, powertrain } = body || {};
  if (!vehicle_chassis || !vehicle_chassis.year || !vehicle_chassis.make || !vehicle_chassis.model) {
    return { error: true };
  }
  const {
    year, make, model,
    submodel_payload_chassis: payload_chassis = null,
    cab_type = null, bed_length = null, drivetrain = null,
  } = vehicle_chassis;
  const engine_displacement = powertrain?.engine_displacement_liters ?? null;
  return { year, make, model, payload_chassis, cab_type, bed_length, engine_displacement, drivetrain };
}

// ---------------------------------------------------------------------------
// Shared: NULL-tolerant fitment WHERE clause
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
// POST /webhook/sms — fitment lookup (protected)
// ---------------------------------------------------------------------------
app.post('/webhook/sms', requireAuth, requireShop, (req, res) => {
  const params = extractVehicleParams(req.body);
  if (params.error) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'Required fields: vehicle_chassis.year, .make, .model' });
  }

  const SQL = `
    SELECT
      p.product_id, p.part_number, p.brand, p.line_name, p.product_type,
      p.diameter_inches, p.material, p.base_price_usd,
      f.fit_year, f.fit_make, f.fit_model, f.fit_payload_chassis,
      f.fit_cab_type, f.fit_bed_length, f.fit_engine_displacement, f.fit_drivetrain,
      f.clash_detected, f.clash_level, f.clash_variable, f.clash_value, f.clash_tolerance, f.clash_delta_mm
    FROM exhaust_fitment f
    JOIN products p ON p.product_id = f.product_id
    WHERE ${FITMENT_WHERE}
      AND (p.shop_id IS NULL OR p.shop_id = ?)
  `;

  db.all(SQL, [...buildFitmentParams(params), req.shop.shop_id], (err, rows) => {
    if (err) {
      console.error('[ApexFitment] /webhook/sms query error:', err.message);
      return res.status(500).json({ error: 'QUERY_EXECUTION_FAILURE', detail: 'Internal fitment engine error.' });
    }
    if (rows.length === 0) {
      return res.status(404).json({ status: 'NO_MATCH', message: 'No compatible fitment found for the specified build configuration.', query: params });
    }
    const results = rows.map(r => resolveClash(r, req.shop));
    return res.status(200).json({ status: 'MATCH_FOUND', count: results.length, results });
  });
});

// ---------------------------------------------------------------------------
// Shared: run quote SQL and build quoteData payload
// ---------------------------------------------------------------------------
function runQuoteQuery(params, product_type_filter, selected_part_numbers, shop, callback) {
  const hasPnFilter = Array.isArray(selected_part_numbers) && selected_part_numbers.length > 0;
  const pnClause    = hasPnFilter
    ? `AND p.part_number IN (${selected_part_numbers.map(() => '?').join(', ')})`
    : '';

  const SQL = `
    SELECT
      p.part_number, p.brand, p.line_name, p.product_type, p.base_price_usd,
      COALESCE(lr.labor_hours,   0.0) AS labor_hours,
      COALESCE(lr.rate_per_hour, ?)   AS rate_per_hour,
      f.clash_detected, f.clash_level, f.clash_variable, f.clash_value, f.clash_tolerance, f.clash_delta_mm
    FROM exhaust_fitment f
    JOIN products p ON p.product_id = f.product_id
    LEFT JOIN labor_rates lr ON lr.product_type = p.product_type
    WHERE ${FITMENT_WHERE}
      AND (? IS NULL OR p.product_type = ?)
      AND (p.shop_id IS NULL OR p.shop_id = ?)
      ${pnClause}
  `;

  const sqlParams = [
    shop.labor_rate,
    ...buildFitmentParams(params),
    product_type_filter, product_type_filter,
    shop.shop_id,
    ...(hasPnFilter ? selected_part_numbers : []),
  ];

  db.all(SQL, sqlParams, (err, rows) => {
    if (err) return callback(err, null);
    if (rows.length === 0) return callback(null, null);

    // Build raw line items without multiplier so friction score can inspect them
    const raw_items = rows.map((r) => {
      const resolved             = resolveClash(r, shop);
      const labor_cost_usd       = parseFloat((r.labor_hours * r.rate_per_hour).toFixed(2));
      const fabrication_labor_cost = parseFloat((resolved.fabrication_labor_cost || 0).toFixed(2));
      const line_total_usd       = parseFloat((r.base_price_usd + labor_cost_usd + fabrication_labor_cost).toFixed(2));
      return {
        part_number:             r.part_number,
        brand:                   r.brand,
        line_name:               r.line_name,
        product_type:            r.product_type,
        fitment_status:          resolved.fitment_status,
        fitment_label:           resolved.fitment_label,
        diagnostics:             resolved.diagnostics,
        base_price_usd:          parseFloat(r.base_price_usd.toFixed(2)),
        labor_hours:             r.labor_hours,
        labor_cost_usd,
        fabrication_required:    resolved.fabrication_required,
        fabrication_labor_hours: resolved.fabrication_labor_hours,
        fabrication_labor_cost,
        line_total_usd,
      };
    });

    // Friction score — apply labor multiplier to all labor/fab costs
    const friction = calculateFrictionScore(raw_items, { drivetrain: params.drivetrain });
    const m = friction.labor_multiplier;

    const line_items = raw_items.map(item => {
      const labor_cost_usd       = parseFloat((item.labor_cost_usd * m).toFixed(2));
      const fabrication_labor_cost = parseFloat((item.fabrication_labor_cost * m).toFixed(2));
      const line_total_usd       = parseFloat((item.base_price_usd + labor_cost_usd + fabrication_labor_cost).toFixed(2));
      return { ...item, labor_cost_usd, fabrication_labor_cost, line_total_usd };
    });

    let parts_total_usd       = 0;
    let labor_total_usd       = 0;
    let fabrication_total_usd = 0;
    line_items.forEach(item => {
      parts_total_usd       += item.base_price_usd;
      labor_total_usd       += item.labor_cost_usd;
      fabrication_total_usd += item.fabrication_labor_cost;
    });
    parts_total_usd       = parseFloat(parts_total_usd.toFixed(2));
    labor_total_usd       = parseFloat(labor_total_usd.toFixed(2));
    fabrication_total_usd = parseFloat(fabrication_total_usd.toFixed(2));
    const grand_total_usd = parseFloat((parts_total_usd + labor_total_usd + fabrication_total_usd).toFixed(2));

    const { year, make, model, payload_chassis, cab_type, bed_length, engine_displacement, drivetrain } = params;

    callback(null, {
      status: 'QUOTE_READY',
      build: { year, make, model, engine_displacement, payload_chassis, cab_type, bed_length, drivetrain },
      line_items,
      friction,
      summary: { parts_total_usd, labor_total_usd, fabrication_total_usd, grand_total_usd, labor_multiplier_applied: m, currency: 'USD' },
    });
  });
}

// ---------------------------------------------------------------------------
// POST /quote (protected)
// ---------------------------------------------------------------------------
app.post('/quote', requireAuth, requireShop, (req, res) => {
  const params = extractVehicleParams(req.body);
  if (params.error) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'Required fields: vehicle_chassis.year, .make, .model' });
  }
  const product_type_filter   = req.body?.product_type_filter   ?? null;
  const selected_part_numbers = req.body?.selected_part_numbers ?? null;

  runQuoteQuery(params, product_type_filter, selected_part_numbers, req.shop, (err, quoteData) => {
    if (err) {
      console.error('[ApexFitment] /quote query error:', err.message);
      return res.status(500).json({ error: 'QUERY_EXECUTION_FAILURE', detail: 'Internal fitment engine error.' });
    }
    if (!quoteData) {
      return res.status(404).json({ status: 'NO_QUOTE', message: 'No compatible parts found for this build configuration.' });
    }

    // Save to quotes_history (fire-and-forget)
    const s = quoteData.summary;
    const b = quoteData.build;
    db.run(
      `INSERT INTO quotes_history (shop_id, vehicle_year, vehicle_make, vehicle_model, vehicle_engine, parts_total, labor_total, grand_total, line_items_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.shop.shop_id, b.year, b.make, b.model, b.engine_displacement,
       s.parts_total_usd, s.labor_total_usd, s.grand_total_usd,
       JSON.stringify(quoteData.line_items)],
      (histErr) => { if (histErr) console.error('[ApexFitment] quotes_history write error:', histErr.message); }
    );

    return res.status(200).json(quoteData);
  });
});

// ---------------------------------------------------------------------------
// POST /export-pdf (protected)
// ---------------------------------------------------------------------------
app.post('/export-pdf', requireAuth, requireShop, (req, res) => {
  const params = extractVehicleParams(req.body);
  if (params.error) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'Required fields: vehicle_chassis.year, .make, .model' });
  }
  const product_type_filter   = req.body?.product_type_filter   ?? null;
  const selected_part_numbers = req.body?.selected_part_numbers ?? null;

  runQuoteQuery(params, product_type_filter, selected_part_numbers, req.shop, (err, quoteData) => {
    if (err) {
      console.error('[ApexFitment] /export-pdf query error:', err.message);
      return res.status(500).json({ error: 'QUERY_EXECUTION_FAILURE', detail: 'Internal fitment engine error.' });
    }
    if (!quoteData) {
      return res.status(404).json({ status: 'NO_QUOTE', message: 'No compatible parts found for this build configuration.' });
    }

    const { make, model, year } = quoteData.build;
    const safeName = [make, model, year].map(v => String(v || '').replace(/\s+/g, '-')).join('-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ApexFitment-Blueprint-${safeName}.pdf"`);
    generateQuotePdf(quoteData, req.shop, res);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/register — create shop record after Clerk sign-up
// ---------------------------------------------------------------------------
app.post('/auth/register', requireAuth, (req, res) => {
  const { shop_name, owner_name, email, phone, city, state } = req.body || {};
  if (!shop_name || !owner_name || !email) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'Required: shop_name, owner_name, email' });
  }
  const clerkId = req.auth.userId;
  db.run(
    `INSERT OR IGNORE INTO shops (clerk_user_id, shop_name, owner_name, email, phone, city, state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [clerkId, shop_name, owner_name, email, phone || null, city || null, state || 'TX'],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB_ERROR', detail: err.message });
      if (this.changes === 0) return res.status(409).json({ error: 'ALREADY_REGISTERED', detail: 'Shop already registered for this account.' });
      return res.status(201).json({ status: 'REGISTERED', message: 'Shop registration received. Pending approval within 24h.' });
    }
  );
});

// ---------------------------------------------------------------------------
// GET /auth/me — return current shop profile
// ---------------------------------------------------------------------------
app.get('/auth/me', requireAuth, requireShop, (req, res) => {
  res.json({ status: 'ok', shop: req.shop });
});

// ---------------------------------------------------------------------------
// GET /shop/settings / PUT /shop/settings
// ---------------------------------------------------------------------------
app.get('/shop/settings', requireAuth, requireShop, (req, res) => {
  res.json(req.shop);
});

app.put('/shop/settings', requireAuth, requireShop, (req, res) => {
  const { shop_name, owner_name, phone, city, state, labor_rate, labor_rate_fabrication, fabrication_capable } = req.body || {};
  db.run(
    `UPDATE shops SET
       shop_name              = COALESCE(?, shop_name),
       owner_name             = COALESCE(?, owner_name),
       phone                  = COALESCE(?, phone),
       city                   = COALESCE(?, city),
       state                  = COALESCE(?, state),
       labor_rate             = COALESCE(?, labor_rate),
       labor_rate_fabrication = COALESCE(?, labor_rate_fabrication),
       fabrication_capable    = COALESCE(?, fabrication_capable)
     WHERE shop_id = ?`,
    [shop_name ?? null, owner_name ?? null, phone ?? null, city ?? null, state ?? null,
     labor_rate ?? null, labor_rate_fabrication ?? null,
     fabrication_capable != null ? (fabrication_capable ? 1 : 0) : null,
     req.shop.shop_id],
    (err) => {
      if (err) return res.status(500).json({ error: 'DB_ERROR', detail: err.message });
      db.get('SELECT * FROM shops WHERE shop_id = ?', [req.shop.shop_id], (e, row) => {
        if (e) return res.status(500).json({ error: 'DB_ERROR' });
        res.json({ status: 'updated', shop: row });
      });
    }
  );
});

// ---------------------------------------------------------------------------
// GET /shop/history
// ---------------------------------------------------------------------------
app.get('/shop/history', requireAuth, requireShop, (req, res) => {
  db.all(
    `SELECT quote_id, vehicle_year, vehicle_make, vehicle_model, vehicle_engine,
            parts_total, labor_total, grand_total, created_at
     FROM quotes_history WHERE shop_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.shop.shop_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB_ERROR', detail: err.message });
      res.json({ status: 'ok', count: rows.length, quotes: rows });
    }
  );
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------
app.get('/admin/shops', requireAuth, requireShop, requireAdmin, (_req, res) => {
  db.all('SELECT * FROM shops ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR', detail: err.message });
    res.json({ status: 'ok', count: rows.length, shops: rows });
  });
});

app.post('/admin/shops/:id/approve', requireAuth, requireShop, requireAdmin, (req, res) => {
  db.run(`UPDATE shops SET status = 'active' WHERE shop_id = ?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'DB_ERROR', detail: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ status: 'approved', shop_id: req.params.id });
  });
});

app.post('/admin/shops/:id/suspend', requireAuth, requireShop, requireAdmin, (req, res) => {
  db.run(`UPDATE shops SET status = 'suspended' WHERE shop_id = ?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'DB_ERROR', detail: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ status: 'suspended', shop_id: req.params.id });
  });
});

// ---------------------------------------------------------------------------
// Health-check (public)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'apexfitment-core' }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[ApexFitment] Server listening at http://localhost:${PORT}`);
  console.log(`[ApexFitment] Endpoints: POST /webhook/sms  POST /quote  POST /export-pdf`);
  console.log(`[ApexFitment] Auth: POST /auth/register  GET /auth/me  GET|PUT /shop/settings  GET /shop/history`);
});
