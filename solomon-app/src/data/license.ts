/**
 * Sample license data for the first screen of the client portal.
 *
 * This is the same Acme Robotics Ltd test deal used throughout the
 * Solomon licensing work (legal/generate-agreement.js, the webhook demo
 * scripts) -- illustrative, not a real client, and not yet wired to any
 * live data source. The data tier shown is a plausible placeholder (no
 * tier was recorded against this test deal); everything else matches the
 * actual generated agreement, DRLA-2026-001.
 */
export interface LicenseSummary {
  clientName: string;
  agreementNumber: string;
  status: "Active" | "Pending" | "Expired";
  effectiveDate: string;
  renewalDate: string;
  dataTier: {
    name: string;
    accessLevel: string;
  };
  baseFee: string;
  royalty: string;
  continuousQuoteFixedYears: number;
}

export const sampleLicense: LicenseSummary = {
  clientName: "Acme Robotics Ltd",
  agreementNumber: "DRLA-2026-001",
  status: "Active",
  effectiveDate: "1 October 2026",
  renewalDate: "1 October 2029",
  dataTier: {
    name: "Tier 2 — Enhanced Analytics",
    accessLevel: "API + Dashboard Access",
  },
  baseFee: "$12,000 / year",
  royalty: "3% of Gross Revenue, capped at $50,000 / year",
  continuousQuoteFixedYears: 3,
};
