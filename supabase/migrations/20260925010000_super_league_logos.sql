-- Logo icon for Super League marks. Public so the landscape can render it.
-- Safe to run after the original super_league migration.

ALTER TABLE public.super_league
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'super-league-logos',
  'super-league-logos',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Anyone can upload a league logo" ON storage.objects;
CREATE POLICY "Anyone can upload a league logo"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'super-league-logos');

DROP POLICY IF EXISTS "Anyone can read league logos" ON storage.objects;
CREATE POLICY "Anyone can read league logos"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'super-league-logos');

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
