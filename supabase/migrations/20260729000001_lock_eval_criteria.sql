-- Lock Pitch Doctor eval criteria: agent (service role) + admins only — never public

ALTER TABLE public.investment_thesis
  ADD COLUMN IF NOT EXISTS eval_criteria_markdown TEXT;

-- Drop any public/anon read access to thesis & criteria
DROP POLICY IF EXISTS "Anyone can read active thesis" ON public.investment_thesis;
DROP POLICY IF EXISTS "Admins can read all thesis versions" ON public.investment_thesis;
DROP POLICY IF EXISTS "Admins can insert thesis" ON public.investment_thesis;
DROP POLICY IF EXISTS "Admins can update thesis" ON public.investment_thesis;

-- Admins manage via dashboard; service role bypasses RLS for Pitch Doctor agent
CREATE POLICY "Admins can read thesis" ON public.investment_thesis
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can insert thesis" ON public.investment_thesis
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update thesis" ON public.investment_thesis
  FOR UPDATE TO authenticated USING (public.is_admin());

COMMENT ON COLUMN public.investment_thesis.eval_criteria_markdown IS
  'Confidential VC eval rubric (markdown). Readable by service role (Pitch Doctor) and admins only.';
