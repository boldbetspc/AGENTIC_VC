-- Super League: one public landscape record per startup.
-- Founders opt in after a review. A second join for the same company is rejected.

CREATE TABLE IF NOT EXISTS public.super_league (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_key TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  theme TEXT NOT NULL,
  subtheme TEXT NOT NULL,
  advantage TEXT NOT NULL,
  founder_names TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  revenue TEXT NOT NULL CHECK (revenue IN ('pre_revenue', 'generating')),
  logo_url TEXT,
  pitch_id UUID REFERENCES public.pitches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS super_league_theme_idx ON public.super_league (theme);
CREATE INDEX IF NOT EXISTS super_league_stage_idx ON public.super_league (stage);
CREATE INDEX IF NOT EXISTS super_league_country_idx ON public.super_league (country);

ALTER TABLE public.super_league ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read super league" ON public.super_league;
CREATE POLICY "Anyone can read super league"
  ON public.super_league FOR SELECT
  TO anon, authenticated
  USING (true);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'join_super_league'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.join_super_league(
  p_company_name TEXT,
  p_stage TEXT,
  p_theme TEXT,
  p_subtheme TEXT,
  p_advantage TEXT,
  p_founder_names TEXT,
  p_country TEXT,
  p_city TEXT,
  p_revenue TEXT,
  p_logo_url TEXT DEFAULT NULL,
  p_pitch_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT := lower(regexp_replace(btrim(p_company_name), '\s+', ' ', 'g'));
  v_id UUID;
BEGIN
  IF v_key = '' OR btrim(p_subtheme) = '' OR btrim(p_advantage) = ''
     OR btrim(p_founder_names) = '' OR btrim(p_country) = '' OR btrim(p_city) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  IF p_revenue NOT IN ('pre_revenue', 'generating') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_revenue');
  END IF;

  IF char_length(btrim(p_advantage)) > 180 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'advantage_too_long');
  END IF;

  IF btrim(COALESCE(p_logo_url, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_logo');
  END IF;

  IF EXISTS (SELECT 1 FROM public.super_league WHERE company_key = v_key) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_listed');
  END IF;

  INSERT INTO public.super_league (
    company_key, company_name, stage, theme, subtheme, advantage,
    founder_names, country, city, revenue, logo_url, pitch_id
  ) VALUES (
    v_key,
    btrim(p_company_name),
    btrim(p_stage),
    btrim(p_theme),
    btrim(p_subtheme),
    btrim(p_advantage),
    btrim(p_founder_names),
    btrim(p_country),
    btrim(p_city),
    p_revenue,
    btrim(p_logo_url),
    p_pitch_id
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_listed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_super_league(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) TO anon, authenticated;
