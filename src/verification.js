'use strict';

const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateVerificationId() {
  const year = new Date().getFullYear();
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return `AF-${year}-${code}`;
}

function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function frictionColor(score) {
  if (score <= 3)   return '#00AA55';
  if (score <= 5)   return '#88BB00';
  if (score <= 7)   return '#CC8800';
  if (score <= 8.5) return '#CC6600';
  return '#CC2222';
}

function formatDate(dtStr) {
  try {
    const d = new Date(dtStr.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC',
    }) + ' UTC';
  } catch (_) { return dtStr; }
}

function buildVerificationPage(row) {
  const items    = (() => { try { return JSON.parse(row.line_items_json || '[]'); } catch (_) { return []; } })();
  const score    = row.friction_score;
  const hasScore = score != null;
  const barColor = hasScore ? frictionColor(score) : '#888888';
  const barPct   = hasScore ? Math.round((score / 10) * 100) : 0;
  const shopLoc  = [row.city, row.state].filter(Boolean).join(', ');
  const compatible = items.filter(i => i.fitment_status !== 'INCOMPATIBLE');

  const compRows = compatible.map(i =>
    `<li><span class="comp-pn">${escHtml(i.part_number)}</span> <span class="comp-brand">${escHtml(i.brand)}</span>${i.fitment_status !== 'CONFIRMED' ? ' <span class="comp-fab">FAB REQ</span>' : ''}</li>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${escHtml(row.verification_id)} — ApexFitment Verification</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      background: #0a0a0f; color: #e2e2f0;
      font-family: 'Inter', system-ui, sans-serif; font-size: 15px; line-height: 1.6;
      min-height: 100svh;
    }
    body::before {
      content: ''; position: fixed; inset: 0; pointer-events: none;
      background-image:
        linear-gradient(rgba(0,212,255,.013) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,212,255,.013) 1px, transparent 1px);
      background-size: 48px 48px;
    }
    .container {
      position: relative; z-index: 1;
      max-width: 480px; margin: 0 auto; padding: 24px 16px 56px;
    }
    .vhdr {
      display: flex; align-items: flex-start; justify-content: space-between;
      padding-bottom: 20px; border-bottom: 1px solid #1e1e2e; margin-bottom: 24px;
    }
    .vhdr-brand { font-family: 'JetBrains Mono', monospace; font-size: 17px; font-weight: 700; letter-spacing: .18em; color: #00d4ff; text-shadow: 0 0 18px rgba(0,212,255,.3); }
    .vhdr-sub { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #6b6b80; letter-spacing: .06em; margin-top: 4px; }
    .vhdr-icon { font-size: 22px; color: #00d4ff; opacity: .5; margin-top: 2px; }
    .badge {
      display: flex; align-items: center; gap: 10px;
      background: rgba(0,255,136,.07); border: 1.5px solid rgba(0,255,136,.3);
      border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;
    }
    .badge-dot {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
      background: #00ff88; box-shadow: 0 0 10px #00ff88;
      animation: bpulse 2s ease-in-out infinite;
    }
    @keyframes bpulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
    .badge-text { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; color: #00ff88; }
    .vid-block { margin-bottom: 24px; }
    .field-lbl { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: .18em; text-transform: uppercase; color: #6b6b80; margin-bottom: 6px; }
    .vid-code { font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 700; color: #00d4ff; letter-spacing: .1em; }
    .divider { border: none; border-top: 1px solid #1e1e2e; margin: 20px 0; }
    .section-hdr { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; color: #6b6b80; margin-bottom: 14px; }
    .build-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .build-lbl { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #6b6b80; margin-bottom: 3px; }
    .build-val { font-family: 'JetBrains Mono', monospace; font-size: 15px; font-weight: 600; color: #e2e2f0; }
    .friction-block { background: #0d1117; border: 1px solid #1e1e2e; border-radius: 8px; padding: 16px 18px; }
    .friction-top { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
    .friction-score { font-family: 'JetBrains Mono', monospace; font-size: 34px; font-weight: 700; line-height: 1; }
    .friction-denom { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #6b6b80; }
    .friction-label-txt { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .06em; margin-left: auto; }
    .fr-bar-track { height: 8px; background: #1a1a28; border-radius: 4px; overflow: hidden; }
    .fr-bar-fill { height: 100%; border-radius: 4px; transition: width .6s ease; }
    .comp-list { list-style: none; }
    .comp-list li {
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
      padding: 9px 0; border-bottom: 1px solid #15151f;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
    }
    .comp-list li:last-child { border-bottom: none; }
    .comp-bullet { color: #00d4ff; font-size: 13px; flex-shrink: 0; }
    .comp-pn { color: #e2e2f0; font-weight: 600; }
    .comp-brand { color: #6b6b80; }
    .comp-fab { font-size: 8px; font-weight: 700; background: rgba(255,184,0,.1); color: #ffb800; border: 1px solid rgba(255,184,0,.28); border-radius: 3px; padding: 1px 5px; letter-spacing: .05em; }
    .total-block {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 18px; background: rgba(0,255,136,.04);
      border: 1.5px solid rgba(0,255,136,.2); border-radius: 8px;
    }
    .total-lbl { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #6b6b80; }
    .total-val { font-family: 'JetBrains Mono', monospace; font-size: 24px; font-weight: 700; color: #00ff88; }
    .cert-shop { font-family: 'JetBrains Mono', monospace; font-size: 17px; font-weight: 700; color: #e2e2f0; }
    .cert-loc { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #6b6b80; margin-top: 4px; }
    .cert-date { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #4a4a5e; margin-top: 10px; }
    .disclaimer { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #4a4a5e; line-height: 1.8; }
    .vfooter { margin-top: 32px; padding-top: 20px; border-top: 1px solid #15151f; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #4a4a5e; }
    .vfooter a { color: #00d4ff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">

    <div class="vhdr">
      <div>
        <div class="vhdr-brand">APEXFITMENT</div>
        <div class="vhdr-sub">⚙ Engineering Verification</div>
      </div>
      <div class="vhdr-icon">⬡</div>
    </div>

    <div class="badge">
      <div class="badge-dot"></div>
      <span class="badge-text">✓ VERIFIED BUILD</span>
    </div>

    <div class="vid-block">
      <div class="field-lbl">Verification ID</div>
      <div class="vid-code">${escHtml(row.verification_id)}</div>
    </div>

    <hr class="divider">

    <div class="section-hdr">Build Configuration</div>
    <div class="build-grid">
      <div><div class="build-lbl">Year</div><div class="build-val">${escHtml(String(row.vehicle_year || '—'))}</div></div>
      <div><div class="build-lbl">Make</div><div class="build-val">${escHtml(row.vehicle_make || '—')}</div></div>
      <div><div class="build-lbl">Model</div><div class="build-val">${escHtml(row.vehicle_model || '—')}</div></div>
      <div><div class="build-lbl">Engine</div><div class="build-val">${escHtml(row.vehicle_engine || '—')}</div></div>
      ${row.vehicle_submodel ? `<div><div class="build-lbl">Submodel</div><div class="build-val">${escHtml(row.vehicle_submodel)}</div></div>` : ''}
      ${row.vehicle_drivetrain ? `<div><div class="build-lbl">Drivetrain</div><div class="build-val">${escHtml(row.vehicle_drivetrain)}</div></div>` : ''}
    </div>

    ${hasScore ? `
    <hr class="divider">
    <div class="section-hdr">Friction Analysis</div>
    <div class="friction-block">
      <div class="friction-top">
        <div class="friction-score" style="color:${barColor};">${Number(score).toFixed(1)}</div>
        <div class="friction-denom">/ 10</div>
        <div class="friction-label-txt" style="color:${barColor};">${escHtml(row.friction_label || '')}</div>
      </div>
      <div class="fr-bar-track">
        <div class="fr-bar-fill" style="width:${barPct}%;background:${barColor};"></div>
      </div>
    </div>` : ''}

    <hr class="divider">
    <div class="section-hdr">Compatible Components (${compatible.length})</div>
    <ul class="comp-list">
      ${compRows || '<li><span class="comp-brand" style="color:#4a4a5e;">No components listed</span></li>'}
    </ul>

    <hr class="divider">
    <div class="total-block">
      <div class="total-lbl">Total Build Investment</div>
      <div class="total-val">${fmtCurrency(row.grand_total)}</div>
    </div>

    <hr class="divider">
    <div class="section-hdr">Certified By</div>
    <div class="cert-shop">${escHtml(row.shop_name)}</div>
    ${shopLoc ? `<div class="cert-loc">${escHtml(shopLoc)}</div>` : ''}
    <div class="cert-date">Verified: ${formatDate(row.created_at)}</div>

    <hr class="divider">
    <p class="disclaimer">This build configuration was cross-referenced against the ApexFitment fitment matrix on the date shown. All compatible parts confirmed for declared build variables. ${escHtml(String(row.variables_count || 8))} mechanical variables cross-validated.</p>

    <div class="vfooter">
      Powered by <a href="https://apexfitment.com">ApexFitment</a><br>apexfitment.com
    </div>

  </div>
</body>
</html>`;
}

function buildNotFoundPage(vid) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Found — ApexFitment</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; color: #e2e2f0; font-family: 'JetBrains Mono', monospace; min-height: 100svh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .box { max-width: 380px; text-align: center; }
    .logo { font-size: 15px; font-weight: 700; letter-spacing: .18em; color: #00d4ff; margin-bottom: 36px; }
    .code { font-size: 52px; font-weight: 700; color: #ff4444; margin-bottom: 10px; }
    .msg { font-size: 12px; color: #6b6b80; line-height: 1.9; }
    .vid { font-size: 13px; color: #2a2a3a; margin-top: 20px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="box">
    <div class="logo">APEXFITMENT</div>
    <div class="code">404</div>
    <div class="msg">Verification record not found.<br>This ID may be invalid or has not been issued.</div>
    <div class="vid">${escHtml(String(vid || ''))}</div>
  </div>
</body>
</html>`;
}

module.exports = { generateVerificationId, buildVerificationPage, buildNotFoundPage };
