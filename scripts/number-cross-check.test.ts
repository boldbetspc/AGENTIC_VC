import assert from "node:assert/strict";
import {
  analyzeNumbers,
  isGenericQuestion,
  NARRATIVE_CROSSCHECK_SYSTEM,
  NUMERIC_EXTRACTION_SYSTEM,
  tightenEvidence,
  topImprovements,
  type NumericRow,
} from "../supabase/functions/review-pitch/numbers.ts";

function joined(ledger: NumericRow[], narrative: string) {
  const work = analyzeNumbers({ ledger, narrative });
  return {
    work,
    text: work.findings.map((finding) => finding.text).join("\n"),
  };
}

const shared = joined(
  [
    { metric: "Enterprise ARR", value: "$2M", slide: "S3", period: "" },
    { metric: "Enterprise customers", value: "200", slide: "S3", period: "" },
    { metric: "Product B ARR", value: "$1.5M", slide: "S7", period: "" },
    { metric: "Product B customers", value: "200", slide: "S7", period: "" },
  ],
  "Two revenue lines. Enterprise is why this works. The second product expands the same motion.",
);
assert.match(shared.text, /cannot be added|same names|different/i);
assert.equal(shared.work.findings.some((finding) => finding.severity === "flag"), true);
assert.doesNotMatch(shared.work.sharpestQuestion, /best proves the wedge/i);

const retention = joined(
  [
    { metric: "Retention", value: "40%", slide: "S9", period: "M1" },
    { metric: "Retention", value: "39%", slide: "S9", period: "M2" },
    { metric: "Retention", value: "38%", slide: "S9", period: "M3" },
    { metric: "Retention", value: "37%", slide: "S9", period: "M6" },
  ],
  "Our moat is compounding. Retention improves as the network grows, which is why we'll retain users.",
);
assert.match(retention.text, /does not support|Direction: down|Direction: flat/i);
assert.match(retention.work.promptBlock, /40% → 37%/);
assert.equal(retention.work.growth[0]?.direction, "down");
assert.doesNotMatch(retention.work.growth.map((series) => series.rate).join(" "), /growing/i);
assert.match(retention.work.sharpestQuestion, /retention|compound/i);

const cac = joined(
  [
    { metric: "Blended CAC", value: "$40", slide: "S5", period: "" },
    { metric: "LTV", value: "$200", slide: "S5", period: "" },
    { metric: "Paid social CAC", value: "$180", slide: "S11", period: "" },
    { metric: "Organic CAC", value: "$8", slide: "S11", period: "" },
    { metric: "Paid share of new users", value: "80%", slide: "S11", period: "" },
  ],
  "Efficient growth. Blended CAC shows a healthy engine.",
);
assert.match(cac.text, /blend hides|paid channel|1\.1x/i);
assert.match(cac.text, /5x/);
assert.match(cac.text, /80%/);

const clean = analyzeNumbers({
  ledger: [
    { metric: "LTV", value: "$300", slide: "S4", period: "" },
    { metric: "CAC", value: "$60", slide: "S4", period: "" },
  ],
  narrative: "Software subscription with a measured payback.",
});
assert.equal(clean.findings.some((finding) => finding.severity === "flag"), false);
assert.match(clean.findings.map((finding) => finding.text).join(" "), /5x/);

const presence = tightenEvidence([
  { claim: "ARR is $2M", status: "supported" as const, source: "deck S3", note: "The slide states $2M ARR." },
  { claim: "ARR matches the chart", status: "supported" as const, source: "deck S8", note: "The figure agrees with the other revenue line." },
]);
assert.equal(presence[0].status, "weak");
assert.match(presence[0].note, /not shown to agree/);
assert.equal(presence[1].status, "supported");

assert.equal(topImprovements(shared.work.findings, 4).length <= 4, true);
assert.equal(isGenericQuestion("What single metric, with a date, best proves the wedge?"), true);
assert.match(NUMERIC_EXTRACTION_SYSTEM, /before any judgment/);
assert.match(NARRATIVE_CROSSCHECK_SYSTEM, /LTV:CAC/);
assert.match(NARRATIVE_CROSSCHECK_SYSTEM, /well-formatted language is not evidence/);
assert.match(NARRATIVE_CROSSCHECK_SYSTEM, /sharpest_question/);

console.log("number cross-check fixtures passed");
