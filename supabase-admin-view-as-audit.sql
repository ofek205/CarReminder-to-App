-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-view-as-audit.sql — per-edit audit during view-as
--
-- Logs EVERY write an admin makes while a view session is active (which table,
-- which row, which op) to admin_audit_log — so we record not just "admin
-- entered account X" but "admin edited vehicle Y / added document Z". Closes
-- the governance gap where only session start/end were logged.
--
-- Mechanism: an AFTER trigger on the write-enabled tables. It fires for every
-- write but does nothing unless public.is_viewing(account_id) is true (i.e. the
-- writer is an admin inside an active view session) — so normal user writes are
-- untouched beyond one cheap indexed EXISTS check.
--
-- DEPENDS ON: public.is_viewing(uuid), public.admin_log(...). Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.log_view_as_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  v_account := coalesce(NEW.account_id, OLD.account_id);
  if v_account is not null and public.is_viewing(v_account) then
    perform public.admin_log(
      'view_edit',
      TG_TABLE_NAME,
      coalesce(NEW.id, OLD.id)::text,
      jsonb_build_object('op', TG_OP, 'account_id', v_account)
    );
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_log_view_as_write on public.vehicles;
create trigger trg_log_view_as_write
  after insert or update or delete on public.vehicles
  for each row execute function public.log_view_as_write();

drop trigger if exists trg_log_view_as_write on public.documents;
create trigger trg_log_view_as_write
  after insert or update or delete on public.documents
  for each row execute function public.log_view_as_write();

-- ═══════════════════════════════════════════════════════════════════════════
-- After an admin edits a vehicle/document in view-as, verify:
--   select action, target_type, target_id, detail, created_at
--   from public.admin_audit_log where action='view_edit'
--   order by created_at desc limit 10;
-- ═══════════════════════════════════════════════════════════════════════════
