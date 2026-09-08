-- ═══════════════════════════════════════════════════════════════════════════
-- גל 3 (P0-1) — מיגרציית אורח מול תקרת הרכבים
-- 2026-07-25 · מממש docs/spec-...-transfer.md ה-1 + edge-cases P0-1
--
-- הבעיה: אורח יכול לצבור רכבים ב-localStorage (עד ~20) ואז להירשם. ה-bootstrap
-- יוצר חשבון אישי עם cap=10, ולולאת המיגרציה מכניסה את הרכבים אחד-אחד. כשהאכיפה
-- תופעל, רכב מס' 11 ייחסם באמצע — האורח יאבד רכבים שכבר הזין.
--
-- ההכרעה (ה-1): "greatest(count,10) — החשבון האישי סופג על מה שהביא". שני RPC
-- קטנים שהקליינט עוטף בהם את לולאת המיגרציה:
--   • bump_personal_cap(account, headroom) — לפני הלולאה: מעלה זמנית את התקרה
--     כדי שכל האצווה תיכנס גם כשהאכיפה פעילה. חסום ל-25 (מיגרציית אורח ≤20),
--     כך שגם אם מישהו מנסה לנפח — התקרה בסוף נקבעת ע"י sync (ראו למטה).
--   • sync_personal_cap_to_count(account) — אחרי הלולאה: קובע
--     cap = greatest(actual_count, 10). זו הסמכות הסופית — ungameable, כי הוא
--     סופר רכבים אמיתיים. אורח שהביא 14 → cap=14 (קפוא). הביא 3 → cap=10.
--
-- שני ה-RPC no-op בשקט אם החשבון אינו אישי-בבעלות-הקורא (עסקי אין לו תקרה),
-- כך שהקליינט קורא להם ללא תנאי.
--
-- בטוח להריץ עכשיו (תקופת האכיפה-כבויה): bump מעלה, sync מתקן — התוצאה הסופית
-- היא בדיוק cap=greatest(count,10), שזה ממילא מה שהקוהורט אמור לקבל.
--
-- Idempotent. Reversible.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── bump — headroom זמני לפני הלולאה ──────────────────────────────────────
create or replace function public.bump_personal_cap(p_account_id uuid, p_headroom int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.accounts
     set vehicle_cap = greatest(
           coalesce(vehicle_cap, public.app_config_int('personal_vehicle_cap', 10)),
           (select count(*) from public.vehicles where account_id = p_account_id)
             + least(greatest(coalesce(p_headroom, 0), 0), 25)
         )
   where id            = p_account_id
     and owner_user_id = auth.uid()   -- רק החשבון של הקורא
     and type          = 'personal';  -- עסקי אין לו תקרה → no-op
end;
$$;

revoke all  on function public.bump_personal_cap(uuid, int) from public;
grant execute on function public.bump_personal_cap(uuid, int) to authenticated;


-- ── sync — הסמכות הסופית: cap = greatest(actual_count, 10) ─────────────────
create or replace function public.sync_personal_cap_to_count(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.accounts
     set vehicle_cap = greatest(
           (select count(*) from public.vehicles where account_id = p_account_id),
           public.app_config_int('personal_vehicle_cap', 10)
         )
   where id            = p_account_id
     and owner_user_id = auth.uid()
     and type          = 'personal';
end;
$$;

revoke all  on function public.sync_personal_cap_to_count(uuid) from public;
grant execute on function public.sync_personal_cap_to_count(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- אימות (אחרי החלה)
--   -- קורא עם 0 headroom על החשבון שלך — התקרה לא יורדת מתחת ל-count:
--   select public.sync_personal_cap_to_count('<your-personal-account-uuid>');
--   select vehicle_cap from public.accounts where id='<your-personal-account-uuid>';
--
-- ROLLBACK
--   drop function if exists public.bump_personal_cap(uuid, int);
--   drop function if exists public.sync_personal_cap_to_count(uuid);
-- ═══════════════════════════════════════════════════════════════════════════
