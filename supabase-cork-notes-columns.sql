-- ==========================================================================
-- cork_notes — add missing columns used by CorkBoard and the checklist
-- issue flow. Historically inherited from Base44 with a smaller set of
-- columns; the UI has since evolved. All ADD COLUMN IF NOT EXISTS so
-- this is safe to re-run.
-- ==========================================================================

alter table public.cork_notes add column if not exists title      text;
alter table public.cork_notes add column if not exists content    text;
alter table public.cork_notes add column if not exists color      text default 'yellow';
alter table public.cork_notes add column if not exists category   text;
alter table public.cork_notes add column if not exists priority   text default 'medium';
alter table public.cork_notes add column if not exists due_date   timestamptz;
alter table public.cork_notes add column if not exists is_done    boolean default false;
alter table public.cork_notes add column if not exists rotation   numeric default 0;

-- Touch trigger — keep updated_at fresh on edits.
alter table public.cork_notes add column if not exists updated_at timestamptz default now();

create or replace function public.cork_notes_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cork_notes_touch_tg on public.cork_notes;
create trigger cork_notes_touch_tg
  before update on public.cork_notes
  for each row execute function public.cork_notes_touch();
