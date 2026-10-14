import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Paperclip, Loader2, AlertTriangle, X, ChevronDown, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { go } from "@/lib/nav";
import { STAGES, THEMES } from "@/lib/pitch-fields";
import SuperLeagueInvite from "@/components/SuperLeagueInvite";

const DISCLAIMER =
  "This AI review is for founders' educational purposes only. It does not represent any investment advice and there is no investment proposal. No offer to invest is being made and there is no solicitation made. Also there is no commitment to capital made.";

const LIVE_DISCLAIMER =
  "Educational pitch review only. Not an investment decision or a commitment.";

const LABEL =
  "font-pitch-display text-xs font-semibold uppercase tracking-[0.14em] text-foreground/70";

type ProgressStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
};

type EvidenceRow = {
  claim: string;
  status: "supported" | "weak" | "unsupported" | "unknown";
  source: string;
  note: string;
};

type Artifacts = {
  deck_note?: string;
  claims?: Array<{ claim: string; type: string }>;
  evidence?: EvidenceRow[];
  debate?: { against?: string; for?: string };
  questions?: string[];
  scores?: { values: Record<string, number>; reasons: Record<string, string> };
  jev?: {
    from?: string;
    to?: string;
    axes?: Array<{ key: string; label: string; score: number }>;
  };
  persuasion?: {
    pathos: number;
    ethos: number;
    logos: number;
    pathos_why?: string;
    ethos_why?: string;
    logos_why?: string;
    persona: string;
    blurb: string;
  };
  numbers?: Array<{ metric: string; value: string; slide: string }>;
  cross_checks?: string[];
};

type Phase = "intake" | "reviewing" | "questions" | "result" | "error";

const INITIAL_STEPS: ProgressStep[] = [
  { id: "ingest", label: "Ingest materials", status: "running" },
  { id: "brief", label: "Analyst brief", status: "pending" },
  { id: "numbers", label: "Number crunch", status: "pending" },
  { id: "evidence", label: "Evidence check", status: "pending" },
  { id: "fit", label: "Thesis fit", status: "pending" },
  { id: "skeptic", label: "Case against", status: "pending" },
  { id: "champion", label: "Case for", status: "pending" },
  { id: "verdict", label: "Final signal", status: "pending" },
];

function normalizeProgress(p: unknown): { steps: ProgressStep[]; artifacts: Artifacts } {
  if (Array.isArray(p)) return { steps: p as ProgressStep[], artifacts: {} };
  if (p && typeof p === "object") {
    const o = p as { steps?: ProgressStep[]; artifacts?: Artifacts };
    return { steps: Array.isArray(o.steps) ? o.steps : [], artifacts: o.artifacts || {} };
  }
  return { steps: [], artifacts: {} };
}

async function invokeErrorMessage(err: unknown): Promise<string> {
  if (err && typeof err === "object" && "context" in err) {
    const ctx = (err as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.clone().json();
        if (body?.error) return String(body.error);
        if (typeof body?.message === "string") return body.message;
      } catch {
        /* ignore */
      }
    }
  }
  return err instanceof Error ? err.message : "Review failed";
}

function StatusMark({ active, done }: { active?: boolean; done?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        active && "bg-primary animate-pulse",
        done && !active && "bg-secondary",
        !active && !done && "bg-muted-foreground/40",
      )}
    />
  );
}

/** The reviewer's animated "core" — spins while working, settles when done. */
function ReviewerCore({ live, size = 44 }: { live: boolean; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <div
        className={cn("absolute inset-0 rounded-full", live ? "animate-agent-orbit-fast" : "animate-agent-orbit opacity-60")}
        style={{
          background:
            "conic-gradient(from 0deg, hsl(var(--primary)), hsl(var(--secondary)) 40%, transparent 62%, hsl(var(--primary)))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
        }}
      />
      <div
        className={cn("absolute rounded-full bg-gradient-primary", live ? "animate-agent-breathe" : "opacity-70")}
        style={{ inset: size / 4, filter: "blur(1px)" }}
      />
    </div>
  );
}

function ElapsedTimer({ running, className }: { running: boolean; className?: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return (
    <span className={cn("font-pitch-display tabular-nums tracking-[0.18em] text-white/80", className)}>
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

/** The stage strip — one node per real pass, grows a "You" node when asked. */
const STEP_SHORT: Record<string, string> = {
  ingest: "Ingest",
  brief: "Brief",
  numbers: "Crunch",
  evidence: "Evidence",
  clarify: "You",
  fit: "Fit",
  skeptic: "Against",
  champion: "For",
  verdict: "Signal",
};

function PipelineStrip({ progress }: { progress: ProgressStep[] }) {
  const steps = progress.length ? progress : INITIAL_STEPS;
  return (
    <div className="mt-8 flex flex-wrap gap-1.5">
      {steps.map((s) => {
        const status = s.status;
        return (
          <div
            key={s.id}
            className={cn(
              "min-w-[64px] flex-1 border px-1.5 py-2.5 text-center transition-all duration-300",
              status === "running" && "border-primary bg-primary/20 animate-pipeline-pulse shadow-[0_0_16px_hsl(256_92%_72%/0.25)]",
              status === "done" && "border-secondary/60 bg-secondary/15",
              status === "pending" && "border-border/50 opacity-40",
              s.id === "clarify" && status === "running" && "border-secondary bg-secondary/20",
            )}
          >
            <div className="mb-1.5 flex justify-center">
              <StatusMark active={status === "running"} done={status === "done"} />
            </div>
            <p className="font-pitch-display text-xs font-bold uppercase tracking-[0.14em] text-foreground/80">
              {STEP_SHORT[s.id] || s.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ── Typewriter primitives ─────────────────────────────────────────────────── */

function TypeText({
  text,
  onDone,
  speed = 26,
}: {
  text: string;
  onDone?: () => void;
  speed?: number;
}) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const [n, setN] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const firedRef = useRef(false);

  useEffect(() => {
    setN(0);
    firedRef.current = false;
    const t = window.setInterval(() => {
      setN((k) => (k >= words.length ? k : k + 1));
    }, speed);
    return () => window.clearInterval(t);
  }, [words, speed]);

  useEffect(() => {
    if (n >= words.length && !firedRef.current) {
      firedRef.current = true;
      const t = window.setTimeout(() => onDoneRef.current?.(), 260);
      return () => window.clearTimeout(t);
    }
  }, [n, words.length]);

  return (
    <>
      {words.slice(0, n).join(" ")}
      {n < words.length && (
        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-secondary align-middle" aria-hidden />
      )}
    </>
  );
}

function RevealCount({
  total,
  interval = 380,
  onDone,
  children,
}: {
  total: number;
  interval?: number;
  onDone?: () => void;
  children: (visible: number) => React.ReactNode;
}) {
  const [n, setN] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const firedRef = useRef(false);

  useEffect(() => {
    setN(0);
    firedRef.current = false;
    const t = window.setInterval(() => {
      setN((k) => (k >= total ? k : k + 1));
    }, interval);
    return () => window.clearInterval(t);
  }, [total, interval]);

  useEffect(() => {
    if (n >= total && !firedRef.current) {
      firedRef.current = true;
      const t = window.setTimeout(() => onDoneRef.current?.(), 220);
      return () => window.clearTimeout(t);
    }
  }, [n, total]);

  return <>{children(n)}</>;
}

/* ── Live review room ──────────────────────────────────────────────────────── */

const EVIDENCE_BADGE: Record<EvidenceRow["status"], { label: string; cls: string }> = {
  supported: {
    label: "Consistent",
    cls: "border-secondary bg-secondary/15 text-secondary shadow-[0_0_12px_hsl(162_84%_56%/0.25)]",
  },
  weak: {
    label: "Thin",
    cls: "border-[hsl(42_96%_58%/0.8)] bg-[hsl(42_96%_58%/0.12)] text-[hsl(42_96%_58%)] shadow-[0_0_12px_hsl(42_96%_58%/0.2)]",
  },
  unsupported: {
    label: "Didn't hold",
    cls: "border-destructive bg-destructive/15 text-destructive shadow-[0_0_12px_hsl(0_84%_60%/0.2)]",
  },
  unknown: { label: "Unverified", cls: "border-muted-foreground/40 bg-muted/40 text-muted-foreground" },
};

function figureWasSpoken(claim: string, spoken: string): boolean {
  if (!spoken.trim()) return false;
  const compact = spoken.toLowerCase().replace(/[\s,]/g, "");
  const tokens = claim.match(/(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?%|\d[\d.,]*\s?x\b|\d[\d.,]*\s?(?:k|m|bn|b)\b)/gi) || [];
  return tokens.some((token) => compact.includes(token.toLowerCase().replace(/[\s,]/g, "")));
}

function labelFromNumberSlides(
  claim: string,
  numbers?: Array<{ value: string; slide: string }>,
): string | null {
  if (!numbers?.length) return null;
  const tokens = (claim.match(/(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?%|\d[\d.,]*\s?x\b|\d[\d.,]*\s?(?:k|m|bn|b)\b)/gi) || [])
    .map((token) => token.toLowerCase().replace(/[\s,]/g, ""))
    .filter((token) => token.length >= 2);
  if (!tokens.length) return null;
  const hits = numbers.filter((row) => {
    const value = row.value.toLowerCase().replace(/[\s,]/g, "");
    return tokens.some((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`).test(value);
    });
  });
  if (!hits.length) return null;
  const spoken = hits.some((row) => /live pitch/i.test(row.slide));
  const deck = hits.some((row) => /\b(s\d+|deck|chart)\b/i.test(row.slide));
  if (deck && spoken) return "Deck + pitch";
  if (deck) return "Deck";
  return null;
}

/** Where a claim was checked. A deck slide wins over a spoken label. */
function materialSourceLabel(
  source?: string,
  claim = "",
  opts?: { deckAttached?: boolean; spoken?: string },
): string {
  const s = String(source || "").toLowerCase();
  if (!s) return "Materials";
  const deck = !!opts?.deckAttached;
  const said = figureWasSpoken(claim, opts?.spoken || "");
  if (/live pitch/.test(s) && /\b(deck|slide|s\d+|chart)\b/.test(s)) return "Deck + pitch";
  if (/live pitch/.test(s)) {
    if (deck && said) return "Deck + pitch";
    if (deck) return "Deck";
    return "Live pitch";
  }
  if (/chart/.test(s)) return "Chart";
  if (/\b(deck|slide|ppt|pdf|s\d+)\b/.test(s)) return "Deck";
  if (/website|site\b/.test(s)) return "Website";
  if (/video|transcript|loom|youtube|vimeo/.test(s)) return "Video";
  if (/^web:|web search/.test(s)) return "Web";
  if (/brief|narrative/.test(s)) return "Brief";
  if (/doc|docx/.test(s)) return "Doc";
  return "Materials";
}

function findEvidenceForClaim(claim: string, evidence: EvidenceRow[]): EvidenceRow | undefined {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  const target = norm(claim);
  return (
    evidence.find((e) => norm(e.claim) === target) ||
    evidence.find((e) => norm(e.claim).includes(target) || target.includes(norm(e.claim)))
  );
}

function ClaimChips({
  artifacts,
  deckAttached,
  spoken,
}: {
  artifacts: Artifacts;
  deckAttached?: boolean;
  spoken?: string;
}) {
  const claims = artifacts.claims || [];
  if (!claims.length) return null;
  const evidence = artifacts.evidence || [];
  const hasEvidence = evidence.length > 0;
  return (
    <div className="mt-2 space-y-1.5 pl-7">
      {hasEvidence && (
        <p className="font-pitch-serif text-sm italic text-muted-foreground/75">
          Checked against the other numbers, not just whether a figure is written down
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {claims.map((c, i) => {
          const ev = findEvidenceForClaim(c.claim, evidence);
          const badge = ev ? EVIDENCE_BADGE[ev.status] : null;
          const recordedDeck = deckAttached || /deck attached|pitch deck/i.test(artifacts.deck_note || "");
          const src = ev
            ? labelFromNumberSlides(c.claim, artifacts.numbers) || materialSourceLabel(ev.source, c.claim, { deckAttached: recordedDeck, spoken })
            : null;
          return (
            <span
              key={i}
              style={{ animationDelay: `${i * 90}ms` }}
              title={ev ? `${ev.note || ""}${ev.source ? ` · ${ev.source}` : ""}`.trim() : "Awaiting the number check"}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 font-pitch-display text-sm tracking-wide transition-all duration-500 animate-thought-in",
                badge ? badge.cls : "text-white/40",
              )}
            >
              <span className="truncate">{c.claim}</span>
              {src && (
                <span className="shrink-0 border border-current/30 px-1 py-px text-sm font-bold uppercase tracking-[0.12em] opacity-80">
                  {src}
                </span>
              )}
              {badge && <span className="shrink-0 font-bold uppercase text-xs tracking-[0.14em]">{badge.label}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ThoughtStream({
  progress,
  artifacts,
  outputReady = false,
  onReadyToReveal,
  deckAttached = false,
  spoken = "",
}: {
  progress: ProgressStep[];
  artifacts: Artifacts;
  outputReady?: boolean;
  onReadyToReveal?: () => void;
  deckAttached?: boolean;
  spoken?: string;
}) {
  const revealedRef = useRef(false);
  const steps = progress.length ? progress : INITIAL_STEPS;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const allDone = doneCount === steps.length;

  useEffect(() => {
    if (!outputReady || revealedRef.current) return;
    revealedRef.current = true;
    const t = window.setTimeout(() => onReadyToReveal?.(), 900);
    return () => window.clearTimeout(t);
  }, [outputReady, onReadyToReveal]);

  const pct = outputReady || allDone ? 100 : Math.round((doneCount / steps.length) * 88 + 6);
  const live = !outputReady && !allDone;

  const current = steps.find((s) => s.status === "running");

  return (
    <div className="relative mt-12">
      <div className="flex items-end justify-between gap-6">
        <div className="flex items-center gap-3">
          <ReviewerCore live={live} size={28} />
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-primary">
              {outputReady ? "Signal locked" : "Review room — live"}
            </p>
            <p className="mt-1 max-w-md text-sm text-white/45">
              {outputReady
                ? "Revealing the note"
                : current?.detail || "Each line below is a live pass over your materials"}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.22em] text-white/35">
            {outputReady ? "Signal" : "In session"}
          </p>
          <ElapsedTimer running={live} className="mt-1 block text-3xl text-white" />
        </div>
      </div>

      <div className="mt-8 flex items-center gap-4">
        <div className="h-px flex-1 overflow-hidden bg-white/10">
          <div
            className="h-px bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <span className="font-pitch-display text-xs tabular-nums tracking-[0.2em] text-white/40">
          {Math.min(100, pct)}%
        </span>
      </div>

      <ul className="mt-2">
        {steps.map((s) => {
          const isCurrent = s.status === "running";
          const isDone = s.status === "done";
          const showClaims = s.id === "evidence" && (isCurrent || isDone) && (artifacts.claims?.length || 0) > 0;
          const showCrunch = s.id === "numbers" && (isCurrent || isDone) && ((artifacts.numbers?.length || 0) > 0 || (artifacts.cross_checks?.length || 0) > 0);
          const teaser =
            s.id === "skeptic" && isDone
              ? artifacts.debate?.against
              : s.id === "champion" && isDone
                ? artifacts.debate?.for
                : null;
          return (
            <li
              key={s.id}
              className={cn(
                "border-b border-white/10 py-4 transition-colors duration-300",
                isCurrent && "animate-thought-in",
              )}
            >
              <div className="flex items-baseline gap-4">
                <span
                  className={cn(
                    "w-4 shrink-0 text-center text-xs",
                    isCurrent && "text-primary",
                    isDone && "text-white/50",
                    !isCurrent && !isDone && "text-white/20",
                  )}
                  aria-hidden
                >
                  {isDone ? "✓" : isCurrent ? "›" : "·"}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[15px]",
                      isCurrent && "text-white",
                      isDone && "text-white/70",
                      !isCurrent && !isDone && "text-white/30",
                    )}
                  >
                    {s.label}
                  </span>
                  {s.detail && (
                    <span
                      className={cn(
                        "mt-1 block text-sm leading-relaxed",
                        isCurrent ? "text-white/70" : "text-white/35",
                      )}
                    >
                      {s.detail}
                      {isCurrent && (
                        <span className="ml-1 inline-block h-3.5 w-px animate-pulse bg-primary align-middle" aria-hidden />
                      )}
                    </span>
                  )}
                </span>
              </div>
              {showCrunch && (
                <div className="mt-3 space-y-4 pl-8">
                  <NumberTable numbers={(artifacts.numbers || []).slice(0, 8)} />
                  {(artifacts.cross_checks || []).length > 0 && (
                    <MathChecks checks={(artifacts.cross_checks || []).slice(0, 4)} />
                  )}
                </div>
              )}
              {showClaims && <ClaimChips artifacts={artifacts} deckAttached={deckAttached} spoken={spoken} />}
              {teaser && (
                <p className="mt-2 animate-fade-in pl-8 text-sm leading-relaxed text-white/55">
                  {s.id === "skeptic" ? teaser : `“${teaser}”`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Founder input (mid-review clarifying questions) ───────────────────────── */

function QuestionCard({
  questions,
  onSubmit,
  sending,
}: {
  questions: string[];
  onSubmit: (answers: string[], skip: boolean) => void;
  sending: boolean;
}) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const hasAnswer = answers.some((a) => a.trim());

  return (
    <div className="mt-12 animate-slide-up border-t border-white/10 pt-8">
      <p className="text-xs uppercase tracking-[0.22em] text-primary">Before the read is finished</p>
      <p className="mt-2 font-pitch-serif text-base italic text-muted-foreground">
        The evidence has gaps only you can close. Facts move the read — pitch language doesn't.
      </p>

      <div className="mt-5 space-y-5">
        {questions.map((q, i) => (
          <div key={i}>
            <p className="font-pitch-serif text-base leading-snug text-foreground md:text-lg">{q}</p>
            <textarea
              value={answers[i]}
              onChange={(e) =>
                setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
              }
              rows={2}
              maxLength={700}
              placeholder="A number, a date, a name…"
              className="mt-2 min-h-[3rem] w-full resize-y border-0 border-b border-white/15 bg-transparent px-0 py-2 font-pitch-serif text-base text-foreground placeholder:text-muted-foreground/40 focus:border-secondary focus:outline-none focus:ring-0"
            />
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          onClick={() => onSubmit(answers, false)}
          disabled={sending || !hasAnswer}
          className="rounded-full bg-gradient-primary text-white"
        >
          {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Answer & continue
        </Button>
        <Button
          onClick={() => onSubmit([], true)}
          disabled={sending}
          variant="outline"
          className="rounded-full border-primary/30 bg-transparent"
        >
          Continue without answering
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Answers are treated as claims, not proof — educational review only.
      </p>
    </div>
  );
}

/* ── Result: note, evidence, scores, conviction ────────────────────────────── */

type MemoBlock = { kind: "para" | "bullets" | "question"; lines: string[] };

function parseMemo(feedback: string): MemoBlock[] {
  const lines = feedback.split("\n").map((l) => l.trim()).filter(Boolean);
  const blocks: MemoBlock[] = [];
  for (const line of lines) {
    if (/^one question\b/i.test(line)) {
      blocks.push({ kind: "question", lines: [line.replace(/^one question:?\s*/i, "")] });
    } else if (/^[•\-–]\s+/.test(line)) {
      const clean = line.replace(/^[•\-–]\s+/, "");
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === "bullets") prev.lines.push(clean);
      else blocks.push({ kind: "bullets", lines: [clean] });
    } else {
      blocks.push({ kind: "para", lines: [line] });
    }
  }
  const question = blocks.find((block) => block.kind === "question");
  const rest = blocks.filter((block) => block.kind !== "question");
  if (!question) return rest;
  const paras = rest.filter((block) => block.kind === "para");
  const push = paras[1] || paras[0];
  const sentence = question.lines.join(" ").trim();
  if (!push) return [{ kind: "para", lines: [sentence] }, ...rest];
  const existing = push.lines.join(" ");
  if (!existing.toLowerCase().includes(sentence.slice(0, 48).toLowerCase())) {
    push.lines = [`${existing} ${sentence}`.trim()];
  }
  return rest;
}

function memoBlockLabel(block: MemoBlock, paraIndex: number): string {
  if (block.kind === "question") return "THE QUESTION";
  if (block.kind === "bullets") return "TO IMPROVE";
  if (paraIndex === 0) return "THE READ";
  if (paraIndex === 1) return "THE PUSH";
  return "NOTE";
}

const SCORE_LABELS: Record<string, string> = {
  problem: "Problem clarity",
  solution: "Solution leverage",
  market: "Market realism",
  team: "Team signal",
  opportunities_threats: "Opportunities & threats",
  financials: "Financial discipline",
};

function JevRead({ jev }: { jev: NonNullable<Artifacts["jev"]> }) {
  if (!jev.from || !jev.to) return null;
  const moved = jev.from !== jev.to;
  return (
    <p className="mt-4 text-sm text-white/55">
      {moved ? `Signal moved from ${jev.from} to ${jev.to}` : `Signal held at ${jev.to}`}
    </p>
  );
}

function ScoreBars({ scores }: { scores: NonNullable<Artifacts["scores"]> }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 120);
    return () => window.clearTimeout(t);
  }, []);
  const entries = Object.entries(scores.values).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return null;
  return (
    <div className="animate-fade-in space-y-4">
        {entries.map(([key, value], i) => (
          <div key={key}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-white">{SCORE_LABELS[key] || key.replace(/_/g, " ")}</p>
              <p className="text-sm tabular-nums text-primary">{Math.round(value)}</p>
            </div>
            <div className="mt-2 h-px w-full bg-white/10">
              <div
                className="h-px bg-primary transition-[width] duration-1000 ease-out"
                style={{
                  width: armed ? `${Math.min(100, Math.max(0, value))}%` : "0%",
                  transitionDelay: `${i * 120}ms`,
                }}
              />
            </div>
            {scores.reasons[key] && (
              <p className="mt-1.5 text-sm leading-snug text-white/55">{scores.reasons[key]}</p>
            )}
          </div>
        ))}
    </div>
  );
}

/* ── Intake: optional feedback depth (note only — does not change evaluation) ─ */

const CRITIQUE_LABELS: Record<number, { title: string; line: string }> = {
  1: { title: "Light touch", line: "Shorter note — one clear gap" },
  2: { title: "Light touch", line: "Brief and honest" },
  3: { title: "Light touch", line: "Kind clarity without a deep unpack" },
  4: { title: "Standard depth", line: "Balanced strengths and gaps" },
  5: { title: "Standard depth", line: "Firm, fair detail — the default" },
  6: { title: "Standard depth", line: "A bit more specificity on the ask" },
  7: { title: "Deep dive", line: "Why the gap matters + what proof closes it" },
  8: { title: "Deep dive", line: "Cite slides/charts; unpack the push" },
  9: { title: "Maximum detail", line: "Full proof ladder in the note" },
  10: { title: "Maximum detail", line: "Same evaluation — deepest explanation" },
};

function CritiqueDial({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const meta = CRITIQUE_LABELS[value] || CRITIQUE_LABELS[5];
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="sm:w-36 shrink-0">
        <p className="text-sm font-medium text-white">Note depth</p>
        <p className="text-xs text-white/45">{meta.title}</p>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full flex-1 accent-[hsl(192_92%_64%)]"
        aria-label="Feedback depth"
      />
      <span className="text-sm tabular-nums text-primary sm:w-10 sm:text-right">{value}/10</span>
    </div>
  );
}

/* ── Result: Persuasion Meter (Pathos / Ethos / Logos) ─────────────────────── */

function PersuasionMeter({
  persuasion,
}: {
  persuasion: NonNullable<Artifacts["persuasion"]>;
}) {
  const pathos = Math.min(10, Math.max(1, persuasion.pathos));
  const ethos = Math.min(10, Math.max(1, persuasion.ethos));
  const logos = Math.min(10, Math.max(1, persuasion.logos));
  const total = pathos + ethos + logos || 1;
  const pPct = (pathos / total) * 100;
  const ePct = (ethos / total) * 100;
  const lPct = (logos / total) * 100;
  const share = { pathos: pPct, ethos: ePct, logos: lPct };

  const rows = [
    {
      key: "pathos" as const,
      label: "Pathos",
      value: pathos,
      why: persuasion.pathos_why,
      color: "hsl(330 85% 68%)",
    },
    {
      key: "ethos" as const,
      label: "Ethos",
      value: ethos,
      why: persuasion.ethos_why,
      color: "hsl(162 84% 56%)",
    },
    {
      key: "logos" as const,
      label: "Logos",
      value: logos,
      why: persuasion.logos_why,
      color: "hsl(210 90% 65%)",
    },
  ];

  return (
    <div className="animate-fade-in">
      <p className="text-2xl font-medium tracking-tight text-white">{persuasion.persona}</p>
      <p className="mt-1 text-sm text-white/55">{persuasion.blurb}</p>
      <div className="mt-5">
        {rows.map((row) => (
          <div key={row.key} className="border-b border-white/10 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-white">{row.label}</p>
              <p className="text-sm tabular-nums" style={{ color: row.color }}>
                {row.value}/10 · {Math.round(share[row.key])}%
              </p>
            </div>
            {row.why && <p className="mt-1 text-sm leading-snug text-white/55">{row.why}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

const FEEDBACK_BADGE: Record<EvidenceRow["status"], string> = {
  supported: "text-primary",
  weak: "text-[hsl(42_90%_72%)]",
  unsupported: "text-destructive",
  unknown: "text-white/45",
};

const RESULT_HEAD = "grid w-full grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-x-3 text-left md:gap-x-6";
const RESULT_ROW = "border-b border-white/10 py-4 md:grid md:grid-cols-[8.5rem_minmax(0,1fr)] md:items-baseline md:gap-x-6";
const RESULT_BODY = "grid grid-cols-1 pb-5 md:grid-cols-[8.5rem_minmax(0,1fr)] md:gap-x-6";

function ResultFold({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-white/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(RESULT_HEAD, "py-4")}
      >
        <span className="text-xs uppercase tracking-[0.16em] text-white/40">{title}</span>
        <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
          <span className="truncate text-sm text-white/55">{summary}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/35 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className={RESULT_BODY}>
          <div className="hidden md:block" aria-hidden />
          <div className="min-w-0 animate-fade-in">{children}</div>
        </div>
      )}
    </section>
  );
}

function NumberTable({ numbers }: { numbers: NonNullable<Artifacts["numbers"]> }) {
  if (!numbers.length) return null;
  return (
    <div>
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] gap-x-4 pb-1">
        <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Slide</p>
        <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Metric</p>
        <p className="text-right text-[10px] uppercase tracking-[0.16em] text-white/30">Value</p>
      </div>
      {numbers.map((row, i) => (
        <div
          key={`${row.slide}-${row.metric}-${i}`}
          className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 border-t border-white/10 py-2"
        >
          <p className="truncate text-xs text-white/40">{row.slide}</p>
          <p className="min-w-0 text-sm text-white/80">{row.metric}</p>
          <p className="text-right text-sm tabular-nums text-white">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

function MathChecks({ checks }: { checks: string[] }) {
  return (
    <ul>
      {checks.map((line, i) => (
        <li key={i} className="border-t border-white/10 py-3 text-sm leading-relaxed text-white/75 first:border-t-0 first:pt-0">
          {line}
        </li>
      ))}
    </ul>
  );
}

function evidenceSummary(evidence: EvidenceRow[]): string {
  const counts = { supported: 0, weak: 0, unsupported: 0, unknown: 0 };
  for (const row of evidence) counts[row.status] += 1;
  const parts = [
    counts.supported ? `${counts.supported} consistent` : "",
    counts.unsupported ? `${counts.unsupported} didn't hold` : "",
    counts.weak ? `${counts.weak} thin` : "",
    counts.unknown ? `${counts.unknown} unverified` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "No claims checked";
}

function EvidencePanel({
  evidence,
  numbers,
  deckNote,
  deckAttached,
  spoken,
}: {
  evidence: EvidenceRow[];
  numbers?: Array<{ value: string; slide: string }>;
  deckNote?: string;
  deckAttached?: boolean;
  spoken?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!evidence.length) return null;
  return (
    <div className="animate-fade-in">
      {evidence.map((e, i) => {
        const tone = FEEDBACK_BADGE[e.status] || FEEDBACK_BADGE.unknown;
        const label = (EVIDENCE_BADGE[e.status] || EVIDENCE_BADGE.unknown).label;
        const expanded = open === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(expanded ? null : i)}
            className="block w-full border-t border-white/10 py-3 text-left first:border-t-0 first:pt-0"
          >
            <div className="flex items-baseline gap-3">
              <span className={cn("w-[6.75rem] shrink-0 text-xs", tone)}>{label}</span>
              <span className="min-w-0 flex-1 text-sm text-white">{e.claim}</span>
              <span className="hidden shrink-0 text-xs text-white/40 sm:inline">{labelFromNumberSlides(e.claim, numbers) || materialSourceLabel(e.source, e.claim, { deckAttached: deckAttached || /deck attached|pitch deck/i.test(deckNote || ""), spoken })}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-white/40 transition-transform", expanded && "rotate-180")} />
            </div>
            {expanded && (
              <p className="mt-2 text-sm leading-relaxed text-white/60 sm:pl-[7.5rem]">
                {e.note || "No further detail."}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

const VERDICT_STYLE: Record<string, { hue: string; lines: [string, string, string] }> = {
  HOT: {
    hue: "18 95% 62%",
    lines: [
      "You didn't just explain it. You made it feel real.",
      "What's left is a few improvements. Review the educational feedback with your own rigour, if it makes sense.",
      "Keep practicing your pitch and keep improving. You're getting close to a pitch investors will feel.",
    ],
  },
  WARM: {
    hue: "42 96% 58%",
    lines: [
      "The idea comes through. That's the hard part.",
      "The pitch still wobbles, and the notes only name some of the many improvements needed.",
      "Keep practising your pitch with other founders. You'll hear what to fix.",
    ],
  },
  PASS: {
    hue: "222 18% 62%",
    lines: [
      "There's a real idea under this. The pitch isn't holding it yet.",
      "The notes show a lot you could reshape.",
      "Talk it through with other founders, then come back when the story feels tighter.",
    ],
  },
};

function ConvictionBlock({
  verdict,
  confidence,
}: {
  verdict: string;
  confidence: number | null;
}) {
  const pct = confidence != null ? Math.round(Math.min(1, Math.max(0, confidence)) * 100) : null;
  const style = VERDICT_STYLE[verdict] || VERDICT_STYLE.WARM;
  return (
    <div className="animate-fade-in">
      <p className="text-xs uppercase tracking-[0.18em] text-white/35">Signal</p>
      <div className="mt-3 flex items-end justify-between gap-6">
        <p
          className="text-5xl font-medium tracking-tight"
          style={{ color: `hsl(${style.hue})` }}
        >
          {verdict}
        </p>
        {pct != null && (
          <p className="text-right">
            <span className="block text-3xl font-medium tabular-nums text-white">{pct}%</span>
            <span className="text-xs uppercase tracking-[0.16em] text-white/40">Conviction</span>
          </p>
        )}
      </div>
      <div className="mt-4 max-w-xl space-y-1">
        {style.lines.map((line) => (
          <p key={line} className="text-sm leading-relaxed text-white/60">{line}</p>
        ))}
        <p className="pt-1 text-sm leading-relaxed text-white/45">Educational feedback only. This AI review is for founders' educational purposes only. It does not represent any investment advice. No offer to invest is being made and there is no commitment to capital made.</p>
      </div>
    </div>
  );
}

/* ── Live pitch recorder ───────────────────────────────────────────────────── */

const LIVE_MAX_SEC = 180;
const MIC_BARS = 28;

const HEARD_AXES: Array<{ label: string; groups: RegExp[]; need: number; anchor?: number }> = [
  {
    label: "Problem clarity",
    need: 2,
    anchor: 0,
    groups: [
      /\b(problem|pain|painful|pain point|struggle|struggling|broken|frustrat\w*|waste|wasting|wastes|stuck|manual|spreadsheet|tedious|headache|nightmare|too (?:slow|hard|long|manual))\b/,
      /\b(customers?|users?|buyers?|teams?|founders?|patients?|clinics?|sellers?|operators?|managers?|nurses?|doctors?|merchants?|businesses|companies|people|shops|hospitals|schools)\b/,
      /\b(hours?|every (day|week|month)|can(?:not|'t)|unable|lose|losing|lost|costly|expensive|errors?|too long|too much|their time|the time)\b/,
    ],
  },
  {
    label: "Solution leverage",
    need: 2,
    anchor: 0,
    groups: [
      /\b(we (?:built|build|make|made|launched|help|sell)|our (?:product|platform|app|software|tool|solution)|the (?:product|app|platform)|it lets|we let)\b/,
      /\b(it works|how it works|automatically|workflow|instead|replaces|cuts|saves|one click|so they can|helps them|lets them)\b/,
      /\b(faster|less time|fewer|reduces|reduction|down to|in minutes|in seconds)\b/,
    ],
  },
  {
    label: "Market realism",
    need: 2,
    anchor: 0,
    groups: [
      /\b(market|industry|category|tam|sam|som|segment|the space)\b/,
      /\b(\d[\d,.]*\s?(?:billion|million|percent|%)|billion|million|percent|growing|why now|regulation|switching|how big)\b/,
      /\b(they (?:buy|pay|switch|adopt)|willingness|who buys|our buyer|buyers are)\b/,
    ],
  },
  {
    label: "Team signal",
    need: 2,
    groups: [
      /\b(co-?founders?|founding team|i(?:'m| am) the founder|we are the founders|my background|our background|our team|my team)\b/,
      /\b(previously|before this|former|years|spent|led|founded|head of|operator|worked|experience|second[- ]time)\b/,
    ],
  },
  {
    label: "Opportunities & threats",
    need: 2,
    groups: [
      /\b(competitors?|competition|compete|incumbents?|alternative|instead of|status quo|versus|vs\.?|today they)\b/,
      /\b(regulations?|regulat\w*|threats?|risks?|mandates?|required to|compliance|if they stay|if nothing changes)\b/,
      /\b(why now|tailwind|for the first time|opening|the shift|this year)\b/,
    ],
  },
  {
    label: "Financial discipline",
    need: 2,
    groups: [
      /\b(mrr|arr|revenue|margins?|burn|runway|cac|ltv|payback|forecasts?|projections?|churn|nrr|gmv|take rate|gross|a month|per month|monthly|profit|sales)\b/,
      /(?:\$\s?\d|\b(?:million|thousand|billion|percent|dollars)\b|\b\d[\d,.]*\s?(?:%|k|m|bn)\b|\b(?:mrr|arr|margin|burn|runway|revenue)\b[^.]{0,24}\d|\d[^.]{0,16}\b(?:mrr|arr|margin|burn|runway|revenue|month)\b)/,
    ],
  },
  {
    label: "The ask",
    need: 2,
    groups: [
      /\b(raising|raise|fundraising|the ask|looking to raise|looking for|want to raise|our raise)\b/,
      /\b(seed|pre-seed|series|million|round|capital|\$\s?\d|\d+\s?(?:k|m)\b)\b/,
    ],
  },
  {
    label: "Use of funds",
    need: 2,
    groups: [
      /\b(use of funds|usage of funds|proceeds|we'll spend|we will spend|we'll use|we will use|allocat\w*|the (?:money|capital|round|raise) (?:goes|will go|is for)|spend(?:ing)? (?:it|the round|the raise) on|put (?:it|the raise|the round) (?:into|toward))\b/,
      /\b(hir\w+|engineering|sales|marketing|runway|inventory|headcount)\b/,
    ],
  },
];

function speechWindows(text: string) {
  const clean = text.toLowerCase().replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4);
  const words = clean.split(/\s+/);
  const slides: string[] = [];
  for (let i = 0; i < words.length; i += 12) {
    const slice = words.slice(i, i + 24);
    if (slice.length >= 4) slides.push(slice.join(" "));
    if (i + 24 >= words.length) break;
  }
  return sentences.length ? [...sentences, ...slides] : slides;
}

function axisLanded(text: string, groups: RegExp[], need: number, anchor?: number) {
  return speechWindows(text).some((window) => {
    const hits = groups.map((group) => group.test(window));
    const count = hits.filter(Boolean).length;
    if (count < need) return false;
    return anchor == null || hits[anchor];
  });
}

function ventureLanded(text: string, company: string) {
  const clean = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (clean.split(/\s+/).filter(Boolean).length < 4) return false;
  const name = company.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const generic = /^(the|and|for|inc|llc|app|team|seed)$/.test(name);
  if (name.length > 2 && !generic && clean.includes(name)) return true;
  return /\b((?:we(?:'re| are)|i(?:'m| am)|this is|it(?:'s| is)|the company is|our (?:startup|company|venture) is) called|called [a-z]{3,}|our (?:startup|company|venture) is [a-z]{3,}|the company is [a-z]{3,})\b/.test(clean);
}

function heardLabels(text: string, company: string) {
  if (!text.trim()) return [];
  const labels = HEARD_AXES.filter((axis) => axisLanded(text, axis.groups, axis.need, axis.anchor)).map((axis) => axis.label);
  if (ventureLanded(text, company)) labels.unshift("Venture name");
  return labels;
}

const RHETORIC_PAIN = HEARD_AXES[0].groups[0];
const RHETORIC_WHO = HEARD_AXES[0].groups[1];
const RHETORIC_STAKE = HEARD_AXES[0].groups[2];
const RHETORIC_HISTORY = HEARD_AXES[3].groups[0];
const RHETORIC_CRAFT = HEARD_AXES[3].groups[1];
const RHETORIC_TRUST = /\b(paying|signed|pilot|retention|trusted)\b/;
const RHETORIC_BUILT = HEARD_AXES[1].groups[0];
const RHETORIC_MECHANISM = HEARD_AXES[1].groups[1];
const RHETORIC_MARKET = HEARD_AXES[2].groups[0];
const RHETORIC_SHAPE = HEARD_AXES[2].groups[1];
const RHETORIC_METRIC = HEARD_AXES[5].groups[0];
const RHETORIC_FIGURE = HEARD_AXES[5].groups[1];
const RHETORIC_RAISE = HEARD_AXES[6].groups[0];
const RHETORIC_ROUND = HEARD_AXES[6].groups[1];
const RHETORIC_FUNDS = HEARD_AXES[7].groups[0];
const RHETORIC_USE = HEARD_AXES[7].groups[1];

function rhetoricWindows(text: string) {
  const clean = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter((part) => part.split(/\s+/).length >= 4);
  if (sentences.length >= 2) return sentences;
  const words = clean.split(/\s+/);
  const slides: string[] = [];
  for (let i = 0; i < words.length; i += 16) {
    const slice = words.slice(i, i + 22);
    if (slice.length >= 4) slides.push(slice.join(" "));
    if (i + 22 >= words.length) break;
  }
  return slides;
}

function rhetoricPrelim(text: string, company: string) {
  let pathos = 0;
  let ethos = 0;
  let logos = 0;
  for (const window of rhetoricWindows(text)) {
    const pain = RHETORIC_PAIN.test(window);
    const who = RHETORIC_WHO.test(window);
    const stake = RHETORIC_STAKE.test(window);
    const pathosGroups = [pain, who, stake].filter(Boolean).length;
    if (pain && pathosGroups >= 2) pathos += 1;
    else if (who && stake) pathos += 0.85;
    else if (pain) pathos += 0.22;

    const ethosGroups = [
      RHETORIC_HISTORY.test(window),
      RHETORIC_CRAFT.test(window),
      RHETORIC_TRUST.test(window),
      ventureLanded(window, company),
    ].filter(Boolean).length;
    if (ethosGroups >= 2) ethos += 1;
    else if (ethosGroups === 1) ethos += 0.25;

    const pillars = [
      RHETORIC_BUILT.test(window) && RHETORIC_MECHANISM.test(window),
      RHETORIC_MARKET.test(window) && RHETORIC_SHAPE.test(window),
      RHETORIC_METRIC.test(window) && RHETORIC_FIGURE.test(window),
      RHETORIC_RAISE.test(window) && RHETORIC_ROUND.test(window),
      RHETORIC_FUNDS.test(window) && RHETORIC_USE.test(window),
    ].filter(Boolean).length;
    if (pillars >= 1) logos += 1;
    else if (RHETORIC_BUILT.test(window) || RHETORIC_MARKET.test(window) || RHETORIC_METRIC.test(window) || RHETORIC_RAISE.test(window)) logos += 0.2;
  }
  const rise = (weight: number) => (weight <= 0 ? 0 : Math.min(0.84, 1 - Math.exp(-weight / 1.7)));
  return { pathos: rise(pathos), ethos: rise(ethos), logos: rise(logos) };
}

function useSpokenText(active: boolean) {
  const [text, setText] = useState("");
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) {
      setText("");
      return;
    }
    const Ctor = (window as unknown as {
      SpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
    }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    } }).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    let saved = "";
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) saved = `${saved} ${piece}`.trim();
        else interim += piece;
      }
      setText(`${saved} ${interim}`.trim());
    };
    rec.onend = () => {
      if (!activeRef.current) return;
      window.setTimeout(() => {
        if (!activeRef.current) return;
        try { rec.start(); } catch { /* already running */ }
      }, 250);
    };
    try { rec.start(); } catch { /* mic is already open for the take */ }
    return () => {
      activeRef.current = false;
      rec.onend = null;
      try { rec.stop(); } catch { /* already stopped */ }
    };
  }, [active]);
  return text;
}

function useGlide3(target: [number, number, number]) {
  const [value, setValue] = useState<[number, number, number]>([0, 0, 0]);
  const valueRef = useRef<[number, number, number]>([0, 0, 0]);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = 1 - Math.exp(-dt * 3.4);
      const next = valueRef.current.map((current, index) => {
        const goal = targetRef.current[index];
        return Math.abs(goal - current) < 0.004 ? goal : current + (goal - current) * k;
      }) as [number, number, number];
      valueRef.current = next;
      setValue(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return value;
}

function RhetoricMeters({ text, company }: { text: string; company: string }) {
  const target = rhetoricPrelim(text, company);
  const [pathos, ethos, logos] = useGlide3([target.pathos, target.ethos, target.logos]);
  const meters = [
    { label: "Pathos", hint: "Why it matters", value: pathos },
    { label: "Ethos", hint: "Why you", value: ethos },
    { label: "Logos", hint: "Why it holds", value: logos },
  ];
  return (
    <div className="mt-4 w-full max-w-lg">
      <p className="text-center text-[10px] uppercase tracking-[0.22em] text-white/35">Prelim · the full read comes after</p>
      <div className="mt-4 space-y-3">
        {meters.map((meter) => (
          <div key={meter.label} className="grid grid-cols-[7.5rem_1fr] items-center gap-4">
            <div>
              <p className="text-sm text-white">{meter.label}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">{meter.hint}</p>
            </div>
            <div className="relative h-1.5 rounded-full bg-white/15">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{
                  width: `${meter.value * 100}%`,
                  boxShadow: meter.value > 0.04 ? "0 0 16px hsl(192 92% 64% / 0.9)" : undefined,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeardTicks({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {labels.map((label) => (
        <span key={label} className="inline-flex items-center gap-2 text-sm text-white/80 animate-fade-in">
          <span className="text-primary">✓</span>
          {label}
        </span>
      ))}
    </div>
  );
}

function formatClock(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function useMicLevel(stream: MediaStream | null, active: boolean) {
  const [mic, setMic] = useState({ level: 0, bars: Array.from({ length: MIC_BARS }, () => 0) });
  useEffect(() => {
    if (!stream || !active) {
      setMic({ level: 0, bars: Array.from({ length: MIC_BARS }, () => 0) });
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const wave = new Uint8Array(analyser.fftSize);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(wave);
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      for (let i = 0; i < wave.length; i += 1) {
        const v = (wave[i] - 128) / 128;
        sum += v * v;
      }
      const step = Math.max(1, Math.floor(freq.length / MIC_BARS));
      const bars = Array.from({ length: MIC_BARS }, (_, i) => {
        let peak = 0;
        for (let j = 0; j < step; j += 1) peak += freq[i * step + j] || 0;
        return Math.min(1, peak / step / 150);
      });
      setMic({ level: Math.min(1, Math.sqrt(sum / wave.length) * 4), bars });
      frame = requestAnimationFrame(tick);
    };
    void ctx.resume().then(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void ctx.close();
    };
  }, [stream, active]);
  return mic;
}

function LivePitchRecorder({
  transcript,
  onTranscript,
  founderName,
  companyName,
}: {
  transcript: string;
  onTranscript: (text: string) => void;
  founderName: string;
  companyName: string;
}) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cutoffRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const stoppingRef = useRef(false);
  const secondsRef = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<"idle" | "countdown" | "recording" | "saving" | "error">("idle");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [takenSeconds, setTakenSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const { bars } = useMicLevel(stream, mode === "countdown" || mode === "recording");
  const spoken = useSpokenText(mode === "recording");
  const liveSaid = heardLabels(spoken, companyName);
  const savedSaid = heardLabels(transcript, companyName);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  };

  const stopTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (cutoffRef.current) window.clearTimeout(cutoffRef.current);
    timerRef.current = null;
    cutoffRef.current = null;
  };

  useEffect(() => () => {
    stopTimer();
    stopStream();
  }, []);

  const openCamera = async () => {
    if (streamRef.current) return streamRef.current;
    const fail = (title: string, description: string) => {
      setError(description);
      setMode("error");
      toast({ title, description, variant: "destructive" });
      return null;
    };
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      return fail(
        "Camera needs a secure page",
        "Open this app at http://localhost:8080. A network address cannot use the camera.",
      );
    }
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true },
      { video: true, audio: true },
      { video: true, audio: false },
    ];
    let lastError: unknown;
    for (const constraints of attempts) {
      try {
        const next = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = next;
        setStream(next);
        return next;
      } catch (error) {
        lastError = error;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") break;
      }
    }
    const name = lastError instanceof DOMException ? lastError.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return fail(
        "Mac is blocking the camera",
        "System Settings → Privacy & Security → Camera, and Microphone. Allow the browser you are using, reload this page, then press Record.",
      );
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return fail("No camera found", "This Mac has no camera the browser can use.");
    }
    return fail("Camera unavailable", "The browser could not open the camera. Reload and press Record again.");
  };

  const transcribe = async (next: Blob) => {
    setMode("saving");
    setError(null);
    try {
      const ext = next.type.includes("mp4") ? "mp4" : "webm";
      const path = `${crypto.randomUUID()}.${ext}`;
      const storageType = ext === "mp4" ? "video/mp4" : "video/webm";
      const file = new File([next], `live-pitch.${ext}`, { type: storageType });
      const { error: uploadError } = await supabase.storage.from("pitch-materials").upload(path, file, {
        contentType: storageType,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data, error: invokeError } = await supabase.functions.invoke("transcribe-live-pitch", {
        body: { file_path: path, file_name: file.name, file_mime: storageType },
      });
      if (invokeError) throw new Error(invokeError.message || "Transcription failed");
      if (data?.error) throw new Error(String(data.error));
      const text = String(data?.transcript || "").trim();
      if (!text) throw new Error("No speech detected");
      onTranscript(text);
      setMode("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed";
      setError(message);
      setMode("error");
      toast({ title: "Could not capture the words", description: message, variant: "destructive" });
    }
  };

  const finishRecording = () => {
    if (stoppingRef.current) return;
    if (startedRef.current === false && recorderRef.current == null) return;
    stoppingRef.current = true;
    stopTimer();
    setTakenSeconds(Math.min(LIVE_MAX_SEC, secondsRef.current));
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else setMode("saving");
  };

  const startRecording = () => {
    const live = streamRef.current;
    if (!live || startedRef.current) return;
    startedRef.current = true;
    chunksRef.current = [];
    const audioTracks = live.getAudioTracks();
    const speechStream = audioTracks.length ? new MediaStream(audioTracks) : live;
    const mime = (audioTracks.length
      ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      : ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    ).find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) || "";
    const rec = new MediaRecorder(speechStream, mime
      ? audioTracks.length
        ? { mimeType: mime, audioBitsPerSecond: 64000 }
        : { mimeType: mime, videoBitsPerSecond: 700_000, audioBitsPerSecond: 64000 }
      : undefined);
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || "video/webm";
      const next = new Blob(chunksRef.current, { type });
      setBlob(next);
      stopStream();
      if (videoRef.current) videoRef.current.srcObject = null;
      void transcribe(next);
    };
    rec.start(1000);
    const startedAt = Date.now();
    setSeconds(0);
    secondsRef.current = 0;
    setMode("recording");
    onTranscript("");
    cutoffRef.current = window.setTimeout(() => finishRecording(), LIVE_MAX_SEC * 1000);
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.min(LIVE_MAX_SEC, Math.floor((Date.now() - startedAt) / 1000));
      secondsRef.current = elapsed;
      setSeconds(elapsed);
      if (elapsed >= LIVE_MAX_SEC) finishRecording();
    }, 250);
  };

  const begin = async () => {
    startedRef.current = false;
    stoppingRef.current = false;
    setError(null);
    setCountdown(null);
    setMode("countdown");
    const next = await openCamera();
    if (!next) return;
    setCountdown(3);
    if (videoRef.current) {
      videoRef.current.srcObject = next;
      await videoRef.current.play().catch(() => undefined);
    }
  };

  const leave = () => {
    stopTimer();
    stopStream();
    startedRef.current = false;
    stoppingRef.current = false;
    setCountdown(null);
    setMode(transcript ? "idle" : "idle");
  };

  const redo = () => {
    setBlob(null);
    setSeconds(0);
    setTakenSeconds(0);
    setTranscriptOpen(false);
    onTranscript("");
    void begin();
  };

  useEffect(() => {
    if (mode !== "countdown") return;
    if (countdown === 0) {
      startRecording();
      return;
    }
    if (countdown == null) return;
    const timer = window.setTimeout(() => setCountdown((n) => (n == null ? n : n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [mode, countdown]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || (mode !== "countdown" && mode !== "recording")) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [stream, mode]);

  const ring = 492;
  const warm = seconds >= LIVE_MAX_SEC - 20;
  const onStage = mode !== "idle";

  return (
    <>
      <div className="flex h-full items-center gap-4 px-5 py-4 md:px-6 md:py-5 md:pr-14">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/35">01</p>
          <h2 className="mt-1 text-xl font-medium tracking-tight text-white">Live pitch</h2>
          <p className="mt-1 truncate text-sm text-white/45">
            {transcript ? `${formatClock(takenSeconds)} captured` : "3 minutes · the picture stays here"}
          </p>
          {transcript && transcriptOpen && (
            <div className="mt-3">
              {savedSaid.length > 0 && <HeardTicks labels={savedSaid} />}
              <p className={cn("text-sm leading-relaxed text-white/70", savedSaid.length > 0 && "mt-3")}>{transcript}</p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {transcript && (
            <button type="button" onClick={() => setTranscriptOpen((open) => !open)} className="text-sm text-white/40 hover:text-white">
              {transcriptOpen ? "Hide" : "Transcript"}
            </button>
          )}
          <button type="button" onClick={transcript ? redo : begin} className="text-sm text-primary hover:text-white">
            {transcript ? "Redo" : "Record"}
          </button>
        </div>
      </div>

      {onStage && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black text-white">
          <header className="grid shrink-0 grid-cols-3 items-center px-6 pb-2 pt-4 md:px-10">
            <div className="flex items-center gap-3">
              <span className={cn("h-1.5 w-1.5 rounded-full", mode === "recording" ? "animate-pulse bg-primary" : "bg-white/30")} />
              <span className="text-[11px] uppercase tracking-[0.22em] text-white/50">{mode === "recording" ? "Live" : "Ready"}</span>
            </div>
            <p className="truncate text-center text-sm text-white/75">{companyName.trim() || founderName.trim() || "Live pitch"}</p>
            <div className="text-right">
              {mode === "countdown" && (
                <button type="button" onClick={leave} className="text-sm text-white/45 hover:text-white">Close</button>
              )}
              {mode === "recording" && (
                <p className={cn("text-sm tabular-nums", warm ? "text-[hsl(28_90%_68%)]" : "text-white/70")}>{formatClock(seconds)} / 3:00</p>
              )}
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-8 md:px-10">
            <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
              <div className="relative mx-auto w-fit max-w-full">
                <svg className="pointer-events-none absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)]" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden>
                  <rect
                    x="1.2"
                    y="1.2"
                    width="157.6"
                    height="87.6"
                    rx="2"
                    fill="none"
                    stroke={warm && mode === "recording" ? "hsl(28 90% 62%)" : "hsl(192 70% 72%)"}
                    strokeWidth="0.7"
                    pathLength={ring}
                    strokeDasharray={ring}
                    strokeDashoffset={mode === "recording" ? ring * (seconds / LIVE_MAX_SEC) : 0}
                  />
                </svg>
                <video ref={videoRef} autoPlay muted playsInline className={cn("mx-auto aspect-video max-h-[34vh] w-auto max-w-full bg-black object-cover", mode === "saving" || mode === "error" ? "invisible" : "-scale-x-100")} />
                {mode === "countdown" && countdown != null && countdown > 0 && (
                  <div className="absolute inset-0 grid place-items-center">
                    <p className="text-7xl font-medium tabular-nums">{countdown}</p>
                  </div>
                )}
              </div>
              {mode === "countdown" && (
                <p className="mt-4 text-sm text-white/55">Look at the lens.</p>
              )}
              {mode === "recording" && <RhetoricMeters text={spoken} company={companyName} />}
              {mode === "recording" && liveSaid.length > 0 && (
                <div className="mt-5 flex justify-center"><HeardTicks labels={liveSaid} /></div>
              )}
              {(mode === "countdown" || mode === "recording") && (
                <div className="mt-5 flex h-10 w-full items-end gap-1" aria-hidden>
                  {bars.map((bar, i) => (
                    <span key={i} className="min-w-0 flex-1 bg-primary/70" style={{ height: `${Math.max(3, bar * 40)}px` }} />
                  ))}
                </div>
              )}
              {mode === "recording" && (
                <button type="button" onClick={finishRecording} className="mt-4 text-sm tracking-wide text-white/80 hover:text-white">Stop</button>
              )}
              {mode === "saving" && <p className="mt-8 text-sm text-white/45">Saving the words</p>}
              {mode === "error" && (
                <div className="mt-8 flex items-center gap-6 text-sm">
                  <p className="text-white/50">{error}</p>
                  {blob && <button type="button" onClick={() => void transcribe(blob)} className="text-white">Try again</button>}
                  <button type="button" onClick={leave} className="text-white/45">Close</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const COUNTRY_NAMES = [
  "United Arab Emirates", "United Kingdom", "United States", "South Africa", "South Korea", "New Zealand", "Saudi Arabia", "Hong Kong",
  "Singapore", "India", "Germany", "France", "Spain", "Italy", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Switzerland",
  "Austria", "Belgium", "Ireland", "Portugal", "Poland", "Canada", "Mexico", "Brazil", "Argentina", "Chile", "Colombia", "Australia",
  "Japan", "China", "Taiwan", "Indonesia", "Malaysia", "Thailand", "Vietnam", "Philippines", "Israel", "Turkey", "Nigeria", "Kenya",
  "Egypt", "Morocco", "UAE", "UK", "USA",
];

const COUNTRY_CANON: Record<string, string> = { UAE: "United Arab Emirates", UK: "United Kingdom", USA: "United States" };

const THEME_RULES: Array<[RegExp, string]> = [
  [/\b(defense|defence|aerospace|satellite|space)\b/i, "Defense & Space"],
  [/\b(agriculture|farming|agtech|food)\b/i, "Food & Agriculture"],
  [/\b(climate|renewable|solar|battery|energy)\b/i, "Climate & Energy"],
  [/\b(cleantech|carbon capture|decarbon)\b/i, "CleanTech"],
  [/\b(developer tool|devtool|devtools)\b/i, "Developer Tools"],
  [/\b(cybersecurity|cyber security|infosec)\b/i, "Cybersecurity"],
  [/\b(fintech|payments|banking|lending|insurtech)\b/i, "Fintech"],
  [/\b(mobility|autonomous|logistics|ev\b|vehicle)\b/i, "Mobility"],
  [/\b(legaltech|legal)\b/i, "Legal"],
  [/\b(biotech|therapeutic|genomic)\b/i, "Biotech"],
  [/\b(healthtech|healthcare|health|clinic|medical)\b/i, "Health"],
  [/\b(proptech|real estate)\b/i, "Proptech"],
  [/\b(edtech|education|learning)\b/i, "Edtech"],
  [/\b(marketplace)\b/i, "Marketplaces"],
  [/\b(commerce|ecommerce|retail)\b/i, "Commerce"],
  [/\b(consumer app|consumer)\b/i, "Consumer"],
  [/\b(industrial|robotics|hardware|deep tech)\b/i, "Industrial & Deep Tech"],
  [/\b(enterprise|saas|b2b)\b/i, "Enterprise Software"],
  [/\b(foundation model|frontier model)\b/i, "AI Frontier"],
  [/\b(artificial intelligence|\bai\b|machine learning)\b/i, "Applied AI"],
];

type PitchClues = {
  company?: string;
  founder?: string;
  email?: string;
  country?: string;
  theme?: string;
  stage?: string;
  website?: string;
};

const CLUE_LABEL: Record<keyof PitchClues, string> = {
  company: "company",
  founder: "your name",
  email: "email",
  country: "country",
  theme: "theme",
  stage: "stage",
  website: "website",
};

function joinWords(items: string[]) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function describeClues(clues: Partial<Record<keyof PitchClues, "pitch" | "deck">>) {
  const line = (source: "pitch" | "deck") =>
    (Object.entries(clues) as Array<[keyof PitchClues, "pitch" | "deck" | undefined]>)
      .filter(([, from]) => from === source)
      .map(([key]) => CLUE_LABEL[key]);
  const parts = [
    line("deck").length ? `${joinWords(line("deck"))} from the deck` : "",
    line("pitch").length ? `${joinWords(line("pitch"))} from the pitch` : "",
  ].filter(Boolean);
  return parts.length ? `Filled ${joinWords(parts)}.` : "";
}

function tidyName(raw: string) {
  const stop = new Set(["the", "a", "an", "our", "we", "my", "from", "at", "and", "with", "building", "based", "currently", "here", "excited", "working", "raising", "looking", "going", "trying", "just", "really", "actually", "founder", "startup", "company"]);
  const words = raw.trim().split(/\s+/).slice(0, 3).filter(Boolean);
  if (!words.length || words.some((word) => stop.has(word.toLowerCase().replace(/[^a-z]/g, "")))) return "";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function tidyCompany(raw: string) {
  const cleaned = raw.replace(/[.,;:]+$/g, "").trim();
  const words = cleaned.split(/\s+/).slice(0, 4);
  if (words.length < 1 || words.length > 4) return "";
  if (words.some((word) => /^(the|a|an|our|this|that|pitch|deck|startup|company)$/i.test(word))) return "";
  if (cleaned.length < 2 || cleaned.length > 42) return "";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function prettyFileName(name: string) {
  const ext = (name.split(".").pop() || "").toUpperCase();
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { base: base || name, ext };
}

function companyFromFilename(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  const cleaned = base
    .replace(/\b(pitch|deck|final|draft|slides?|investor|seed|preseed|pre seed|series|confidential|copy|version|startup|presentation|pdf|pptx?|docx?)\b/gi, " ")
    .replace(/\bv\d+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return tidyCompany(cleaned);
}

function readPitchClues(text: string): PitchClues {
  const clues: PitchClues = {};
  const founder =
    text.match(/my name is\s+([a-z][a-z.'’-]+(?:\s+[a-z][a-z.'’-]+){0,2})/i)?.[1]
    || text.match(/(?:i'm|i am)\s+([a-z][a-z.'’-]+(?:\s+[a-z][a-z.'’-]+){0,2})/i)?.[1]
    || text.match(/([a-z][a-z.'’-]+(?:\s+[a-z][a-z.'’-]+)?)\s*,?\s*(?:the\s+)?(?:co-?founder|founder|ceo)\b/i)?.[1];
  if (founder) {
    const name = tidyName(founder);
    if (name) clues.founder = name;
  }
  const company =
    text.match(/(?:co-?founder|founder|ceo)\s+(?:of|at)\s+([a-z0-9][\w&.'’-]*(?:\s+[a-z0-9][\w&.'’-]*){0,3})/i)?.[1]
    || text.match(/(?:company|startup)\s+(?:is\s+)?(?:called\s+)?([a-z0-9][\w&.'’-]*(?:\s+[a-z0-9][\w&.'’-]*){0,3})/i)?.[1]
    || text.match(/(?:we(?:'re| are) called|called)\s+([a-z0-9][\w&.'’-]*(?:\s+[a-z0-9][\w&.'’-]*){0,3})/i)?.[1];
  if (company) {
    const name = tidyCompany(company);
    if (name) clues.company = name;
  }
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email && !/example\.com|noreply/i.test(email)) clues.email = email.toLowerCase();
  const site = text.match(/https?:\/\/[^\s)]+|www\.[^\s)]+/i)?.[0]?.replace(/[.,]+$/, "");
  if (site) clues.website = site.startsWith("http") ? site : `https://${site}`;
  const country = [...COUNTRY_NAMES].sort((a, b) => b.length - a.length).find((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  if (country) clues.country = COUNTRY_CANON[country] || country;
  if (/\bpre[-\s]?seed\b/i.test(text)) clues.stage = "PreSeed";
  else if (/\bseed\b/i.test(text)) clues.stage = "Seed";
  else if (/\b(working prototype|prototype|mvp|beta)\b/i.test(text)) clues.stage = "WorkingPrototype";
  else if (/\b(idea stage|just an idea)\b/i.test(text)) clues.stage = "Idea";
  const theme = THEME_RULES.find(([rule]) => rule.test(text));
  if (theme) clues.theme = theme[1];
  return clues;
}

async function textFromDeck(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return (await file.text()).slice(0, 20000);
  }
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") return "";
  try {
    const pdfjs = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs") as {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (src: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }> }> };
    };
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let out = "";
    for (let i = 1; i <= Math.min(doc.numPages, 5); i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out += `${content.items.map((item) => item.str || "").join(" ")}\n`;
      if (out.length > 16000) break;
    }
    return out;
  } catch {
    return "";
  }
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

const PitchUs = () => {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("intake");
  const [submitting, setSubmitting] = useState(false);
  const [founderName, setFounderName] = useState("");
  const [founderEmail, setFounderEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [theme, setTheme] = useState("");
  const [stage, setStage] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [deckReading, setDeckReading] = useState(false);
  const [deckOver, setDeckOver] = useState(false);
  const [clues, setClues] = useState<Partial<Record<keyof PitchClues, "pitch" | "deck">>>({});
  const fieldsRef = useRef({ companyName: "", founderName: "", founderEmail: "", country: "", theme: "", stage: "", websiteUrl: "" });
  const [explainerFile, setExplainerFile] = useState<File | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [progress, setProgress] = useState<ProgressStep[]>([]);
  const [artifacts, setArtifacts] = useState<Artifacts>({});
  const [pitchId, setPitchId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [blockIdx, setBlockIdx] = useState(0);
  const [outputReady, setOutputReady] = useState(false);
  const [isRoundTwo, setIsRoundTwo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [critiqueLevel, setCritiqueLevel] = useState(5);
  const answeredRef = useRef(false);

  const copyNote = async () => {
    if (!feedback) return;
    try {
      await navigator.clipboard.writeText(feedback);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const memoBlocks = useMemo(() => (feedback ? parseMemo(feedback) : []), [feedback]);
  const noteDone = blockIdx >= memoBlocks.length && memoBlocks.length > 0;
  const inSession = phase === "reviewing" || phase === "questions" || phase === "result";

  const revealResult = useCallback(() => {
    setOutputReady(false);
    setBlockIdx(0);
    setPhase("result");
  }, []);

  const applyEngineData = useCallback((data: {
    status?: string;
    verdict?: string;
    founder_feedback?: string;
    confidence?: number;
    progress?: unknown;
    questions?: string[];
  }) => {
    if (data.progress != null) {
      const { steps, artifacts: arts } = normalizeProgress(data.progress);
      if (steps.length) setProgress(steps);
      setArtifacts((prev) => ({ ...prev, ...arts }));
    }
    if (data.status === "completed") {
      setVerdict(data.verdict ?? null);
      setFeedback(data.founder_feedback ?? null);
      setConfidence(data.confidence ?? null);
      setProgress((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
      setOutputReady(true);
      return true;
    }
    if (data.status === "needs_input" && !answeredRef.current) {
      const fromPayload = data.questions?.filter(Boolean) ?? [];
      const fromProgress =
        (data.progress != null ? normalizeProgress(data.progress).artifacts.questions : undefined) || [];
      const qs = (fromPayload.length ? fromPayload : fromProgress).filter(Boolean);
      if (qs.length) setArtifacts((prev) => ({ ...prev, questions: qs }));
      setPhase("questions");
    }
    return false;
  }, []);

  const pollStatus = useCallback(async (id: string, token: string) => {
    const { data, error } = await supabase.rpc("get_pitch_status", {
      p_id: id,
      p_token: token,
    });
    if (error || !data) return null;
    return data as {
      status: string;
      progress?: unknown;
      verdict?: string;
      founder_feedback?: string;
      confidence?: number;
      error_message?: string;
    };
  }, []);

  useEffect(() => {
    if (phase !== "reviewing" || !pitchId || !accessToken || outputReady) return;
    const timer = setInterval(async () => {
      const data = await pollStatus(pitchId, accessToken);
      if (!data) return;
      if (data.status === "failed") {
        setErrorMsg(data.error_message || "Review failed");
        setPhase("error");
        clearInterval(timer);
        return;
      }
      const done = applyEngineData({
        status: data.status,
        verdict: data.verdict,
        founder_feedback: data.founder_feedback,
        confidence: data.confidence,
        progress: data.progress,
      });
      if (done || (data.status === "needs_input" && !answeredRef.current)) clearInterval(timer);
    }, 1100);
    return () => clearInterval(timer);
  }, [phase, pitchId, accessToken, pollStatus, applyEngineData, outputReady]);

  fieldsRef.current = { companyName, founderName, founderEmail, country, theme, stage, websiteUrl };

  const applyClues = (partial: PitchClues, source: "pitch" | "deck") => {
    const current = { ...fieldsRef.current };
    const added: Partial<Record<keyof PitchClues, "pitch" | "deck">> = {};
    if (!current.companyName.trim() && partial.company) {
      current.companyName = partial.company;
      setCompanyName(partial.company);
      added.company = source;
    }
    if (!current.founderName.trim() && partial.founder) {
      current.founderName = partial.founder;
      setFounderName(partial.founder);
      added.founder = source;
    }
    if (!current.founderEmail.trim() && partial.email) {
      current.founderEmail = partial.email;
      setFounderEmail(partial.email);
      added.email = source;
    }
    if (!current.country.trim() && partial.country) {
      current.country = partial.country;
      setCountry(partial.country);
      added.country = source;
    }
    if (!current.theme.trim() && partial.theme) {
      current.theme = partial.theme;
      setTheme(partial.theme);
      added.theme = source;
    }
    if (!current.stage.trim() && partial.stage) {
      current.stage = partial.stage;
      setStage(partial.stage);
      added.stage = source;
    }
    if (!current.websiteUrl.trim() && partial.website) {
      current.websiteUrl = partial.website;
      setWebsiteUrl(partial.website);
      added.website = source;
    }
    fieldsRef.current = current;
    if (Object.keys(added).length) setClues((prev) => ({ ...prev, ...added }));
  };

  const clearClue = (key: keyof PitchClues) => setClues((current) => ({ ...current, [key]: undefined }));

  const handleFile = (next: File | null) => {
    if (!next) return;
    if (next.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 50MB", variant: "destructive" });
      return;
    }
    setFile(next);
    setDeckReading(true);
    const fromName = companyFromFilename(next.name);
    void textFromDeck(next).then((text) => {
      const partial = readPitchClues(text);
      if (!partial.company && fromName) partial.company = fromName;
      applyClues(partial, "deck");
    }).finally(() => setDeckReading(false));
  };

  const handleExplainer = (next: File | null) => {
    if (!next) return;
    if (!next.type.startsWith("video/") && !/\.(mp4|webm|mov|m4v)$/i.test(next.name)) {
      toast({ title: "Use a video", description: "Explainer uploads should be mp4, webm, or mov.", variant: "destructive" });
      return;
    }
    if (next.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 50MB", variant: "destructive" });
      return;
    }
    setExplainerFile(next);
  };

  const invokeEngine = useCallback(async (payload: Record<string, unknown>, id: string, token: string) => {
    // This app uses the A2A review. The previous app still calls review-pitch.
    const { data, error } = await supabase.functions.invoke("review-pitch-a2a", { body: payload });

    if (data?.status) {
      applyEngineData(data);
      return;
    }
    if (data?.error) throw new Error(String(data.error));

    if (error) {
      const detail = await invokeErrorMessage(error);
      // Opaque gateway/client errors: keep polling — the review may still
      // complete server-side or get marked failed.
      if (/non-2xx|Failed to send|network|fetch/i.test(detail)) {
        await new Promise((r) => setTimeout(r, 1200));
        const row = await pollStatus(id, token);
        if (row?.status === "failed") throw new Error(row.error_message || detail);
        if (row) {
          applyEngineData({
            status: row.status,
            verdict: row.verdict,
            founder_feedback: row.founder_feedback,
            confidence: row.confidence,
            progress: row.progress,
          });
        }
        return;
      }
      throw new Error(detail);
    }
  }, [applyEngineData, pollStatus]);

  const submitPitch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      toast({
        title: "Acknowledge educational use",
        description: "This review is for learning only — not a funding decision.",
        variant: "destructive",
      });
      return;
    }
    if (!founderName.trim() || !founderEmail.trim() || !companyName.trim() || !country.trim() || !theme || !stage) {
      toast({
        title: "Details missing",
        description: "Add your name, email, company, country, theme, and stage.",
        variant: "destructive",
      });
      return;
    }
    if (!file && !explainerFile && !videoUrl.trim() && !websiteUrl.trim() && !liveTranscript.trim()) {
      toast({
        title: "Add at least one source",
        description: "Pick any mix: deck, explainer video, live pitch, video link, or website.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    answeredRef.current = false;

    try {
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMime: string | null = null;
      let materialType: "deck" | "video" | "explainer" | "mixed" = "explainer";

      if (file) {
        const ext = file.name.split(".").pop() || "bin";
        filePath = `${crypto.randomUUID()}.${ext}`;
        fileName = file.name;
        fileMime = file.type || null;
        const { error: uploadError } = await supabase.storage
          .from("pitch-materials")
          .upload(filePath, file, { contentType: file.type || undefined, upsert: false });
        if (uploadError) throw uploadError;
        materialType = "deck";
      } else if (explainerFile) {
        const ext = explainerFile.name.split(".").pop() || "mp4";
        filePath = `${crypto.randomUUID()}.${ext}`;
        fileName = explainerFile.name;
        fileMime = explainerFile.type || "video/mp4";
        const { error: uploadError } = await supabase.storage
          .from("pitch-materials")
          .upload(filePath, explainerFile, { contentType: fileMime, upsert: false });
        if (uploadError) throw uploadError;
        materialType = "video";
      }

      let explainerNote = "";
      if (explainerFile && file) {
        const ext = explainerFile.name.split(".").pop() || "mp4";
        const path = `${crypto.randomUUID()}.${ext}`;
        const mime = explainerFile.type || "video/mp4";
        const { error: uploadError } = await supabase.storage
          .from("pitch-materials")
          .upload(path, explainerFile, { contentType: mime, upsert: false });
        if (uploadError) throw uploadError;
        const { data, error } = await supabase.functions.invoke("transcribe-live-pitch", {
          body: { file_path: path, file_name: explainerFile.name, file_mime: mime },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || "Could not transcribe the explainer");
        explainerNote = `EXPLAINER VIDEO (speech-to-text):\n${String(data.transcript || "").trim()}`;
        materialType = "mixed";
      }

      const sources = [file, explainerFile, liveTranscript.trim(), videoUrl.trim(), websiteUrl.trim()].filter(Boolean).length;
      if (sources > 1) materialType = "mixed";

      const stageLabel = STAGES.find((s) => s.value === stage)?.label || stage;
      const founderContext = [
        "FOUNDER CONTEXT",
        `Location: ${country.trim()}`,
        `Theme: ${theme}`,
        `Stage: ${stageLabel}`,
      ].join("\n");

      const liveNote = [
        founderContext,
        liveTranscript.trim()
          ? `FOUNDER LIVE PITCH (speech-to-text from a camera recording, max 3 minutes):\n${liveTranscript.trim()}`
          : "",
        explainerNote,
      ].filter(Boolean).join("\n\n");

      const { data: pitch, error: insertError } = await supabase.rpc("submit_pitch", {
        p_founder_name: founderName.trim(),
        p_founder_email: founderEmail.trim(),
        p_company_name: companyName.trim(),
        p_one_liner: `${theme} · ${stageLabel} · ${country.trim()}`,
        p_pitch_narrative: liveNote,
        p_website_url: websiteUrl.trim() || null,
        p_video_url: videoUrl.trim() || null,
        p_material_type: materialType,
        p_file_path: filePath,
        p_file_name: fileName,
        p_file_mime: fileMime,
      });

      if (insertError || !pitch) throw insertError || new Error("Could not create pitch");

      const created = pitch as { id: string; access_token: string };
      setPitchId(created.id);
      setAccessToken(created.access_token);
      setOutputReady(false);
      setArtifacts({});
      setPhase("reviewing");
      setProgress(INITIAL_STEPS);

      await invokeEngine(
        { pitch_id: created.id, access_token: created.access_token, critique_level: critiqueLevel },
        created.id,
        created.access_token,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(message);
      setPhase("error");
      toast({ title: "Review failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const submitAnswers = async (answers: string[], skip: boolean) => {
    if (!pitchId || !accessToken) return;
    answeredRef.current = true;
    setSubmitting(true);
    setPhase("reviewing");
    try {
      await invokeEngine(
        {
          pitch_id: pitchId,
          access_token: accessToken,
          answers: skip ? [] : answers.map((a) => a.trim()),
          skip_questions: skip,
          critique_level: critiqueLevel,
        },
        pitchId,
        accessToken,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(message);
      setPhase("error");
      toast({ title: "Review failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForRound = (round2: boolean) => {
    setPhase("intake");
    setProgress([]);
    setArtifacts({});
    setPitchId(null);
    setAccessToken(null);
    setVerdict(null);
    setFeedback(null);
    setConfidence(null);
    setErrorMsg(null);
    setFile(null);
    setExplainerFile(null);
    setLiveTranscript("");
    setBlockIdx(0);
    setOutputReady(false);
    setIsRoundTwo(round2);
    answeredRef.current = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const fieldClass = "pitch-line";

  let paraCount = -1;

  return (
    <div className="pitch-theme relative min-h-screen overflow-hidden bg-background font-pitch-display">
      <div className="fixed inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      <div className="absolute inset-0 bg-black" />
      <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-primary/5 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-10 h-80 w-80 rounded-full bg-secondary/5 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-20 pt-10 md:pt-14">
        {phase === "intake" && (
          <form onSubmit={submitPitch} className="pitch-intake mx-auto max-w-5xl animate-slide-up">
            <header className="mb-10 flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
              <div className="min-w-0">
                <h1 className="text-4xl font-medium tracking-tight text-white md:text-5xl">AI-pitch review · Beta</h1>
                <p className="mt-3 max-w-xl text-base text-white/55">
                  {isRoundTwo
                    ? "Bring what changed. The next pass weighs it against the last one."
                    : "A live pitch and a deck, or either one. A site, a video link, or an explainer can come along too. An educational review follows: strengths, and where to improve. Not a funding decision, and no commitment of capital."}
                </p>
                <p className="mt-4 max-w-xl text-xs leading-relaxed text-white/40">{DISCLAIMER}</p>
              </div>
              <button type="button" onClick={() => go("/super-league")} className="shrink-0 text-sm text-white/50 hover:text-white">
                Super League
              </button>
            </header>

            <div className="border border-white/15">
              <div className="relative grid md:grid-cols-2">
                <div className={cn("border-b border-white/15 transition-colors md:border-b-0 md:border-r", liveTranscript ? "bg-primary/[0.04]" : "hover:bg-white/[0.03]")}>
                  <LivePitchRecorder
                    transcript={liveTranscript}
                    onTranscript={(text) => {
                      setLiveTranscript(text);
                      if (text.trim()) applyClues(readPitchClues(text), "pitch");
                    }}
                    founderName={founderName}
                    companyName={companyName}
                  />
                </div>
                <label
                  className={cn("flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors md:px-6 md:py-5 md:pl-14", deckOver && "bg-primary/10", file ? "bg-primary/[0.04]" : "hover:bg-white/[0.03]")}
                  onDragOver={(e) => { e.preventDefault(); setDeckOver(true); }}
                  onDragLeave={() => setDeckOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDeckOver(false); handleFile(e.dataTransfer.files?.[0] ?? null); }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] uppercase tracking-[0.22em] text-white/35">02</span>
                    <span className="mt-1 block text-xl font-medium tracking-tight text-white">Upload deck</span>
                    <span className="mt-1 block truncate text-sm text-white/45">
                      {file ? prettyFileName(file.name).base : deckReading ? "Reading the deck" : "Drop a PDF or slides"}
                    </span>
                  </span>
                  {file && (
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-white/35">{prettyFileName(file.name).ext}</span>
                  )}
                  <span className="flex shrink-0 items-center gap-4">
                    {file && (
                      <button type="button" className="text-sm text-white/40 hover:text-white" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFile(null); setDeckReading(false); }}>
                        Remove
                      </button>
                    )}
                    <span className="text-sm text-primary">{file ? "Replace" : "Upload"}</span>
                  </span>
                  <input id="pitch-deck" type="file" className="hidden" accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.webp,.txt,.md" onChange={(e) => { handleFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                </label>
                <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black text-center text-[8px] uppercase leading-tight tracking-[0.12em] text-white/55 md:grid">
                  and<br />or
                </div>
              </div>
              <div className="grid border-t border-white/15 md:grid-cols-3">
              <label className="flex min-w-0 items-center gap-3 border-b border-white/15 px-5 py-4 md:border-b-0 md:border-r">
                <span className="sr-only">Website</span>
                <input className="w-full bg-transparent text-[15px] text-white placeholder:text-white/40 focus:outline-none" value={websiteUrl} onChange={(e) => { setWebsiteUrl(e.target.value); clearClue("website"); }} placeholder="Website" />
              </label>
              <label className="flex min-w-0 items-center gap-3 border-b border-white/15 px-5 py-4 md:border-b-0 md:border-r">
                <span className="sr-only">Video link</span>
                <input className="w-full bg-transparent text-[15px] text-white placeholder:text-white/40 focus:outline-none" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Video link" />
              </label>
              <label className="flex min-w-0 cursor-pointer items-center gap-3 px-5 py-4">
                <span className="min-w-0 flex-1 truncate text-[15px] text-white/80">{explainerFile ? explainerFile.name : "Explainer video"}</span>
                {explainerFile ? (
                  <button type="button" className="shrink-0 text-sm text-white/45 hover:text-white" onClick={(e) => { e.preventDefault(); setExplainerFile(null); }}>Remove</button>
                ) : (
                  <span className="shrink-0 text-sm text-primary">Add</span>
                )}
                <input type="file" className="hidden" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" onChange={(e) => { handleExplainer(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              </label>
              </div>
            </div>

            {(file || liveTranscript.trim() || explainerFile || videoUrl.trim() || websiteUrl.trim()) && (
            <div className="mt-10 animate-slide-up">
              <p className="text-xs uppercase tracking-[0.18em] text-white/35">Details</p>
              <p className="mt-2 max-w-xl text-sm text-white/50">
                {(() => {
                  const filled = describeClues(clues);
                  const missing = [
                    !companyName.trim() && "company",
                    !founderName.trim() && "your name",
                    !founderEmail.trim() && "email",
                    !country.trim() && "country",
                    !theme && "theme",
                    !stage && "stage",
                  ].filter(Boolean);
                  return [filled, missing.length ? `Still needs ${joinWords(missing as string[])}.` : "Change anything that looks off."].filter(Boolean).join(" ");
                })()}
              </p>
              <div className="mt-4 grid gap-x-12 md:grid-cols-2">
                <label className="flex items-end gap-3">
                  <span className="sr-only">Company</span>
                  <input className={fieldClass} value={companyName} onChange={(e) => { setCompanyName(e.target.value); clearClue("company"); }} placeholder="Company" required />
                  {clues.company && <span className="mb-3 shrink-0 text-[10px] uppercase tracking-[0.14em] text-primary/80">{clues.company === "deck" ? "Deck" : "Pitch"}</span>}
                </label>
                <label className="flex items-end gap-3">
                  <span className="sr-only">Your name</span>
                  <input className={fieldClass} value={founderName} onChange={(e) => { setFounderName(e.target.value); clearClue("founder"); }} placeholder="Your name" required />
                  {clues.founder && <span className="mb-3 shrink-0 text-[10px] uppercase tracking-[0.14em] text-primary/80">{clues.founder === "deck" ? "Deck" : "Pitch"}</span>}
                </label>
                <label className="flex items-end gap-3">
                  <span className="sr-only">Email</span>
                  <input type="email" className={fieldClass} value={founderEmail} onChange={(e) => { setFounderEmail(e.target.value); clearClue("email"); }} placeholder="Email" required />
                  {clues.email && <span className="mb-3 shrink-0 text-[10px] uppercase tracking-[0.14em] text-primary/80">{clues.email === "deck" ? "Deck" : "Pitch"}</span>}
                </label>
                <label className="flex items-end gap-3">
                  <span className="sr-only">Country</span>
                  <input className={fieldClass} value={country} onChange={(e) => { setCountry(e.target.value); clearClue("country"); }} placeholder="Country" required />
                  {clues.country && <span className="mb-3 shrink-0 text-[10px] uppercase tracking-[0.14em] text-primary/80">{clues.country === "deck" ? "Deck" : "Pitch"}</span>}
                </label>
                <label className="flex items-end gap-3">
                  <span className="sr-only">Theme</span>
                  <span className="relative min-w-0 flex-1">
                    <select
                      className={cn(fieldClass, "appearance-none pr-6", !theme && "text-white/35")}
                      value={theme}
                      onChange={(e) => { setTheme(e.target.value); clearClue("theme"); }}
                      required
                    >
                      <option value="" disabled>Theme</option>
                      {THEMES.map((item) => (
                        <option key={item} value={item} className="bg-black text-white">{item}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  </span>
                  {clues.theme && <span className="mb-3 shrink-0 text-[10px] uppercase tracking-[0.14em] text-primary/80">{clues.theme === "deck" ? "Deck" : "Pitch"}</span>}
                </label>
                <label className="flex items-end gap-3">
                  <span className="sr-only">Stage</span>
                  <span className="relative min-w-0 flex-1">
                    <select
                      className={cn(fieldClass, "appearance-none pr-6", !stage && "text-white/35")}
                      value={stage}
                      onChange={(e) => { setStage(e.target.value); clearClue("stage"); }}
                      required
                    >
                      <option value="" disabled>Stage</option>
                      {STAGES.map((item) => (
                        <option key={item.value} value={item.value} className="bg-black text-white">{item.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  </span>
                  {clues.stage && <span className="mb-3 shrink-0 text-[10px] uppercase tracking-[0.14em] text-primary/80">{clues.stage === "deck" ? "Deck" : "Pitch"}</span>}
                </label>
              </div>

            <div className="mt-10 border-t border-white/10 pt-6">
              <CritiqueDial value={critiqueLevel} onChange={setCritiqueLevel} />
            </div>
            </div>
            )}

            <div className="mt-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <label className="flex max-w-xl items-start gap-3 text-sm leading-relaxed text-white/55">
                <input
                  type="checkbox"
                  className="mt-1 accent-[hsl(192_92%_64%)]"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>I understand this is for educational purposes only. It is not investment advice, not an offer to invest, and not a commitment of capital.</span>
              </label>
              {(file || liveTranscript.trim() || explainerFile || videoUrl.trim() || websiteUrl.trim()) && (
                <Button type="submit" disabled={submitting} className="pitch-launch gap-2 text-sm hover:brightness-110">
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Reading
                    </>
                  ) : (
                    <>
                      Run AI-pitch review <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>
        )}

        {inSession && (
          <section className="mx-auto max-w-5xl animate-fade-in">
            <p className="mb-8 text-sm text-red-500">{LIVE_DISCLAIMER}</p>
            {phase !== "result" && (
            <header>
              <div className="mb-4 flex items-center gap-3">
                <ReviewerCore live={phase === "reviewing"} size={28} />
                <p className="text-xs uppercase tracking-[0.22em] text-primary">
                  {phase === "questions" ? "Your move" : "In review"}
                </p>
              </div>
              <h2 className="text-4xl font-medium tracking-tight text-white md:text-5xl">
                {companyName.trim() || "Session"}
              </h2>
              <p className="mt-3 max-w-xl text-sm text-white/45">
                {[theme, STAGES.find((s) => s.value === stage)?.label, country.trim()].filter(Boolean).join(" · ") ||
                  (liveTranscript.trim()
                    ? "Deck + live pitch"
                    : websiteUrl.trim() || (file ? file.name : videoUrl.trim()) || "Educational review in progress")}
              </p>
            </header>
            )}

            {phase !== "result" && <PipelineStrip progress={progress} />}

            {(phase === "reviewing" || phase === "questions") && (
              <ThoughtStream
                key={pitchId || "review"}
                progress={progress}
                artifacts={artifacts}
                outputReady={outputReady}
                onReadyToReveal={revealResult}
                deckAttached={!!file}
                spoken={liveTranscript}
              />
            )}

            {phase === "questions" && (
              <QuestionCard
                questions={artifacts.questions || []}
                onSubmit={submitAnswers}
                sending={submitting}
              />
            )}

            {phase === "result" && verdict && (
              <div className="animate-fade-in">
                <header className="mb-8 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-primary">Read complete</p>
                    <h2 className="mt-2 text-4xl font-medium tracking-tight text-white">{companyName.trim() || "AI-pitch review"}</h2>
                  </div>
                  {noteDone && (
                    <button type="button" onClick={copyNote} className="text-sm text-white/45 hover:text-white">
                      {copied ? "Copied" : "Copy"}
                    </button>
                  )}
                </header>
                <ConvictionBlock verdict={verdict} confidence={confidence} />
                {artifacts.jev && <JevRead jev={artifacts.jev} />}

                <div className="mt-10">
                    <div>
                      {memoBlocks.slice(0, blockIdx + 1).map((block, i) => {
                        if (block.kind === "para") paraCount += 1;
                        const label = memoBlockLabel(block, paraCount);
                        const isTyping = i === blockIdx;
                        const isQuestion = block.kind === "question";
                        return (
                          <div key={i} className={cn("animate-thought-in", RESULT_ROW)}>
                            <p className="text-xs uppercase tracking-[0.16em] text-white/35">{label}</p>
                            <div className="mt-2 min-w-0 md:mt-0">
                            {block.kind === "bullets" ? (
                              isTyping ? (
                                <RevealCount total={block.lines.length} onDone={() => setBlockIdx((n) => n + 1)}>
                                  {(visible) => (
                                    <ul className="space-y-2">
                                      {block.lines.slice(0, visible).map((l, j) => (
                                        <li key={j} className="text-base leading-relaxed text-white/90">{l}</li>
                                      ))}
                                    </ul>
                                  )}
                                </RevealCount>
                              ) : (
                                <ul className="space-y-2">
                                  {block.lines.map((l, j) => (
                                    <li key={j} className="text-base leading-relaxed text-white/90">{l}</li>
                                  ))}
                                </ul>
                              )
                            ) : (
                              <p className={cn("leading-relaxed text-white/90", isQuestion ? "text-xl text-white" : "text-base")}>
                                {isTyping ? (
                                  <TypeText text={block.lines.join(" ")} onDone={() => setBlockIdx((n) => n + 1)} />
                                ) : (
                                  block.lines.join(" ")
                                )}
                              </p>
                            )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {artifacts.scores && (
                      <ResultFold title="Scores" summary={`${Object.keys(artifacts.scores.values).length} dimensions`} defaultOpen>
                        <ScoreBars scores={artifacts.scores} />
                      </ResultFold>
                    )}
                    {artifacts.persuasion && (
                      <ResultFold title="Persuasion" summary={artifacts.persuasion.persona} defaultOpen>
                        <PersuasionMeter persuasion={artifacts.persuasion} />
                      </ResultFold>
                    )}
                    {(artifacts.numbers || []).length > 0 && (
                      <ResultFold title="Numbers" summary={`${artifacts.numbers!.length} figures`}>
                        <NumberTable numbers={artifacts.numbers || []} />
                      </ResultFold>
                    )}
                    {(artifacts.cross_checks || []).length > 0 && (
                      <ResultFold title="Math" summary={`${artifacts.cross_checks!.length} ${artifacts.cross_checks!.length === 1 ? "tension" : "tensions"}`}>
                        <MathChecks checks={artifacts.cross_checks || []} />
                      </ResultFold>
                    )}
                    {(artifacts.evidence || []).length > 0 && (
                      <ResultFold title="Evidence" summary={evidenceSummary(artifacts.evidence || [])}>
                        <EvidencePanel evidence={artifacts.evidence || []} numbers={artifacts.numbers} deckNote={artifacts.deck_note} deckAttached={!!file} spoken={liveTranscript} />
                      </ResultFold>
                    )}
                </div>

                <SuperLeagueInvite
                  companyName={companyName}
                  founderName={founderName}
                  country={country}
                  theme={theme}
                  stage={stage}
                  pitchId={pitchId}
                />

                <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-6 lg:flex-row lg:items-center lg:justify-between">
                  <p className="max-w-xl text-sm text-white/45">
                    Answer the question in the notes. The next read checks whether it lands.
                  </p>
                  <div className="flex items-center gap-4">
                    <Button type="button" variant="ghost" onClick={() => resetForRound(false)} className="text-white/70 hover:bg-transparent hover:text-white">
                      Back
                    </Button>
                    <Button onClick={() => resetForRound(true)} className="pitch-launch">
                      Run again
                    </Button>
                  </div>
                </div>
                <p className="mt-4 max-w-3xl text-xs leading-relaxed text-white/30">{DISCLAIMER}</p>
                {pitchId && (
                  <p className="mt-3 text-xs tracking-[0.16em] text-white/30">REF {pitchId.slice(0, 8).toUpperCase()}</p>
                )}
              </div>
            )}

            {phase !== "result" && (
              <p className="mt-6 text-sm text-muted-foreground">{DISCLAIMER}</p>
            )}
          </section>
        )}

        {phase === "error" && (
          <section className="mx-auto max-w-md text-center animate-fade-in">
            <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-destructive" />
            <h2 className="text-2xl font-bold">AI-pitch review interrupted</h2>
            <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
            <Button onClick={() => resetForRound(false)} className="mt-6 rounded-full bg-gradient-primary text-white">
              Try again
            </Button>
          </section>
        )}
      </div>
    </div>
  );
};

export default PitchUs;
