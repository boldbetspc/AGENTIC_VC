import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// ── OpenAI helpers ───────────────────────────────────────────────────────────

function lightModel(): string {
  return Deno.env.get("OPENAI_MODEL_LIGHT") || "gpt-4o-mini";
}

async function callOpenAI(opts: {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature ?? 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${errText.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "{}";
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`Model returned invalid JSON (${raw.slice(0, 120)}…)`);
  }
}

async function embed(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_EMBED_MODEL") || "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vec = data.data?.[0]?.embedding;
    return Array.isArray(vec) ? (vec as number[]) : null;
  } catch {
    return null;
  }
}

/** pgvector literal for insert params. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);

    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!role) return json({ error: "Admin only" }, 403);

    const body = await req.json();
    const { pitch_id, corrected_verdict, debrief, criteria_updates } = body as {
      pitch_id: string;
      corrected_verdict: "HOT" | "WARM" | "PASS";
      debrief: string;
      criteria_updates?: unknown;
    };

    if (!pitch_id || !corrected_verdict || !debrief?.trim()) {
      return json({ error: "pitch_id, corrected_verdict, and debrief are required" }, 400);
    }
    if (!["HOT", "WARM", "PASS"].includes(corrected_verdict)) {
      return json({ error: "Invalid verdict" }, 400);
    }

    const { data: pitch } = await admin.from("pitches").select("*").eq("id", pitch_id).maybeSingle();
    if (!pitch) return json({ error: "Pitch not found" }, 404);
    if (!pitch.verdict) return json({ error: "Pitch has no verdict to correct yet" }, 400);

    const { data: review } = await admin
      .from("pitch_reviews")
      .select("*")
      .eq("pitch_id", pitch_id)
      .maybeSingle();

    const { data: correction, error: corrError } = await admin
      .from("pitch_corrections")
      .insert({
        pitch_id,
        review_id: review?.id ?? null,
        previous_verdict: pitch.verdict,
        corrected_verdict,
        debrief: debrief.trim(),
        criteria_updates: criteria_updates ?? null,
        created_by: userData.user.id,
      })
      .select("*")
      .single();

    if (corrError) throw corrError;

    await admin
      .from("pitches")
      .update({
        verdict: corrected_verdict,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pitch_id);

    if (review) {
      await admin
        .from("pitch_reviews")
        .update({
          verdict: corrected_verdict,
          internal_memo: `${review.internal_memo}\n\n## Operator correction\nPrevious: ${pitch.verdict} → ${corrected_verdict}\nDebrief: ${debrief.trim()}`,
        })
        .eq("id", review.id);
    }

    // Self-learning v2: distill the correction into a STRUCTURED, EMBEDDED rule
    // the engine retrieves by similarity on future pitches like this one.
    let structured: { rule: string; sector: string; mistake_type: string } = {
      rule: debrief.trim().slice(0, 400),
      sector: "unknown",
      mistake_type: "judgment",
    };
    try {
      const distillRaw = await callOpenAI({
        model: lightModel(),
        system: `You distill a startup-review verdict correction into a reusable judgment rule for future reviews.
Return JSON: {"rule":"one imperative sentence the reviewer should apply next time (generalized, not company-specific)","sector":"short sector label","mistake_type":"overweighted_hype|missed_signal|evidence_misread|thesis_misfit|scoring_error|other"}`,
        user: `Company: ${pitch.company_name}\nOne-liner: ${pitch.one_liner}\nVerdict corrected: ${pitch.verdict} → ${corrected_verdict}\nOperator debrief: ${debrief.trim().slice(0, 1200)}`,
        temperature: 0.2,
        maxTokens: 200,
      });
      const d = parseJson<typeof structured>(distillRaw);
      if (d.rule) structured = { rule: d.rule, sector: d.sector || "unknown", mistake_type: d.mistake_type || "other" };
    } catch (e) {
      console.error("correction distill failed", e);
    }

    const memoryContent = `Correction (${pitch.verdict}→${corrected_verdict}, ${structured.sector}): ${structured.rule} | Case: ${pitch.company_name} — ${pitch.one_liner}. Debrief: ${debrief.trim().slice(0, 400)}`;
    const memVec = await embed(`${pitch.one_liner} ${structured.sector} ${structured.rule}`);
    await admin.from("agent_memory").insert({
      kind: "correction",
      content: memoryContent,
      source_pitch_id: pitch_id,
      source_correction_id: correction.id,
      weight: 2.0,
      meta: {
        sector: structured.sector,
        mistake_type: structured.mistake_type,
        previous_verdict: pitch.verdict,
        corrected_verdict,
      },
      ...(memVec ? { embedding: toVectorLiteral(memVec) } : {}),
    });

    // Optional: apply criteria_updates onto active thesis
    if (criteria_updates) {
      const { data: thesis } = await admin
        .from("investment_thesis")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();
      if (thesis) {
        await admin
          .from("investment_thesis")
          .update({
            criteria: criteria_updates,
            notes: `${thesis.notes || ""}\n\n[Correction ${new Date().toISOString()}] ${debrief.trim().slice(0, 200)}`,
            updated_at: new Date().toISOString(),
            updated_by: userData.user.id,
          })
          .eq("id", thesis.id);

        const nuanceContent = `Criteria refined after ${pitch.company_name} correction: ${debrief.trim().slice(0, 400)}`;
        const nuanceVec = await embed(nuanceContent);
        await admin.from("agent_memory").insert({
          kind: "thesis_nuance",
          content: nuanceContent,
          source_pitch_id: pitch_id,
          source_correction_id: correction.id,
          weight: 1.8,
          ...(nuanceVec ? { embedding: toVectorLiteral(nuanceVec) } : {}),
        });
      }
    }

    return json({
      ok: true,
      correction,
      message: "Verdict corrected. Agent memory updated for future reviews.",
      educational_note:
        "Corrections improve educational judgment only — they are not investment decisions or proposals.",
    });
  } catch (error) {
    console.error("correct-pitch error", error);
    return json({ error: error instanceof Error ? error.message : "Correction failed" }, 500);
  }
});
