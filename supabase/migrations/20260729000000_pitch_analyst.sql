-- BoldBets Analyst (educational pitch review) — idempotent migration

-- ── Role helpers (create if missing from older projects) ─────────────────────
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin(uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid AND role = 'admin'::public.app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE public.pitch_verdict AS ENUM ('HOT', 'WARM', 'PASS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.pitch_status AS ENUM ('submitted', 'reviewing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Thesis ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.investment_thesis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL DEFAULT 'BoldBets Investment Thesis',
  thesis_markdown TEXT NOT NULL,
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  eval_criteria_markdown TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS investment_thesis_one_active
  ON public.investment_thesis (is_active) WHERE is_active = true;
ALTER TABLE public.investment_thesis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read thesis" ON public.investment_thesis;
DROP POLICY IF EXISTS "Admins can read all thesis versions" ON public.investment_thesis;
DROP POLICY IF EXISTS "Admins can insert thesis" ON public.investment_thesis;
DROP POLICY IF EXISTS "Admins can update thesis" ON public.investment_thesis;
DROP POLICY IF EXISTS "Anyone can read active thesis" ON public.investment_thesis;

-- Admins only (Pitch Doctor agent uses service role — bypasses RLS)
CREATE POLICY "Admins can read thesis" ON public.investment_thesis
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can insert thesis" ON public.investment_thesis
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update thesis" ON public.investment_thesis
  FOR UPDATE TO authenticated USING (public.is_admin());

-- ── Pitches ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  founder_name TEXT NOT NULL,
  founder_email TEXT NOT NULL,
  company_name TEXT NOT NULL,
  one_liner TEXT NOT NULL,
  website_url TEXT,
  pitch_narrative TEXT NOT NULL,
  material_type TEXT CHECK (material_type IN ('deck', 'video', 'explainer', 'mixed')),
  file_path TEXT,
  file_name TEXT,
  file_mime TEXT,
  video_url TEXT,
  status public.pitch_status NOT NULL DEFAULT 'submitted',
  progress JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  verdict public.pitch_verdict,
  founder_feedback TEXT,
  confidence NUMERIC(4,3),
  educational_disclaimer TEXT NOT NULL DEFAULT
    'This AI pitch review is for educational purposes only. It is not investment advice, an offer to invest, a solicitation, or a commitment of capital. BoldBets does not make funding decisions through this tool.',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pitches_status_idx ON public.pitches (status);
CREATE INDEX IF NOT EXISTS pitches_created_at_idx ON public.pitches (created_at DESC);
ALTER TABLE public.pitches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit a pitch" ON public.pitches;
DROP POLICY IF EXISTS "Admins can read all pitches" ON public.pitches;
DROP POLICY IF EXISTS "Admins can update pitches" ON public.pitches;

CREATE POLICY "Anyone can submit a pitch" ON public.pitches
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Admins can read all pitches" ON public.pitches
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can update pitches" ON public.pitches
  FOR UPDATE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.submit_pitch(
  p_founder_name TEXT,
  p_founder_email TEXT,
  p_company_name TEXT,
  p_one_liner TEXT,
  p_pitch_narrative TEXT,
  p_website_url TEXT DEFAULT NULL,
  p_video_url TEXT DEFAULT NULL,
  p_material_type TEXT DEFAULT 'explainer',
  p_file_path TEXT DEFAULT NULL,
  p_file_name TEXT DEFAULT NULL,
  p_file_mime TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.pitches%ROWTYPE;
BEGIN
  INSERT INTO public.pitches (
    founder_name, founder_email, company_name, one_liner, pitch_narrative,
    website_url, video_url, material_type, file_path, file_name, file_mime
  ) VALUES (
    p_founder_name, p_founder_email, p_company_name, p_one_liner, p_pitch_narrative,
    NULLIF(p_website_url, ''), NULLIF(p_video_url, ''), COALESCE(p_material_type, 'explainer'),
    p_file_path, p_file_name, p_file_mime
  ) RETURNING * INTO r;
  RETURN jsonb_build_object('id', r.id, 'access_token', r.access_token);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_pitch TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_pitch_status(p_id UUID, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'id', id, 'status', status, 'progress', progress, 'verdict', verdict,
      'founder_feedback', founder_feedback, 'confidence', confidence,
      'error_message', error_message, 'educational_disclaimer', educational_disclaimer,
      'company_name', company_name
    )
    FROM public.pitches WHERE id = p_id AND access_token = p_token
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_pitch_status TO anon, authenticated;

-- ── Reviews / corrections / memory ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pitch_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL UNIQUE REFERENCES public.pitches(id) ON DELETE CASCADE,
  thesis_id UUID REFERENCES public.investment_thesis(id) ON DELETE SET NULL,
  verdict public.pitch_verdict NOT NULL,
  confidence NUMERIC(4,3),
  founder_feedback TEXT NOT NULL,
  thesis_fit_summary TEXT,
  bull_case TEXT,
  bear_case TEXT,
  claim_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  red_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  comps JSONB NOT NULL DEFAULT '[]'::jsonb,
  internal_memo TEXT NOT NULL,
  agent_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.pitch_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read reviews" ON public.pitch_reviews;
DROP POLICY IF EXISTS "Admins can update reviews" ON public.pitch_reviews;
CREATE POLICY "Admins can read reviews" ON public.pitch_reviews
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can update reviews" ON public.pitch_reviews
  FOR UPDATE TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.pitch_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES public.pitches(id) ON DELETE CASCADE,
  review_id UUID REFERENCES public.pitch_reviews(id) ON DELETE SET NULL,
  previous_verdict public.pitch_verdict NOT NULL,
  corrected_verdict public.pitch_verdict NOT NULL,
  debrief TEXT NOT NULL,
  criteria_updates JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.pitch_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage corrections" ON public.pitch_corrections;
CREATE POLICY "Admins manage corrections" ON public.pitch_corrections
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('lesson', 'thesis_nuance', 'red_flag_pattern', 'sector_note', 'correction')),
  content TEXT NOT NULL,
  source_pitch_id UUID REFERENCES public.pitches(id) ON DELETE SET NULL,
  source_correction_id UUID REFERENCES public.pitch_corrections(id) ON DELETE SET NULL,
  weight NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_memory_active_idx ON public.agent_memory (is_active, weight DESC);
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage agent memory" ON public.agent_memory;
CREATE POLICY "Admins manage agent memory" ON public.agent_memory
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── Storage ─────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pitch-materials', 'pitch-materials', false, 52428800,
  ARRAY[
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/markdown',
    'video/mp4', 'video/webm', 'video/quicktime',
    'image/png', 'image/jpeg', 'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can upload pitch materials" ON storage.objects;
DROP POLICY IF EXISTS "Admins can read pitch materials" ON storage.objects;
DROP POLICY IF EXISTS "Service and owners path readable via signed URLs" ON storage.objects;

CREATE POLICY "Anyone can upload pitch materials" ON storage.objects
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'pitch-materials');
CREATE POLICY "Admins can read pitch materials" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'pitch-materials' AND public.is_admin());
CREATE POLICY "Service and owners path readable via signed URLs" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'pitch-materials');

-- ── Seeds (only if empty) ───────────────────────────────────────────────────
INSERT INTO public.investment_thesis (version, is_active, title, thesis_markdown, criteria, notes)
SELECT 1, true,
  'BoldBets Investment Thesis (draft — replace me)',
  E'# BoldBets Thesis (placeholder)\n\nWe back founders taking **big bold bets** on the future across:\n- **AI**\n- **Consumer health-tech**\n- **Sustainable food systems**\n\nEdit this in Admin with your real thesis.',
  '[
    {"id":"team","label":"Team & insight","weight":25,"description":"Founder-market fit, clarity of insight, execution signals"},
    {"id":"problem","label":"Problem intensity","weight":15,"description":"Pain is real, frequent, and expensive enough to pay for"},
    {"id":"solution","label":"Solution leverage","weight":20,"description":"Why this approach wins; AI or product leverage vs status quo"},
    {"id":"market","label":"Market & timing","weight":15,"description":"TAM realism, wedge, why now"},
    {"id":"moat","label":"Defensibility","weight":10,"description":"Data, distribution, brand, or technical edge"},
    {"id":"traction","label":"Traction honesty","weight":15,"description":"Evidence quality; claims that survive verification"}
  ]'::jsonb,
  'Replace with final BoldBets thesis and criteria.'
WHERE NOT EXISTS (SELECT 1 FROM public.investment_thesis WHERE is_active = true);

INSERT INTO public.agent_memory (kind, content, weight)
SELECT * FROM (VALUES
  ('lesson'::text, 'Prefer evidence over narrative. Unverified TAM claims and vanity metrics are yellow flags unless triangulated.'::text, 1.2::numeric),
  ('thesis_nuance'::text, 'BoldBets is AI-first but not AI-washing: use AI where it creates durable leverage, not as a buzzword.'::text, 1.5::numeric)
) AS v(kind, content, weight)
WHERE NOT EXISTS (SELECT 1 FROM public.agent_memory LIMIT 1);
