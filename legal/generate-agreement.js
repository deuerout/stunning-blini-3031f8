#!/usr/bin/env node
/**
 * Fills legal/digital-royalty-licensing-agreement.md for one client deal.
 *
 * Usage:
 *   node legal/generate-agreement.js path/to/deal.json
 *
 * Deal config (JSON) fields -- all required except where noted:
 *   {
 *     "clientName": "Acme Robotics Ltd",
 *     "clientJurisdiction": "England and Wales",
 *     "clientEntityType": "private limited company",
 *     "clientAddress": "1 Example Street, London, EC1A 1AA",
 *     "effectiveDate": "1 October 2026",
 *     "agreementNumber": "DRLA-2026-001",
 *     "useCase": "internal analytics and client reporting",
 *     "licenseExclusivity": "non-exclusive",           // "non-exclusive" | "exclusive"
 *     "licenseTerritory": "worldwide",                  // "worldwide" | "territorial"
 *     "baseFee": "$12,000",
 *     "royaltyPct": "3",
 *     "royaltyCap": "$50,000",
 *     "cqFixedYears": "3",
 *     "cqAdjustmentCap": "5",
 *     "discountPct": "10",
 *     "initialTermYears": "3",
 *     "renewalTermYears": "1",
 *     "governingLaw": "England and Wales",
 *     "arbitrationCity": "London, England",
 *     "arbitrationRules": "LCIA",
 *     // Optional -- override Deverout's own party details if they change:
 *     "deveroutEntityType": "a sole trader trading as Deverout and Associates",
 *     "deveroutAddress": "Bedford, Bedfordshire, England [full registered address TBC]"
 *   }
 *
 * Output: legal/generated/<client-slug>-agreement.md (never overwrites an
 * existing file for the same client + agreement number -- pass a new
 * agreementNumber for an amended draft instead of clobbering a signed copy).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const TEMPLATE_PATH = path.join(__dirname, "digital-royalty-licensing-agreement.md");
const OUTPUT_DIR = path.join(__dirname, "generated");

const DEFAULTS = {
  deveroutEntityType: "[Deverout's registered entity type -- TBC]",
  deveroutAddress: "Bedford, Bedfordshire, England [full registered address TBC]",
};

const REQUIRED_FIELDS = [
  "clientName",
  "clientJurisdiction",
  "clientEntityType",
  "clientAddress",
  "effectiveDate",
  "agreementNumber",
  "useCase",
  "licenseExclusivity",
  "licenseTerritory",
  "baseFee",
  "royaltyPct",
  "royaltyCap",
  "cqFixedYears",
  "cqAdjustmentCap",
  "discountPct",
  "initialTermYears",
  "renewalTermYears",
  "governingLaw",
  "arbitrationCity",
  "arbitrationRules",
];

const TOKEN_MAP = {
  CLIENT_NAME: "clientName",
  CLIENT_JURISDICTION: "clientJurisdiction",
  CLIENT_ENTITY_TYPE: "clientEntityType",
  CLIENT_ADDRESS: "clientAddress",
  EFFECTIVE_DATE: "effectiveDate",
  AGREEMENT_NUMBER: "agreementNumber",
  USE_CASE: "useCase",
  LICENSE_EXCLUSIVITY: "licenseExclusivity",
  LICENSE_TERRITORY: "licenseTerritory",
  BASE_FEE: "baseFee",
  ROYALTY_PCT: "royaltyPct",
  ROYALTY_CAP: "royaltyCap",
  CQ_FIXED_YEARS: "cqFixedYears",
  CQ_ADJUSTMENT_CAP: "cqAdjustmentCap",
  DISCOUNT_PCT: "discountPct",
  INITIAL_TERM_YEARS: "initialTermYears",
  RENEWAL_TERM_YEARS: "renewalTermYears",
  GOVERNING_LAW: "governingLaw",
  ARBITRATION_CITY: "arbitrationCity",
  ARBITRATION_RULES: "arbitrationRules",
  DEVEROUT_ENTITY_TYPE: "deveroutEntityType",
  DEVEROUT_ADDRESS: "deveroutAddress",
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fillTemplate(template, deal) {
  let out = template;
  for (const [token, field] of Object.entries(TOKEN_MAP)) {
    const value = deal[field];
    out = out.split(`{{${token}}}`).join(String(value));
  }
  return out;
}

function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: node legal/generate-agreement.js path/to/deal.json");
    process.exit(1);
  }

  const deal = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };

  const missing = REQUIRED_FIELDS.filter((f) => !deal[f]);
  if (missing.length > 0) {
    console.error(`Deal config is missing required field(s): ${missing.join(", ")}`);
    process.exit(1);
  }

  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const filled = fillTemplate(template, deal);

  const unfilled = filled.match(/\{\{[A-Z_]+\}\}/g);
  if (unfilled) {
    console.error(`Template still contains unfilled tokens after generation: ${[...new Set(unfilled)].join(", ")}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `${slugify(deal.clientName)}-${slugify(deal.agreementNumber)}-agreement.md`);

  if (fs.existsSync(outPath)) {
    console.error(`${outPath} already exists -- use a new agreementNumber rather than overwriting an existing draft.`);
    process.exit(1);
  }

  fs.writeFileSync(outPath, filled, "utf8");
  console.log(`Wrote ${outPath}`);
}

main();
