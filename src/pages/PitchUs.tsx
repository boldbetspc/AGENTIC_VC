import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Paperclip, Link2, Loader2, AlertTriangle, X, ChevronDown, Video } from "lucide-react";
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
};

type Phase = "intake" | "reviewing" | "questions" | "result" | "error";

const INITIAL_STEPS: ProgressStep[] = [
  { id: "ingest", label: "Ingest materials", status: "running" },
  { id: "brief", label: "Analyst brief", status: "pending" },
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
    label: "Held up",
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

/** Where a claim was checked — full materials, not brief alone. */
function materialSourceLabel(source?: string): string {
  const s = String(source || "").toLowerCase();
  if (!s) return "Materials";
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

function ClaimChips({ artifacts }: { artifacts: Artifacts }) {
  const claims = artifacts.claims || [];
  if (!claims.length) return null;
  const evidence = artifacts.evidence || [];
  const hasEvidence = evidence.length > 0;
  return (
    <div className="mt-2 space-y-1.5 pl-7">
      {hasEvidence && (
        <p className="font-pitch-serif text-sm italic text-muted-foreground/75">
          Checked against deck, charts, website, video &amp; brief
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {claims.map((c, i) => {
          const ev = findEvidenceForClaim(c.claim, evidence);
          const badge = ev ? EVIDENCE_BADGE[ev.status] : null;
          const src = ev ? materialSourceLabel(ev.source) : null;
          return (
            <span
              key={i}
              style={{ animationDelay: `${i * 90}ms` }}
              title={ev ? `${ev.note || ""}${ev.source ? ` · ${ev.source}` : ""}`.trim() : "Awaiting materials check"}
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
}: {
  progress: ProgressStep[];
  artifacts: Artifacts;
  outputReady?: boolean;
  onReadyToReveal?: () => void;
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
              {showClaims && <ClaimChips artifacts={artifacts} />}
              {teaser && (
                <p className="mt-2 animate-fade-in pl-8 text-sm leading-relaxed text-white/55">
                  “{teaser}”
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
  return blocks;
}

function memoBlockLabel(block: MemoBlock, paraIndex: number): string {
  if (block.kind === "question") return "THE QUESTION";
  if (block.kind === "bullets") return "EVIDENCE";
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

function ScoreBars({ scores }: { scores: NonNullable<Artifacts["scores"]> }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 120);
    return () => window.clearTimeout(t);
  }, []);
  const entries = Object.entries(scores.values).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return null;
  return (
    <div className="animate-fade-in">
      <p className="text-xs uppercase tracking-[0.18em] text-white/35">By dimension</p>
      <div className="mt-4 space-y-4">
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
      <p className="text-xs uppercase tracking-[0.18em] text-white/35">Persuasion</p>
      <p className="mt-3 text-2xl font-medium tracking-tight text-white">{persuasion.persona}</p>
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

function EvidencePanel({ evidence }: { evidence: EvidenceRow[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!evidence.length) return null;
  return (
    <div className="animate-fade-in">
      <p className="text-xs uppercase tracking-[0.18em] text-white/35">Materials check</p>
      <div className="mt-2">
        {evidence.map((e, i) => {
          const tone = FEEDBACK_BADGE[e.status] || FEEDBACK_BADGE.unknown;
          const label = (EVIDENCE_BADGE[e.status] || EVIDENCE_BADGE.unknown).label;
          const expanded = open === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpen(expanded ? null : i)}
              className="block w-full border-b border-white/10 py-3 text-left"
            >
              <div className="flex items-baseline gap-3">
                <span className={cn("w-24 shrink-0 text-xs", tone)}>{label}</span>
                <span className="min-w-0 flex-1 text-sm text-white">{e.claim}</span>
                <span className="shrink-0 text-xs text-white/40">{materialSourceLabel(e.source)}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-white/40 transition-transform", expanded && "rotate-180")} />
              </div>
              {expanded && (
                <p className="mt-2 pl-24 text-sm leading-relaxed text-white/60">
                  {e.note || "No further detail."}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const VERDICT_STYLE: Record<string, { hue: string; caption: string }> = {
  HOT: { hue: "18 95% 62%", caption: "Unusually strong read" },
  WARM: { hue: "42 96% 58%", caption: "Real, but incomplete" },
  PASS: { hue: "222 18% 62%", caption: "The gaps win this round" },
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
        <div>
          <p
            className="text-5xl font-medium tracking-tight"
            style={{ color: `hsl(${style.hue})` }}
          >
            {verdict}
          </p>
          <p className="mt-2 text-base text-white/70">{style.caption}</p>
        </div>
        {pct != null && (
          <p className="text-right">
            <span className="block text-3xl font-medium tabular-nums text-white">{pct}%</span>
            <span className="text-xs uppercase tracking-[0.16em] text-white/40">Conviction</span>
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Live pitch recorder ───────────────────────────────────────────────────── */

const LIVE_MAX_SEC = 180;

function formatClock(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function useMicLevel(stream: MediaStream | null, active: boolean) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || !active) {
      setLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      frame = requestAnimationFrame(tick);
    };
    void ctx.resume().then(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void ctx.close();
    };
  }, [stream, active]);
  return level;
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
  const startedRef = useRef(false);
  const secondsRef = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<"idle" | "countdown" | "recording" | "saving" | "error">("idle");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [takenSeconds, setTakenSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const level = useMicLevel(stream, mode === "countdown");

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  };

  const stopTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => {
    stopTimer();
    stopStream();
  }, []);

  const openCamera = async () => {
    if (streamRef.current) return streamRef.current;
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = next;
      setStream(next);
      return next;
    } catch {
      toast({
        title: "Camera unavailable",
        description: "Allow camera and microphone to record a live pitch.",
        variant: "destructive",
      });
      setMode("idle");
      return null;
    }
  };

  const transcribe = async (next: Blob) => {
    setMode("saving");
    setError(null);
    try {
      const ext = next.type.includes("mp4") ? "mp4" : "webm";
      const path = `${crypto.randomUUID()}.${ext}`;
      const contentType = ext === "mp4" ? "video/mp4" : "video/webm";
      const { error: uploadError } = await supabase.storage.from("pitch-materials").upload(path, next, {
        contentType,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data, error: invokeError } = await supabase.functions.invoke("transcribe-live-pitch", {
        body: { file_path: path, file_name: `live-pitch.${ext}`, file_mime: contentType },
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
    if (startedRef.current === false && recorderRef.current == null) return;
    stopTimer();
    setTakenSeconds(secondsRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else setMode("saving");
  };

  const startRecording = () => {
    const live = streamRef.current;
    if (!live || startedRef.current) return;
    startedRef.current = true;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
    const rec = new MediaRecorder(live, mime ? { mimeType: mime } : undefined);
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
    setSeconds(0);
    setMode("recording");
    onTranscript("");
    timerRef.current = window.setInterval(() => {
      setSeconds((n) => {
        const next = Math.min(LIVE_MAX_SEC, n + 1);
        secondsRef.current = next;
        if (next >= LIVE_MAX_SEC) finishRecording();
        return next;
      });
    }, 1000);
  };

  const begin = async () => {
    startedRef.current = false;
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
    <div>
      <div className="pitch-row">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", transcript ? "bg-primary" : "bg-white/25")} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] text-white">Live pitch</span>
          <span className="block text-xs text-white/40">{transcript ? formatClock(takenSeconds) : "Camera, 3 minutes"}</span>
        </span>
        <button type="button" onClick={transcript ? redo : begin} className="pitch-row-action text-sm text-white/55">
          {transcript ? "Redo" : "Record"}
        </button>
      </div>
      {transcript && (
        <div className="border-b border-white/10 pb-4">
          <button type="button" onClick={() => setTranscriptOpen((open) => !open)} className="text-sm text-white/50 hover:text-white">
            {transcriptOpen ? "Hide transcript" : "Transcript"}
          </button>
          {transcriptOpen && (
            <p className="mt-3 text-sm leading-relaxed text-white/80">{transcript}</p>
          )}
        </div>
      )}

      {onStage && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black px-6 text-white">
          <div className="flex items-start justify-between pt-8">
            <div>
              {founderName.trim() && <p className="text-sm text-white/45">{founderName.trim()}</p>}
              <p className="mt-1 text-2xl font-medium tracking-tight">{companyName.trim() || "Live pitch"}</p>
            </div>
            {mode === "countdown" && (
              <button type="button" onClick={leave} className="text-sm text-white/45 hover:text-white">Close</button>
            )}
          </div>
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="relative w-full max-w-3xl">
              <svg className="pointer-events-none absolute -inset-3 h-[calc(100%+1.5rem)] w-[calc(100%+1.5rem)]" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden>
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
              <video ref={videoRef} muted playsInline className={cn("aspect-video w-full bg-black object-cover", mode === "saving" || mode === "error" ? "invisible" : "-scale-x-100")} />
              {mode === "countdown" && countdown != null && countdown > 0 && (
                <div className="absolute inset-0 grid place-items-center text-7xl font-medium tabular-nums">{countdown}</div>
              )}
              {mode === "recording" && (
                <p className="absolute right-4 top-4 text-sm tabular-nums text-white/80">{formatClock(seconds)}</p>
              )}
            </div>
            {mode === "countdown" && (
              <div className="mt-8 flex h-6 items-end gap-1" aria-hidden>
                {Array.from({ length: 18 }, (_, i) => {
                  const dist = Math.abs(i - 8.5) / 8.5;
                  const height = Math.max(0.15, level * (1 - dist * 0.7));
                  return <span key={i} className="w-px bg-white/80" style={{ height: `${height * 24}px` }} />;
                })}
              </div>
            )}
            {mode === "recording" && (
              <button type="button" onClick={finishRecording} className="mt-8 text-sm text-white/70 hover:text-white">Stop</button>
            )}
            {mode === "saving" && <p className="mt-8 text-sm text-white/45">Saving the take</p>}
            {mode === "error" && (
              <div className="mt-8 flex items-center gap-6 text-sm">
                <p className="text-white/50">{error}</p>
                {blob && <button type="button" onClick={() => void transcribe(blob)} className="text-white">Try again</button>}
                <button type="button" onClick={leave} className="text-white/45">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
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

  const handleFile = (next: File | null) => {
    if (!next) return;
    if (next.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 50MB", variant: "destructive" });
      return;
    }
    setFile(next);
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
    const { data, error } = await supabase.functions.invoke("review-pitch", { body: payload });

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
            <header className="mb-10 flex items-end justify-between gap-6">
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <ReviewerCore live size={28} />
                  <p className="text-xs uppercase tracking-[0.22em] text-primary">Agent ready</p>
                </div>
                <h1 className="text-4xl font-medium tracking-tight text-white md:text-5xl">AI-pitch review</h1>
                <p className="mt-3 max-w-xl text-base text-white/55">
                  {isRoundTwo
                    ? "Bring what changed. The next pass weighs it against the last one."
                    : "Tell us about your startup. Record a live elevator pitch, up to 3 minutes, OR upload a pitch deck and other info. An AI agent gives an educational pitch review: a high-level look at strengths and areas to help improve. This is not a funding decision, and it creates no financial commitment."}
                </p>
                <p className="mt-4 max-w-xl text-xs leading-relaxed text-white/40">{DISCLAIMER}</p>
              </div>
              <button type="button" onClick={() => go("/super-league")} className="text-sm text-white/50 hover:text-white">
                Super League
              </button>
            </header>

            <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <section>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-white/35">You</p>
                <label className="block">
                  <span className="sr-only">Company</span>
                  <input className={fieldClass} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company" required />
                </label>
                <label className="block">
                  <span className="sr-only">Your name</span>
                  <input className={fieldClass} value={founderName} onChange={(e) => setFounderName(e.target.value)} placeholder="Your name" required />
                </label>
                <label className="block">
                  <span className="sr-only">Email</span>
                  <input type="email" className={fieldClass} value={founderEmail} onChange={(e) => setFounderEmail(e.target.value)} placeholder="Email" required />
                </label>
                <label className="block">
                  <span className="sr-only">Country</span>
                  <input className={fieldClass} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" required />
                </label>
                <label className="relative block">
                  <span className="sr-only">Theme</span>
                  <select
                    className={cn(fieldClass, "appearance-none pr-6", !theme && "text-white/35")}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    required
                  >
                    <option value="" disabled>Theme</option>
                    {THEMES.map((item) => (
                      <option key={item} value={item} className="bg-black text-white">{item}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                </label>
                <label className="relative block">
                  <span className="sr-only">Stage</span>
                  <select
                    className={cn(fieldClass, "appearance-none pr-6", !stage && "text-white/35")}
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                    required
                  >
                    <option value="" disabled>Stage</option>
                    {STAGES.map((item) => (
                      <option key={item.value} value={item.value} className="bg-black text-white">{item.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                </label>
              </section>

              <section>
                <div className="mb-1 flex items-baseline justify-between">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/35">Sources</p>
                  <p className="text-xs text-white/35">
                    {[file, explainerFile, videoUrl.trim(), websiteUrl.trim(), liveTranscript.trim()].filter(Boolean).length || "None"} ready
                  </p>
                </div>
                <LivePitchRecorder transcript={liveTranscript} onTranscript={setLiveTranscript} founderName={founderName} companyName={companyName} />
                <label className="pitch-row cursor-pointer">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", file ? "bg-primary" : "bg-white/25")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-white">Attach pitch deck</span>
                    <span className="block truncate text-xs text-white/40">{file ? file.name : "PDF, slides, or a doc"}</span>
                  </span>
                  {file ? (
                    <button type="button" className="text-sm text-white/45 hover:text-white" onClick={(e) => { e.preventDefault(); setFile(null); }}>Remove</button>
                  ) : (
                    <span className="pitch-row-action text-sm text-white/45">Add</span>
                  )}
                  <input type="file" className="hidden" accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.webp,.txt,.md" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
                </label>
                <label className="pitch-row cursor-pointer">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", explainerFile ? "bg-primary" : "bg-white/25")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-white">Attach explainer video</span>
                    <span className="block truncate text-xs text-white/40">{explainerFile ? explainerFile.name : "A recorded video"}</span>
                  </span>
                  {explainerFile ? (
                    <button type="button" className="text-sm text-white/45 hover:text-white" onClick={(e) => { e.preventDefault(); setExplainerFile(null); }}>Remove</button>
                  ) : (
                    <span className="pitch-row-action text-sm text-white/45">Add</span>
                  )}
                  <input type="file" className="hidden" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" onChange={(e) => handleExplainer(e.target.files?.[0] ?? null)} />
                </label>
                <label className="pitch-row">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-white/35" />
                  <input className="w-full bg-transparent text-[15px] text-white placeholder:text-white/35 focus:outline-none" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Video link" />
                </label>
                <label className="pitch-row">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-white/35" />
                  <input className="w-full bg-transparent text-[15px] text-white placeholder:text-white/35 focus:outline-none" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="Website" />
                </label>
              </section>
            </div>

            <div className="mt-10 flex flex-col gap-5 border-t border-white/10 pt-6">
              <CritiqueDial value={critiqueLevel} onChange={setCritiqueLevel} />
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <label className="flex max-w-xl items-start gap-3 text-sm leading-relaxed text-white/55">
                  <input
                    type="checkbox"
                    className="mt-1 accent-[hsl(192_92%_64%)]"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />
                  <span>Educational only. Not investment advice, and not a funding decision.</span>
                </label>
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
              </div>
              <p className="max-w-3xl text-xs leading-relaxed text-white/30">{DISCLAIMER}</p>
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
                <header className="mb-8">
                  <p className="text-xs uppercase tracking-[0.18em] text-primary">Read complete</p>
                  <h2 className="mt-2 text-4xl font-medium tracking-tight text-white">{companyName.trim() || "AI-pitch review"}</h2>
                </header>
                <ConvictionBlock verdict={verdict} confidence={confidence} />

                <div className="mt-10 grid items-start gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                  <div>
                    <div className="mb-2 flex items-baseline justify-between">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/35">Notes</p>
                      {noteDone && (
                        <button type="button" onClick={copyNote} className="text-sm text-white/45 hover:text-white">
                          {copied ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                    <div>
                      {memoBlocks.slice(0, blockIdx + 1).map((block, i) => {
                        if (block.kind === "para") paraCount += 1;
                        const label = memoBlockLabel(block, paraCount);
                        const isTyping = i === blockIdx;
                        const isQuestion = block.kind === "question";
                        return (
                          <div key={i} className="animate-thought-in border-b border-white/10 py-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-white/35">{label}</p>
                            {block.kind === "bullets" ? (
                              isTyping ? (
                                <RevealCount total={block.lines.length} onDone={() => setBlockIdx((n) => n + 1)}>
                                  {(visible) => (
                                    <ul className="mt-2 space-y-2">
                                      {block.lines.slice(0, visible).map((l, j) => (
                                        <li key={j} className="text-base leading-relaxed text-white/90">{l}</li>
                                      ))}
                                    </ul>
                                  )}
                                </RevealCount>
                              ) : (
                                <ul className="mt-2 space-y-2">
                                  {block.lines.map((l, j) => (
                                    <li key={j} className="text-base leading-relaxed text-white/90">{l}</li>
                                  ))}
                                </ul>
                              )
                            ) : (
                              <p className={cn("mt-2 leading-relaxed text-white/90", isQuestion ? "text-xl text-white" : "text-base")}>
                                {isTyping ? (
                                  <TypeText text={block.lines.join(" ")} onDone={() => setBlockIdx((n) => n + 1)} />
                                ) : (
                                  block.lines.join(" ")
                                )}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-10">
                    {artifacts.persuasion && <PersuasionMeter persuasion={artifacts.persuasion} />}
                    {artifacts.scores && <ScoreBars scores={artifacts.scores} />}
                    <EvidencePanel evidence={artifacts.evidence || []} />
                  </div>
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
