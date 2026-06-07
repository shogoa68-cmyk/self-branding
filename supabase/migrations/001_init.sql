-- ─── profiles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  age           TEXT NOT NULL DEFAULT '',
  gender        TEXT NOT NULL DEFAULT '',
  profession    TEXT NOT NULL DEFAULT '',
  career        TEXT NOT NULL DEFAULT '',
  skills        TEXT NOT NULL DEFAULT '',
  hobbies       TEXT NOT NULL DEFAULT '',
  target_role   TEXT NOT NULL DEFAULT '',
  target_goals  TEXT NOT NULL DEFAULT '',
  timeline      TEXT NOT NULL DEFAULT '',
  motivation    TEXT NOT NULL DEFAULT '',
  checklist     JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_profile" ON public.profiles
  FOR ALL TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ─── daily_logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date               DATE NOT NULL DEFAULT CURRENT_DATE,
  content            JSONB NOT NULL DEFAULT '{}',
  completed_actions  TEXT[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_logs" ON public.daily_logs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
