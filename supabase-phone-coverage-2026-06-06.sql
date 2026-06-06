-- ═══════════════════════════════════════════════════════════════════════════
-- Admin analytics — phone-number coverage — 2026-06-06
-- ═══════════════════════════════════════════════════════════════════════════
-- "How many users have a phone number on file, and how many don't."
-- A user = a personal account (same population as the vehicle-count chart, so
-- the two analytics widgets are comparable). The phone lives on user_profiles
-- keyed by user_id; we LEFT JOIN so a personal account with no profile row (or
-- a blank phone) is counted as "without phone".
--
-- Admin-gated, SECURITY DEFINER, purely additive (new function only).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_phone_coverage()
RETURNS TABLE(with_phone bigint, without_phone bigint, total bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  with users as (
    select a.owner_user_id as uid
    from public.accounts a
    where a.type = 'personal'
  )
  select
    count(*) filter (where p.phone is not null and btrim(p.phone) <> '')::bigint as with_phone,
    count(*) filter (where p.phone is null or btrim(p.phone) = '')::bigint     as without_phone,
    count(*)::bigint                                                            as total
  from users u
  left join public.user_profiles p on p.user_id = u.uid;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_phone_coverage() TO authenticated;

-- Verify:
--   SELECT * FROM public.admin_phone_coverage();
