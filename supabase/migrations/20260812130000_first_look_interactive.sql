-- ── AI First Look v2.1 — interactive review ─────────────────────────────────
-- 1. 'needs_input' status: the engine can pause mid-review and ask the founder
--    up to two factual clarifying questions before finishing the read.
-- 2. review_state: service-role-only scratch space holding the intermediate
--    brief/evidence so the review resumes without re-running early stages.
--    It is intentionally NOT exposed through get_pitch_status.
-- Educational only: no investment decision or offer is made at any point.

ALTER TYPE public.pitch_status ADD VALUE IF NOT EXISTS 'needs_input';

ALTER TABLE public.pitches
  ADD COLUMN IF NOT EXISTS review_state JSONB;
