'use strict';

const PDFDocument = require('pdfkit');

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  accent:   '#00D4FF',
  darkBg:   '#1A1A2E',
  rowAlt:   '#F8F8F8',
  gray:     '#888888',
  lightGray:'#F4F4F8',
  border:   '#CCCCCC',
  dark:     '#1A1A1A',
  mid:      '#444444',
  white:    '#FFFFFF',
  green:    '#00AA55',
  amber:    '#CC8800',
  red:      '#CC2222',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtUSD(n) {
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function blueprintNumber() {
  const d   = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const rnd = String(Math.floor(Math.random() * 9000) + 1000);
  return `BLP-${ymd}-${rnd}`;
}

function cell(doc, text, x, y, w, opts = {}) {
  const { align = 'left', font = 'Helvetica', size = 8, color = C.dark, pad = 4 } = opts;
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(String(text ?? ''), x + pad, y, { width: w - pad * 2, align, lineBreak: false });
}

// ── Main export ───────────────────────────────────────────────────────────────
function generateQuotePdf(quoteData, shop, outputStream) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 40, bottom: 50, left: 50, right: 50 },
    info: { Title: 'ApexFitment Engineering Fitment Blueprint', Author: shop ? shop.shop_name : 'ApexFitment Engine' },
  });

  doc.pipe(outputStream);

  const L = 50;
  const R = 562;
  const W = 512;

  const bn  = blueprintNumber();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });

  // ── HEADER ─────────────────────────────────────────────────────────────────
  let y = 40;

  // Shop branding (left)
  const shopName = shop?.shop_name || 'ApexFitment';
  const shopCity = shop?.city && shop?.state ? `${shop.city}, ${shop.state}` : (shop?.state || 'TX');
  doc.font('Helvetica-Bold').fontSize(20).fillColor(C.darkBg).text(shopName, L, y);
  doc.font('Helvetica').fontSize(9).fillColor(C.gray).text(shopCity, L, y + 26);

  // Blueprint meta (right)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.dark)
     .text('ENGINEERING FITMENT BLUEPRINT', L, y, { width: W, align: 'right' });
  doc.font('Courier-Bold').fontSize(9).fillColor(C.accent)
     .text(bn, L, y + 16, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(C.gray)
     .text(`${dateStr}  ${timeStr}`, L, y + 28, { width: W, align: 'right' });

  // Separator
  y = 88;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(C.accent).lineWidth(1).stroke();

  // ── BUILD CONFIGURATION ────────────────────────────────────────────────────
  y = 98;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.gray)
     .text('BUILD CONFIGURATION', L, y, { characterSpacing: 1.2 });

  y = 110;
  const boxH = 44;
  doc.rect(L, y, W, boxH).fillColor(C.lightGray).fill();
  doc.rect(L, y, W, boxH).strokeColor(C.border).lineWidth(0.5).stroke();

  const build = quoteData.build || {};
  const buildCols = [
    ['YEAR',       String(build.year || '—')],
    ['MAKE',       build.make || '—'],
    ['MODEL',      build.model || '—'],
    ['ENGINE',     build.engine_displacement || '—'],
    ['SUBMODEL',   build.payload_chassis || '—'],
    ['DRIVETRAIN', build.drivetrain || '—'],
  ];
  const colW = W / buildCols.length;
  buildCols.forEach(([label, value], i) => {
    const cx = L + i * colW;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.gray)
       .text(label, cx + 6, y + 7, { width: colW - 10, characterSpacing: 0.8 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.dark)
       .text(value, cx + 6, y + 18, { width: colW - 10, lineBreak: false });
  });

  // ── LINE ITEMS TABLE ───────────────────────────────────────────────────────
  y = 168;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.gray)
     .text('LINE ITEMS', L, y, { characterSpacing: 1.2 });

  y = 180;

  // 9 columns — total = 512
  const cols = [
    { label: 'PART #',     x: L,       w: 80,  align: 'left'  },
    { label: 'BRAND',      x: L + 80,  w: 60,  align: 'left'  },
    { label: 'TYPE',       x: L + 140, w: 70,  align: 'left'  },
    { label: 'TELEMETRY',  x: L + 210, w: 70,  align: 'left'  },
    { label: 'PARTS $',    x: L + 280, w: 50,  align: 'right' },
    { label: 'LBR HRS',    x: L + 330, w: 38,  align: 'right' },
    { label: 'LABOR $',    x: L + 368, w: 48,  align: 'right' },
    { label: 'FAB $',      x: L + 416, w: 44,  align: 'right' },
    { label: 'LINE TOTAL', x: L + 460, w: 52,  align: 'right' },
  ];

  const ROW_H    = 18;
  const DIAG_H   = 14;

  // Header row
  doc.rect(L, y, W, ROW_H).fillColor(C.darkBg).fill();
  cols.forEach(c => {
    cell(doc, c.label, c.x, y + 5, c.w, { align: c.align, font: 'Helvetica-Bold', size: 6.5, color: C.white, pad: 4 });
  });
  y += ROW_H;

  const items = quoteData.line_items || [];
  let hasFab = false;

  items.forEach((item, idx) => {
    const bg = idx % 2 === 0 ? C.white : C.rowAlt;
    doc.rect(L, y, W, ROW_H).fillColor(bg).fill();
    doc.rect(L, y, W, ROW_H).strokeColor(C.border).lineWidth(0.3).stroke();

    // TELEMETRY cell color + text
    let telemColor = C.green;
    let telemText  = '✓ All nominal';
    if (item.fitment_status === 'FABRICATION_REQUIRED') {
      telemColor = C.amber; telemText = 'Fab Req.'; hasFab = true;
    } else if (item.fitment_status === 'CAUTION') {
      telemColor = C.amber; telemText = '⚠ Fab needed'; hasFab = true;
    } else if (item.fitment_status === 'INCOMPATIBLE') {
      telemColor = C.red;   telemText = '✗ Hard clash';
    }

    // Left border stripe for non-confirmed
    if (item.fitment_status !== 'CONFIRMED') {
      doc.rect(L, y, 3, ROW_H).fillColor(telemColor).fill();
    }

    cell(doc, item.part_number,   cols[0].x, y + 5, cols[0].w, { font: 'Courier',       size: 7,   color: C.dark,  pad: 4 });
    cell(doc, item.brand,         cols[1].x, y + 5, cols[1].w, { font: 'Helvetica-Bold', size: 7.5, color: C.dark,  pad: 4 });
    cell(doc, item.product_type,  cols[2].x, y + 5, cols[2].w, { font: 'Helvetica',      size: 7,   color: C.mid,   pad: 4 });
    cell(doc, telemText,          cols[3].x, y + 5, cols[3].w, { font: 'Helvetica-Bold', size: 7,   color: telemColor, pad: 4 });
    cell(doc, fmtUSD(item.base_price_usd),       cols[4].x, y + 5, cols[4].w, { font: 'Helvetica', size: 7.5, color: C.dark, align: 'right', pad: 4 });
    cell(doc, `${item.labor_hours}h`,             cols[5].x, y + 5, cols[5].w, { font: 'Helvetica', size: 7.5, color: C.gray, align: 'right', pad: 4 });
    cell(doc, fmtUSD(item.labor_cost_usd),        cols[6].x, y + 5, cols[6].w, { font: 'Helvetica', size: 7.5, color: C.dark, align: 'right', pad: 4 });
    cell(doc, item.fabrication_labor_cost > 0 ? fmtUSD(item.fabrication_labor_cost) : '—',
              cols[7].x, y + 5, cols[7].w, { font: 'Helvetica', size: 7.5, color: item.fabrication_labor_cost > 0 ? C.amber : C.gray, align: 'right', pad: 4 });
    cell(doc, fmtUSD(item.line_total_usd),        cols[8].x, y + 5, cols[8].w, { font: 'Helvetica-Bold', size: 7.5, color: C.dark, align: 'right', pad: 4 });

    y += ROW_H;

    // Diagnostic sub-row
    if (item.diagnostics) {
      doc.rect(L, y, W, DIAG_H).fillColor('#FFFBF0').fill();
      doc.font('Helvetica').fontSize(6.5).fillColor(telemColor)
         .text(item.diagnostics, L + 8, y + 3, { width: W - 16, lineBreak: false });
      y += DIAG_H;
    }
  });

  doc.moveTo(L, y).lineTo(R, y).strokeColor(C.border).lineWidth(0.5).stroke();

  // ── FABRICATION SECTION ────────────────────────────────────────────────────
  if (hasFab) {
    y += 14;
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.amber)
       .text('FABRICATION ADVISORY', L, y, { characterSpacing: 1.2 });
    y += 10;
    const fabItems = items.filter(i => i.fabrication_required);
    fabItems.forEach(fi => {
      doc.font('Helvetica').fontSize(7.5).fillColor(C.mid)
         .text(`• ${fi.part_number} — ${fi.fitment_label}${fi.fabrication_labor_hours > 0 ? ` (${fi.fabrication_labor_hours}h @ ${fmtUSD(shop?.labor_rate_fabrication || 250)}/hr)` : ''}`,
           L + 8, y, { width: W - 16 });
      y += 12;
    });
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.border).lineWidth(0.3).stroke();
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  y += 16;
  const SX = R - 220;
  const SW = 220;
  const s  = quoteData.summary || {};

  const summaryRow = (label, value, yPos, bold = false, color = C.dark) => {
    const fnt = bold ? 'Helvetica-Bold' : 'Helvetica';
    const sz  = bold ? 10 : 9;
    doc.font(fnt).fontSize(sz).fillColor(color).text(label, SX, yPos, { width: SW * 0.55, lineBreak: false });
    doc.font(fnt).fontSize(sz).fillColor(color).text(value, SX, yPos, { width: SW, align: 'right', lineBreak: false });
  };

  summaryRow('PARTS TOTAL',       fmtUSD(s.parts_total_usd || 0),       y);
  summaryRow('LABOR TOTAL',       fmtUSD(s.labor_total_usd || 0),       y + 14);
  if ((s.fabrication_total_usd || 0) > 0) {
    summaryRow('FABRICATION TOTAL', fmtUSD(s.fabrication_total_usd),    y + 28, false, C.amber);
  }

  const ruleOffset = (s.fabrication_total_usd || 0) > 0 ? 44 : 30;
  const ruleY = y + ruleOffset;
  doc.moveTo(SX, ruleY).lineTo(R, ruleY).strokeColor(C.dark).lineWidth(0.8).stroke();
  doc.moveTo(SX, ruleY + 3).lineTo(R, ruleY + 3).strokeColor(C.dark).lineWidth(0.8).stroke();

  const gtY = ruleY + 10;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.green)
     .text('GRAND TOTAL', SX, gtY, { width: SW * 0.55, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.green)
     .text(fmtUSD(s.grand_total_usd || 0), SX, gtY, { width: SW, align: 'right', lineBreak: false });

  doc.font('Helvetica').fontSize(7).fillColor(C.gray)
     .text(`All prices in USD · Labor rate: ${fmtUSD(shop?.labor_rate || 125)}/hr`, SX, gtY + 18, { width: SW, align: 'right' });

  // ── FOOTER ─────────────────────────────────────────────────────────────────
  const FY = 742;
  doc.moveTo(L, FY).lineTo(R, FY).strokeColor(C.border).lineWidth(0.5).stroke();

  const FTY = FY + 8;
  const shopLine = shop ? `${shop.shop_name} · ${shopCity}` : '';
  doc.font('Helvetica').fontSize(7).fillColor(C.gray);
  doc.text(shopLine, L, FTY, { width: W * 0.38, lineBreak: false });
  doc.text('Powered by ApexFitment', L + W * 0.38, FTY, { width: W * 0.24, align: 'center', lineBreak: false });
  doc.text('Blueprint valid 30 days from generation date', L + W * 0.62, FTY, { width: W * 0.38, align: 'right', lineBreak: false });

  doc.end();
}

module.exports = { generateQuotePdf };
