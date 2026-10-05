/**
 * Number diligence — runs before scoring.
 * A figure that only appears in the text is not support.
 * Rates are computed here; later passes are not allowed to say "growing" without one.
 */

export type NumericRow = {
  metric: string;
  value: string;
  slide: string;
  period: string;
};

export type GrowthRate = {
  metric: string;
  fromPeriod: string;
  toPeriod: string;
  fromValue: string;
  toValue: string;
  rate: string;
  direction: "up" | "down" | "flat";
};

export type NumberFinding = {
  kind: "growth" | "consistency" | "reframe" | "pair" | "heuristic";
  severity: "flag" | "note";
  text: string;
  question: string;
};

export type NumberWork = {
  growth: GrowthRate[];
  findings: NumberFinding[];
  sharpestQuestion: string;
  promptBlock: string;
};

export type ClaimStatus = "supported" | "weak" | "unsupported" | "unknown";

export type ClaimRow = {
  claim: string;
  status: ClaimStatus;
  source: string;
  note: string;
};

type Parsed = { n: number; kind: "money" | "pct" | "multiple" | "months" | "count" };

type Normalized = NumericRow & { key: string; parsed: Parsed };

export const NUMERIC_EXTRACTION_SYSTEM = `You extract every numeric claim from startup materials before any judgment.
Return JSON only: {"rows":[{"metric":"short name","value":"the figure as written","slide":"S3 or chart or website or brief","period":"M1, Q2 2024, 2023, or empty"}]}
Rules:
- One row per number. Do not merge a series into "growing" or "up".
- If a chart has six points, return six rows with the period on each.
- Include currency, percentages, counts, multiples, and time spans.
- Copy the value as written. Do not invent a number that is not in the materials.
- No scores, no opinions, no recommendations.`;

export const NARRATIVE_CROSSCHECK_SYSTEM = `You cross-check a startup pitch against a numeric ledger that was extracted first. Educational review only.
Confident, specific, well-formatted language is not evidence. Ignore how polished the writing is.
Return JSON:
{"consistency":[{"claim":"the causal or strategic sentence","metric":"the figure that should support it","comparison":"what the figures actually do","tension":"aligned|gap|missing"}],
 "reframes":[{"stat":"a positively presented figure","risk":"the dependency or concentration it also implies"}],
 "pairs":[{"left":"metric and value","right":"related metric and value","gap":"what is unexplained"}],
 "sharpest_question":"one question"}
Rules:
- For every "why this works", "moat", or "why we retain" claim, name the metric elsewhere that should support it and compare them.
- Use COMPUTED GROWTH as written. Never conclude "growing" unless a computed rate is positive. If the rate is flat or down, say that.
- A number that is merely stated is not support. aligned requires the figures to agree with each other.
- When two related figures both exist (buyer vs seller satisfaction, gross vs contribution margin, stated accuracy vs return or error rate, blended vs channel CAC), compare them and describe any gap.
- LTV:CAC near 3x, CAC payback under about 12 months, and gross margin ranges (software often ~60%+, marketplaces often ~20-30%+) are general seed-stage references. Apply them only when those inputs are actually in the ledger. Do not invent a missing input. Do not treat the references as a rule written for one deck.
- sharpest_question must come from a tension you just found. Name the figures. Do not ask a generic "what metric proves the wedge" question.
- Max 6 consistency rows, 4 reframes, 4 pairs. No funding, valuation, or equity language.`;

const GENERIC_QUESTION =
  /best proves (the |your )?wedge|strongest proof|single metric, with a date|what would you (measure|change)|tell me more about|what metric would/i;

export function isGenericQuestion(question: string): boolean {
  return GENERIC_QUESTION.test(question);
}

function parseMagnitude(raw: string): Parsed | null {
  const text = raw.trim().toLowerCase().replace(/,/g, "");
  if (!/\d/.test(text)) return null;
  const numMatch = text.match(/-?\d+(?:\.\d+)?/);
  if (!numMatch) return null;
  let n = Number(numMatch[0]);
  if (!Number.isFinite(n)) return null;
  const suffix = text.match(/(\d+(?:\.\d+)?)\s*(k|mm|million|bn|billion|m|b)\b/);
  if (suffix) {
    const unit = suffix[2];
    const mult = unit === "k" ? 1e3 : unit === "b" || unit === "bn" || unit === "billion" ? 1e9 : 1e6;
    n = Number(suffix[1]) * mult;
  }
  if (/%|percent/.test(text)) return { n, kind: "pct" };
  if (/\bx\b|\btimes\b/.test(text)) return { n, kind: "multiple" };
  if (/month/.test(text)) return { n, kind: "months" };
  if (/[$€£]|\busd\b|\beur\b|\bgbp\b/.test(text) || suffix) return { n, kind: "money" };
  return { n, kind: "count" };
}

function periodInfo(period: string): { family: string; order: number } | null {
  const p = period.trim().toLowerCase();
  if (!p) return null;
  let m = p.match(/\b(?:month|m)\s*(\d{1,2})\b/);
  if (m) return { family: "month", order: Number(m[1]) };
  m = p.match(/\bq\s*([1-4])(?:\s*'?(\d{2,4}))?/);
  if (m) {
    const rawYear = m[2] ? Number(m[2].length === 2 ? `20${m[2]}` : m[2]) : 0;
    return { family: rawYear ? `quarter-${rawYear}` : "quarter", order: rawYear * 4 + Number(m[1]) };
  }
  m = p.match(/\by(?:ear)?\s*(\d{1,2})\b/);
  if (m) return { family: "year-index", order: Number(m[1]) };
  m = p.match(/\b(20\d{2})\b/);
  if (m) return { family: "year", order: Number(m[1]) };
  return null;
}

function normalizeRow(row: NumericRow): Normalized | null {
  let metric = String(row.metric || "").trim();
  let period = String(row.period || "").trim();
  const slide = String(row.slide || "").trim() || "unspecified";
  const value = String(row.value || "").trim();
  if (!period) {
    const found = metric.match(/\b(?:month\s*\d{1,2}|m\d{1,2}|q[1-4](?:\s*'?\d{2,4})?|year\s*\d{1,2}|20\d{2})\b/i);
    if (found) {
      period = found[0];
      metric = `${metric.slice(0, found.index)} ${metric.slice((found.index || 0) + found[0].length)}`;
    }
  }
  const key = metric
    .toLowerCase()
    .replace(/\b(?:month\s*\d{1,2}|m\d{1,2}|q[1-4]|year\s*\d{1,2}|20\d{2})\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = parseMagnitude(value);
  if (!parsed || !key) return null;
  return { metric: metric.replace(/\s+/g, " ").trim(), value, slide, period, key, parsed };
}

function signed(n: number, digits = 1): string {
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function relativeRate(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function directionOf(kind: Parsed["kind"], from: number, to: number): GrowthRate["direction"] {
  if (kind === "pct") {
    const pp = to - from;
    if (Math.abs(pp) < 2) return "flat";
    return pp > 0 ? "up" : "down";
  }
  const rel = relativeRate(from, to);
  if (rel == null || Math.abs(rel) < 5) return "flat";
  return rel > 0 ? "up" : "down";
}

function rateLabel(kind: Parsed["kind"], from: number, to: number, fromValue: string, toValue: string): string {
  if (kind === "pct") {
    const pp = to - from;
    const rel = relativeRate(from, to);
    const relText = rel == null ? "from zero" : `${signed(rel)}%`;
    return `${fromValue} → ${toValue} (${signed(pp)} pp, ${relText})`;
  }
  const rel = relativeRate(from, to);
  return `${fromValue} → ${toValue} (${rel == null ? "from zero" : `${signed(rel)}%`})`;
}

function computeGrowth(rows: Normalized[]): GrowthRate[] {
  const groups = new Map<string, Normalized[]>();
  for (const row of rows) {
    if (!periodInfo(row.period)) continue;
    const bucket = groups.get(`${row.key}|${row.parsed.kind}`) || [];
    bucket.push(row);
    groups.set(`${row.key}|${row.parsed.kind}`, bucket);
  }
  const rates: GrowthRate[] = [];
  for (const bucket of groups.values()) {
    const families = new Map<string, Normalized[]>();
    for (const row of bucket) {
      const info = periodInfo(row.period);
      if (!info) continue;
      const list = families.get(info.family) || [];
      list.push(row);
      families.set(info.family, list);
    }
    for (const list of families.values()) {
      const sorted = [...list].sort((a, b) => (periodInfo(a.period)?.order || 0) - (periodInfo(b.period)?.order || 0));
      if (sorted.length < 2) continue;
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      rates.push({
        metric: first.metric,
        fromPeriod: first.period,
        toPeriod: last.period,
        fromValue: first.value,
        toValue: last.value,
        rate: rateLabel(first.parsed.kind, first.parsed.n, last.parsed.n, first.value, last.value),
        direction: directionOf(first.parsed.kind, first.parsed.n, last.parsed.n),
      });
    }
  }
  return rates;
}

function moneyRows(rows: Normalized[], pattern: RegExp): Normalized[] {
  return rows.filter((row) => row.parsed.kind === "money" && pattern.test(row.key));
}

function findRow(rows: Normalized[], pattern: RegExp, kind?: Parsed["kind"]): Normalized | undefined {
  return rows.find((row) => pattern.test(row.key) && (!kind || row.parsed.kind === kind));
}

function sameCount(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale <= 0.02;
}

function buildFindings(rows: Normalized[], growth: GrowthRate[], narrative: string): NumberFinding[] {
  const findings: NumberFinding[] = [];
  const text = narrative.toLowerCase();

  for (const series of growth) {
    const relevant = /retention|repeat|cohort|revenue|gmv|users|mrr|arr/.test(series.metric.toLowerCase());
    const flag = series.direction !== "up" && relevant && /grow|compound|scal|moat|retain/.test(text);
    findings.push({
      kind: "growth",
      severity: flag ? "flag" : "note",
      text: `${series.metric} ${series.fromPeriod}→${series.toPeriod}: ${series.rate}. Direction: ${series.direction}.`,
      question: flag
        ? `${series.metric} goes ${series.rate}. What mechanism still supports the growth or moat claim?`
        : `What sits behind the ${series.metric} change of ${series.rate}?`,
    });
  }

  if (/compound|moat|retention (improves|increases|compounds|rises)|why we(?:'|’)ll retain|network effect/.test(text)) {
    const retention = growth.find((series) => /retention|repeat|cohort/.test(series.metric.toLowerCase()) && series.direction !== "up");
    if (retention) {
      findings.push({
        kind: "consistency",
        severity: "flag",
        text: `${retention.metric} is ${retention.direction} (${retention.rate}). That does not support a compounding-retention or moat claim.`,
        question: `${retention.metric} moved ${retention.rate}. What, specifically, is compounding?`,
      });
    }
  }

  const customerCounts = rows.filter((row) => row.parsed.kind === "count" && /customer|logo|account|buyer|merchant|supplier/.test(row.key));
  const revenueLines = moneyRows(rows, /arr|revenue|gmv|sales|bookings/);
  for (let i = 0; i < customerCounts.length; i++) {
    for (let j = i + 1; j < customerCounts.length; j++) {
      const a = customerCounts[i];
      const b = customerCounts[j];
      if (a.slide === b.slide || !sameCount(a.parsed.n, b.parsed.n) || revenueLines.length < 2) continue;
      findings.push({
        kind: "consistency",
        severity: "flag",
        text: `${a.slide} ${a.metric} is ${a.value} and ${b.slide} ${b.metric} is ${b.value}. Those revenue lines cannot be added until the customer bases are shown to be different.`,
        question: `Are the ${a.value} ${a.metric} on ${a.slide} the same names as the ${b.value} ${b.metric} on ${b.slide}?`,
      });
    }
  }

  const blendedCac = rows.find((row) => row.parsed.kind === "money" && /cac/.test(row.key) && /blend|average|overall|all in/.test(row.key));
  const channelCac = rows.find((row) => row.parsed.kind === "money" && /cac/.test(row.key) && /paid|performance|ads|meta|google|facebook|tiktok|channel/.test(row.key));
  const paidShare = rows.find((row) => row.parsed.kind === "pct" && /paid/.test(row.key) && /share|users|acquisition|mix/.test(row.key));
  if (blendedCac && channelCac && channelCac.parsed.n > blendedCac.parsed.n * 1.75) {
    const share = paidShare ? ` Paid is ${paidShare.value} of new users.` : "";
    findings.push({
      kind: "pair",
      severity: "flag",
      text: `Blended CAC is ${blendedCac.value} (${blendedCac.slide}); the paid channel is ${channelCac.value} (${channelCac.slide}).${share} The blend hides the channel the growth depends on.`,
      question: `If paid CAC stays at ${channelCac.value}, what happens to the ${blendedCac.value} blended figure as that channel becomes more of the mix?`,
    });
  }

  const pairSpecs: Array<{ left: RegExp; right: RegExp; label: string }> = [
    { left: /buyer/, right: /seller/, label: "buyer vs seller satisfaction" },
    { left: /gross margin/, right: /contribution margin/, label: "gross vs contribution margin" },
    { left: /accuracy/, right: /return|error|refund/, label: "stated accuracy vs error rate" },
  ];
  for (const spec of pairSpecs) {
    const left = rows.find((row) => spec.left.test(row.key));
    const right = rows.find((row) => spec.right.test(row.key) && row.parsed.kind === left?.parsed.kind);
    if (!left || !right) continue;
    const gap = Math.abs(left.parsed.n - right.parsed.n);
    const bad = spec.label.startsWith("stated")
      ? left.parsed.kind === "pct" && left.parsed.n >= 90 && right.parsed.n >= 10
      : spec.label.startsWith("gross")
        ? right.parsed.n > left.parsed.n || gap >= 20
        : gap >= 15;
    findings.push({
      kind: "pair",
      severity: bad ? "flag" : "note",
      text: `${spec.label}: ${left.metric} ${left.value} (${left.slide}) vs ${right.metric} ${right.value} (${right.slide}).${bad ? " The gap is unexplained." : " The pair is close."}`,
      question: `Why is ${left.metric} ${left.value} while ${right.metric} is ${right.value}?`,
    });
  }

  const ltv = findRow(rows, /\bltv\b|lifetime value/, "money");
  const cac = findRow(rows, /\bcac\b|acquisition cost/, "money");
  if (ltv && cac && cac.parsed.n > 0) {
    const ratio = ltv.parsed.n / cac.parsed.n;
    const shown = `${Math.round(ratio * 10) / 10}x`;
    const severity = ratio < 2 ? "flag" : "note";
    const read = ratio < 2
      ? "below a ~2x concern line"
      : ratio < 3
        ? "under the ~3x seed-stage reference"
        : "at or above the ~3x seed-stage reference";
    findings.push({
      kind: "heuristic",
      severity,
      text: `LTV ${ltv.value} / CAC ${cac.value} = ${shown}, ${read}.`,
      question: ratio < 3
        ? `What has to change for LTV ${ltv.value} and CAC ${cac.value} to clear a ~3x reference?`
        : `Which cohort produces the ${shown} LTV to CAC, and does it survive without the cheapest channel?`,
    });
    if (channelCac && channelCac.parsed.n > 0) {
      const paidRatio = Math.round((ltv.parsed.n / channelCac.parsed.n) * 10) / 10;
      if (paidRatio < 2) {
        findings.push({
          kind: "heuristic",
          severity: "flag",
          text: `The same LTV ${ltv.value} over paid CAC ${channelCac.value} is ${paidRatio}x, under the ~2x concern line, even if the blended ratio looks fine.`,
          question: `Does LTV ${ltv.value} still work at a ${channelCac.value} paid CAC?`,
        });
      }
    }
  }

  const payback = rows.find((row) => row.parsed.kind === "months" && /payback|cac payback/.test(row.key));
  if (payback) {
    const slow = payback.parsed.n > 18;
    findings.push({
      kind: "heuristic",
      severity: slow ? "flag" : "note",
      text: `CAC payback is ${payback.value} (${payback.slide}). Seed-stage reference is under about 12 months; over about 18 is a concern.${slow ? " This is past that." : ""}`,
      question: slow
        ? `What shortens payback from ${payback.value}?`
        : `Is the ${payback.value} payback measured on the paid channel or on the blend?`,
    });
  }

  const gross = findRow(rows, /gross margin/, "pct");
  if (gross) {
    const marketplace = /marketplace|take rate|gmv/.test(text);
    const software = /saas|software|subscription/.test(text);
    const thin = marketplace ? gross.parsed.n < 25 : software ? gross.parsed.n < 60 : gross.parsed.n < 20;
    const range = marketplace
      ? "marketplace references often sit around 20-30%+"
      : software
        ? "software references often sit around 60%+"
        : "software references often sit around 60%+ and marketplace references around 20-30%+";
    findings.push({
      kind: "heuristic",
      severity: thin ? "flag" : "note",
      text: `Gross margin is ${gross.value} (${gross.slide}). ${range}.`,
      question: thin
        ? `What takes gross margin from ${gross.value} toward a durable range?`
        : `Is ${gross.value} gross margin contribution margin after variable costs, or only a headline?`,
    });
  }

  for (const row of rows) {
    const logos = row.parsed.kind === "count" && /logo|partner|design partner/.test(row.key) && row.parsed.n > 0 && row.parsed.n <= 8;
    const concentration = row.parsed.kind === "pct" && /concentration|share|top |largest|single customer|one customer/.test(row.key) && row.parsed.n >= 40;
    if (!logos && !concentration) continue;
    findings.push({
      kind: "reframe",
      severity: "flag",
      text: `${row.slide} presents ${row.metric} ${row.value} as a strength. It also means the case depends on that small set.`,
      question: `What happens to the story if one of the ${row.value} ${row.metric} leaves?`,
    });
  }

  return findings;
}

function fallbackQuestion(rows: Normalized[]): string {
  if (rows.length >= 2) {
    const a = rows[0];
    const b = rows[1];
    return `${a.slide} shows ${a.metric} ${a.value} and ${b.slide} shows ${b.metric} ${b.value}. Which of those has to stay true for the other to hold?`;
  }
  if (rows.length === 1) {
    const a = rows[0];
    return `What other figure in the materials has to agree with ${a.metric} ${a.value} on ${a.slide}?`;
  }
  return "Which two figures in the materials have to agree, and do they?";
}

export function renderNumberBlock(ledger: NumericRow[], growth: GrowthRate[], findings: NumberFinding[], question: string): string {
  const ledgerLines = ledger.slice(0, 80).map((row) => {
    const period = row.period ? ` | ${row.period}` : "";
    return `- ${row.slide || "unspecified"} | ${row.metric} | ${row.value}${period}`;
  });
  const growthLines = growth.map((series) => `- ${series.metric} ${series.fromPeriod}→${series.toPeriod}: ${series.rate} [${series.direction}]`);
  const findingLines = findings.slice(0, 12).map((finding) => `- (${finding.severity}) ${finding.text}`);
  return [
    "NUMERIC LEDGER (extracted before scoring; a figure being present is not support):",
    ledgerLines.join("\n") || "- (no numeric claims found)",
    "",
    "COMPUTED GROWTH (authoritative — never replace a rate below with the word growing):",
    growthLines.join("\n") || "- (no time series)",
    "",
    "NUMBER CROSS-CHECK:",
    findingLines.join("\n") || "- (no tension yet)",
    "",
    `SHARPEST UNANSWERED QUESTION: ${question}`,
  ].join("\n");
}

export function analyzeNumbers(input: { ledger: NumericRow[]; narrative: string }): NumberWork {
  const rows = input.ledger.map(normalizeRow).filter((row): row is Normalized => !!row);
  const growth = computeGrowth(rows);
  const findings = buildFindings(rows, growth, input.narrative);
  const sharpest = findings.find((finding) => finding.severity === "flag")?.question || fallbackQuestion(rows);
  return {
    growth,
    findings,
    sharpestQuestion: sharpest,
    promptBlock: renderNumberBlock(input.ledger, growth, findings, sharpest),
  };
}

export function applyNarrativeCrossCheck(
  work: NumberWork,
  ledger: NumericRow[],
  extras: NumberFinding[],
  llmQuestion: string,
): NumberWork {
  const seen = new Set(work.findings.map((finding) => finding.text));
  const findings = [...work.findings];
  for (const extra of extras) {
    const text = extra.text.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    findings.push({ ...extra, text });
  }
  const codeFlag = work.findings.find((finding) => finding.severity === "flag");
  const llmOk = llmQuestion.trim() && !isGenericQuestion(llmQuestion) && /\d|slide|s\d|\$|%|\bvs\b/i.test(llmQuestion);
  const sharpestQuestion = codeFlag?.question || (llmOk ? llmQuestion.trim() : work.sharpestQuestion);
  return {
    ...work,
    findings,
    sharpestQuestion,
    promptBlock: renderNumberBlock(ledger, work.growth, findings, sharpestQuestion),
  };
}

export function topImprovements(findings: NumberFinding[], max = 4): NumberFinding[] {
  const flags = findings.filter((finding) => finding.severity === "flag");
  const notes = findings.filter((finding) => finding.severity === "note");
  return [...flags, ...notes].slice(0, max);
}

export function tightenEvidence<T extends ClaimRow>(rows: T[]): T[] {
  return rows.map((row) => {
    if (row.status !== "supported") return row;
    const web = /^\s*web\b/i.test(row.source || "");
    const compares = /consist|reconcil|agrees|matches|cross|versus|vs\.|gap|rate|another|other (number|slide|metric)|conflicts|contradict/i.test(row.note || "");
    if (web || compares) return row;
    const extra = "Stated in the materials; not shown to agree with the other numbers.";
    return {
      ...row,
      status: "weak" as const,
      note: row.note ? `${row.note} ${extra}` : extra,
    };
  });
}

export function extractNumbersFromText(text: string, fallbackSlide = "text"): NumericRow[] {
  const rows: NumericRow[] = [];
  const valueRe = /(?:(?:usd|eur|gbp|\$|€|£)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|mm|bn|billion|million|m|b))?|\b\d+(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\s?x\b)/gi;
  let match: RegExpExecArray | null;
  while ((match = valueRe.exec(text)) && rows.length < 60) {
    const at = match.index;
    const before = text.slice(Math.max(0, at - 180), at);
    const slideMatch = before.match(/(?:slide\s*\d+|s\d+)\b/gi);
    const slide = slideMatch ? slideMatch[slideMatch.length - 1].replace(/\s+/g, "") : fallbackSlide;
    const periodMatch = before.match(/\b(?:month\s*\d{1,2}|m\d{1,2}|q[1-4](?:\s*'?\d{2,4})?|20\d{2})\b/i);
    const words = before.replace(/[^a-z0-9 ]+/gi, " ").trim().split(/\s+/).slice(-6).join(" ");
    rows.push({
      metric: words || "figure",
      value: match[0].trim(),
      slide,
      period: periodMatch ? periodMatch[0] : "",
    });
  }
  return rows;
}

export function coerceLedger(raw: unknown): NumericRow[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((row) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return {
        metric: String(item.metric || "").trim(),
        value: String(item.value || "").trim(),
        slide: String(item.slide || item.source || "").trim() || "unspecified",
        period: String(item.period || "").trim(),
      };
    })
    .filter((row) => row.metric && row.value)
    .slice(0, 80);
}
