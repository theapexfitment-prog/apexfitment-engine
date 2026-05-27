'use strict';

function calculateFrictionScore(lineItems, buildConfig) {
  let score = 1.0;
  const factors = [];

  const itemCount  = lineItems.length;
  const fabItems   = lineItems.filter(li => li.fabrication_required).length;
  const hasTrans   = lineItems.some(li => /transmission/i.test(li.product_type));
  const hasSC      = lineItems.some(li => /supercharger/i.test(li.product_type));
  const hasHeaders = lineItems.some(li => /header/i.test(li.product_type));
  const hasCam     = lineItems.some(li => /camshaft/i.test(li.product_type));
  const is4WD      = /4wd|4x4|awd/i.test(buildConfig?.drivetrain || '');

  // Factor 1: item count
  if (itemCount >= 6) {
    score += 2.5; factors.push('Complex multi-part build (6+ parts) +2.5');
  } else if (itemCount >= 4) {
    score += 1.5; factors.push('Multi-part build (4–5 parts) +1.5');
  } else if (itemCount >= 2) {
    score += 0.5; factors.push('Multi-part build (2–3 parts) +0.5');
  }

  // Factor 2: fabrication required
  if (fabItems >= 2) {
    score += 2.0; factors.push('Multiple fabrication-required parts +2.0');
  } else if (fabItems === 1) {
    score += 1.0; factors.push('Fabrication required +1.0');
  }

  // Factor 3: transmission swap
  if (hasTrans) {
    score += 1.5; factors.push('Transmission swap +1.5');
  }

  // Factor 4: supercharger + headers combo
  if (hasSC && hasHeaders) {
    score += 1.5; factors.push('Supercharger + headers forced induction combo +1.5');
  }

  // Factor 5: 4WD/AWD drivetrain
  if (is4WD) {
    score += 1.0; factors.push('4WD/AWD drivetrain +1.0');
  }

  // Factor 6: camshaft replacement
  if (hasCam) {
    score += 1.0; factors.push('Camshaft replacement +1.0');
  }

  score = Math.min(10, Math.round(score * 10) / 10);

  let complexity_label, labor_multiplier;
  if (score <= 3) {
    complexity_label = 'STANDARD';        labor_multiplier = 1.0;
  } else if (score <= 5) {
    complexity_label = 'MODERATE';        labor_multiplier = 1.25;
  } else if (score <= 7) {
    complexity_label = 'COMPLEX';         labor_multiplier = 1.5;
  } else if (score <= 8.5) {
    complexity_label = 'HIGH COMPLEXITY'; labor_multiplier = 1.75;
  } else {
    complexity_label = 'EXPERT ONLY';     labor_multiplier = 2.0;
  }

  const adjusted_labor_note = labor_multiplier > 1.0
    ? `Labor rates adjusted ${labor_multiplier}× for ${complexity_label.toLowerCase()} job complexity`
    : 'Standard labor rates applied';

  return { score, complexity_label, labor_multiplier, factors, adjusted_labor_note };
}

module.exports = { calculateFrictionScore };
