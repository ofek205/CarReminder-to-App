-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-user-notes.sql — CRM notes per user
--
-- Allows the admin to attach free-text notes to any user. Notes are
-- visible only to admins, stored as one row per user (upsert pattern).
--
-- Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_user_notes (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.admin_user_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_notes_select ON public.admin_user_notes
  FOR SELECT USING (public.is_admin());
CREATE POLICY admin_notes_insert ON public.admin_user_notes
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY admin_notes_update ON public.admin_user_notes
  FOR UPDATE USING (public.is_admin());


-- Upsert RPC — creates or updates the admin note for a user.
DROP FUNCTION IF EXISTS public.admin_set_user_note(uuid, text);

CREATE FUNCTION public.admin_set_user_note(p_user_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.admin_user_notes (user_id, note, updated_at, updated_by)
  VALUES (p_user_id, COALESCE(p_note, ''), now(), auth.uid())
  ON CONFLICT (user_id)
  DO UPDATE SET note = COALESCE(p_note, ''),
                updated_at = now(),
                updated_by = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_note(uuid, text) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST:
--   SELECT admin_set_user_note('<some-user-uuid>', 'לקוח VIP, לטפל מהר');
--   SELECT * FROM admin_user_notes;
-- ═══════════════════════════════════════════════════════════════════════════
