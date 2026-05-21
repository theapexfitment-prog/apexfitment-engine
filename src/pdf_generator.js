'use strict';

const PDFDocument = require('pdfkit');

// ── Palette ──────────────────────────────────────────────────────────────────
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
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtUSD(n) {
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function quoteNumber() {
  const d   = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const rnd = String(Math.floor(Math.random() * 9000) + 1000);
  return `QT-${ymd}-${rnd}`;
}

// Draw one text cell within a bounding box — handles right/left/center align.
// Uses explicit x,y so PDFKit's internal cursor position doesn't affect us.
function cell(doc, text, x, y, w, opts = {}) {
  const { align = 'left', font = 'Helvetica', size = 8, color = C.dark, pad = 5 } = opts;
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(String(text ?? ''), x + pad, y, { width: w - pad * 2, align, lineBreak: false });
}

// ── Main export ───────────────────────────────────────────────────────────────
function generateQuotePdf(quoteData, outputStream) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 40, bottom: 50, left: 50, right: 50 },
    info: { Title: 'ApexFitment Quote', Author: 'ApexFitment Engine v1.0' },
  });

  doc.pipe(outputStream);

  const L = 50;   // left margin
  const R = 562;  // right edge  (612 − 50)
  const W = 512;  // usable width

  const qn  = quoteNumber();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });

  // ── HEADER ────────────────────────────────────────────────────────────────
  let y = 40;

  // Brand mark (left)
  doc.font('Helvetica-Bold').fontSize(26).fillColor(C.accent).text('APEXFITMENT', L, y);
  doc.font('Helvetica').fontSize(9).fillColor(C.gray)
     .text('Deterministic Compatibility · Zero Guesswork', L, y + 33);

  // Quote meta (right)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.dark)
     .text('QUOTE DOCUMENT', L, y, { width: W, align: 'right' });
  doc.font('Courier-Bold').fontSize(9).fillColor(C.accent)
     .text(qn, L, y + 16, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(C.gray)
     .text(`${dateStr}  ${timeStr}`, L, y + 28, { width: W, align: 'right' });

  // Separator
  y = 90;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(C.accent).lineWidth(1).stroke();

  // ── BUILD CONFIGURATION ────────────────────────────────────────────────────
  y = 100;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.gray)
     .text('BUILD CONFIGURATION', L, y, { characterSpacing: 1.2 });

  y = 112;
  const boxH = 44;
  doc.rect(L, y, W, boxH).fillColor(C.lightGray).fill();
  doc.rect(L, y, W, boxH).strokeColor(C.border).lineWidth(0.5).stroke();

  const build = quoteData.build || {};
  const buildCols = [
    ['YEAR',        String(build.year || '—')],
    ['MAKE',        build.make || '—'],
    ['MODEL',       build.model || '—'],
    ['ENGINE',      build.engine_displacement || '—'],
    ['SUBMODEL',    build.payload_chassis || '—'],
    ['DRIVETRAIN',  build.drivetrain || '—'],
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
  y = 170;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.gray)
     .text('LINE ITEMS', L, y, { characterSpacing: 1.2 });

  y = 182;

  // Column layout — total = 512
  const cols = [
    { label: 'PART #',        x: L,       w: 108, align: 'left'  },
    { label: 'BRAND',         x: L + 108, w: 75,  align: 'left'  },
    { label: 'PRODUCT TYPE',  x: L + 183, w: 100, align: 'left'  },
    { label: 'PARTS $',       x: L + 283, w: 58,  align: 'right' },
    { label: 'LABOR HRS',     x: L + 341, w: 48,  align: 'right' },
    { label: 'LABOR $',       x: L + 389, w: 55,  align: 'right' },
    { label: 'LINE TOTAL',    x: L + 444, w: 68,  align: 'right' },
  ];

  const ROW_H = 18;

  // Header row
  doc.rect(L, y, W, ROW_H).fillColor(C.darkBg).fill();
  cols.forEach(c => {
    cell(doc, c.label, c.x, y + 5, c.w, {
      align: c.align, font: 'Helvetica-Bold', size: 6.5, color: C.white, pad: 4,
    });
  });
  y += ROW_H;

  // Data rows
  const items = quoteData.line_items || [];
  items.forEach((item, idx) => {
    const bg = idx % 2 === 0 ? C.white : C.rowAlt;
    doc.rect(L, y, W, ROW_H).fillColor(bg).fill();
    doc.rect(L, y, W, ROW_H).strokeColor(C.border).lineWidth(0.3).stroke();

    cell(doc, item.part_number,   cols[0].x, y + 5, cols[0].w, { font: 'Courier',           size: 7,   color: C.dark, pad: 4 });
    cell(doc, item.brand,         cols[1].x, y + 5, cols[1].w, { font: 'Helvetica-Bold',     size: 7.5, color: C.dark, pad: 4 });
    cell(doc, item.product_type,  cols[2].x, y + 5, cols[2].w, { font: 'Helvetica',          size: 7,   color: C.mid,  pad: 4 });
    cell(doc, fmtUSD(item.base_price_usd), cols[3].x, y + 5, cols[3].w, { font: 'Helvetica', size: 7.5, color: C.dark, align: 'right', pad: 4 });
    cell(doc, `${item.labor_hours}h`,      cols[4].x, y + 5, cols[4].w, { font: 'Helvetica', size: 7.5, color: C.gray, align: 'right', pad: 4 });
    cell(doc, fmtUSD(item.labor_cost_usd), cols[5].x, y + 5, cols[5].w, { font: 'Helvetica', size: 7.5, color: C.dark, align: 'right', pad: 4 });
    cell(doc, fmtUSD(item.line_total_usd), cols[6].x, y + 5, cols[6].w, { font: 'Helvetica-Bold', size: 7.5, color: C.dark, align: 'right', pad: 4 });

    y += ROW_H;
  });

  // Bottom border of table
  doc.moveTo(L, y).lineTo(R, y).strokeColor(C.border).lineWidth(0.5).stroke();

  // ── SUMMARY (bottom-right block, 220pt wide) ───────────────────────────────
  y += 16;
  const SX  = R - 220;   // summary block left edge
  const SW  = 220;       // summary block width

  const s = quoteData.summary || {};

  const summaryRow = (label, value, yPos, bold = false) => {
    const fnt = bold ? 'Helvetica-Bold' : 'Helvetica';
    const sz  = bold ? 10 : 9;
    doc.font(fnt).fontSize(sz).fillColor(C.dark)
       .text(label, SX, yPos, { width: SW * 0.55, lineBreak: false });
    doc.font(fnt).fontSize(sz).fillColor(C.dark)
       .text(value, SX, yPos, { width: SW, align: 'right', lineBreak: false });
  };

  summaryRow('PARTS TOTAL', fmtUSD(s.parts_total_usd || 0), y);
  summaryRow('LABOR TOTAL', fmtUSD(s.labor_total_usd || 0), y + 14);

  // Double rule
  const ruleY = y + 30;
  doc.moveTo(SX, ruleY).lineTo(R, ruleY).strokeColor(C.dark).lineWidth(0.8).stroke();
  doc.moveTo(SX, ruleY + 3).lineTo(R, ruleY + 3).strokeColor(C.dark).lineWidth(0.8).stroke();

  // Grand total
  const gtY = ruleY + 10;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.dark)
     .text('GRAND TOTAL', SX, gtY, { width: SW * 0.55, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.dark)
     .text(fmtUSD(s.grand_total_usd || 0), SX, gtY, { width: SW, align: 'right', lineBreak: false });

  doc.font('Helvetica').fontSize(7).fillColor(C.gray)
     .text('All prices in USD · Labor rate: $125.00/hr', SX, gtY + 18, { width: SW, align: 'right' });

  // ── FOOTER ────────────────────────────────────────────────────────────────
  const FY = 742;
  doc.moveTo(L, FY).lineTo(R, FY).strokeColor(C.border).lineWidth(0.5).stroke();

  const FTY = FY + 8;
  doc.font('Helvetica').fontSize(7).fillColor(C.gray);
  doc.text('Generated by ApexFitment Engine v1.0 · apexfitment.com', L, FTY,
           { width: W * 0.38, lineBreak: false });
  doc.text('Houston, TX 77096 · United States', L + W * 0.38, FTY,
           { width: W * 0.24, align: 'center', lineBreak: false });
  doc.text('This quote is valid for 30 days from generation date', L + W * 0.62, FTY,
           { width: W * 0.38, align: 'right', lineBreak: false });

  doc.end();
}

module.exports = { generateQuotePdf };
