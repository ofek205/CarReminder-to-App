-- ==========================================================================
-- Base44 Migration Phase 3-7 — repair entities + storage bucket
--
-- Clean-slate version: drops any pre-existing repair tables (left over from
-- an earlier partial schema) and recreates them with the correct columns
-- the migrated frontend expects.
--
-- Used by (after migration):
--   • RepairTypes.jsx                (CRUD on repair_types)
--   • RepairsSection.jsx             (repair_logs + attachments + accidents)
--   • AddRepairDialog.jsx            (same)
--   • VesselScanWizard.jsx           (UploadFile → storage)
--   • DriverLicenseScanDialog.jsx    (UploadFile → storage)
--
-- Safe to re-run: DROP TABLE ... IF EXISTS CASCADE wipes stale schemas
-- before rebuilding. Only run this if there's no production repair data
-- you need to keep.
-- ==========================================================================


-- ──────────────────────────────────────────────────────────────────────────
-- 0. Clean slate — drop any prior versions of these tables.
--     CASCADE handles dependent FKs / views / policies automatically.
-- ──────────────────────────────────────────────────────────────────────────
drop table if exists public.accident_details   cascade;
drop table if exists public.repair_attachments cascade;
drop table if exists public.repair_logs        cascade;
drop table if exists public.repair_types       cascade;


-- ──────────────────────────────────────────────────────────────────────────
-- 1. repair_types
--     Per-user catalog of repair categories (פחחות, מזגן, החלפת חלון …).
--     scope='user' + owner_user_id means each user has their own list.
--     'system' scope reserved for future shared defaults.
-- ──────────────────────────────────────────────────────────────────────────
create table public.repair_types (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  scope         text not null default 'user',          -- 'user' | 'system'
  owner_user_id uuid references auth.users(id) on delete cascade,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index repair_types_owner_active_idx
  on public.repair_types(owner_user_id, is_active);

alter table public.repair_types enable row level security;

create policy repair_types_select on public.repair_types
  for select using (
    scope = 'system' or owner_user_id = auth.uid()
  );

create policy repair_types_insert on public.repair_types
  for insert with check (
    owner_user_id = auth.uid() and scope = 'user'
  );

create policy repair_types_update on public.repair_types
  for update using (owner_user_id = auth.uid());

create policy repair_types_delete on public.repair_types
  for delete using (owner_user_id = auth.uid());


-- ──────────────────────────────────────────────────────────────────────────
-- 2. repair_logs
--     One row per repair event on a specific vehicle.
--     account_id is denormalized from vehicles so RLS can scope by
--     account_members without a join (matches vessel_issues pattern).
-- ──────────────────────────────────────────────────────────────────────────
create table public.repair_logs (
  id                   uuid primary key default gen_random_uuid(),
  vehicle_id           uuid not null references public.vehicles(id) on delete cascade,
  account_id           uuid not null references public.accounts(id) on delete cascade,
  repair_type_id       uuid references public.repair_types(id) on delete set null,

  title                text not null,
  occurred_at          date not null,
  repaired_at          date,
  description          text,

  -- Free text but UI offers 'אני' | 'מוסך'
  repaired_by          text default 'אני',
  garage_name          text,
  cost                 numeric(12,2),

  is_accident          boolean not null default false,
  created_by_user_id   uuid references auth.users(id) on delete set null,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index repair_logs_vehicle_idx
  on public.repair_logs(vehicle_id, occurred_at desc);

create index repair_logs_account_idx
  on public.repair_logs(account_id, occurred_at desc);

alter table public.repair_logs enable row level security;

create policy repair_logs_select on public.repair_logs
  for select using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

create policy repair_logs_insert on public.repair_logs
  for insert with check (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

create policy repair_logs_update on public.repair_logs
  for update using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

create policy repair_logs_delete on public.repair_logs
  for delete using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );


-- ──────────────────────────────────────────────────────────────────────────
-- 3. repair_attachments
--     Files (photos, invoices) linked to a repair_log.
--     file_url points at a Supabase Storage signed URL (vehicle-files bucket).
--     ON DELETE CASCADE means attachments disappear when the parent log does —
--     removes the 3-call cleanup the Base44 code did manually.
-- ──────────────────────────────────────────────────────────────────────────
create table public.repair_attachments (
  id             uuid primary key default gen_random_uuid(),
  repair_log_id  uuid not null references public.repair_logs(id) on delete cascade,
  file_url       text not null,
  file_type      text,                                   -- 'חשבונית' | 'תמונה' | 'אחר' ...
  storage_path   text,                                   -- path inside vehicle-files bucket (for cleanup)
  created_at     timestamptz not null default now()
);

create index repair_attachments_log_idx
  on public.repair_attachments(repair_log_id);

alter table public.repair_attachments enable row level security;

create policy repair_attachments_select on public.repair_attachments
  for select using (
    repair_log_id in (
      select id from public.repair_logs
      where account_id in (select account_id from public.account_members where user_id = auth.uid())
    )
  );

create policy repair_attachments_insert on public.repair_attachments
  for insert with check (
    repair_log_id in (
      select id from public.repair_logs
      where account_id in (select account_id from public.account_members where user_id = auth.uid())
    )
  );

create policy repair_attachments_delete on public.repair_attachments
  for delete using (
    repair_log_id in (
      select id from public.repair_logs
      where account_id in (select account_id from public.account_members where user_id = auth.uid())
    )
  );


-- ──────────────────────────────────────────────────────────────────────────
-- 4. accident_details
--     Extra metadata when repair_log.is_accident = true.
--     UNIQUE on repair_log_id enforces "at most one accident record per log".
-- ──────────────────────────────────────────────────────────────────────────
create table public.accident_details (
  id                           uuid primary key default gen_random_uuid(),
  repair_log_id                uuid not null unique references public.repair_logs(id) on delete cascade,
  other_driver_name            text,
  other_driver_phone           text,
  other_driver_license_plate   text,
  insurance_claim_number       text,
  notes                        text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

alter table public.accident_details enable row level security;

create policy accident_details_select on public.accident_details
  for select using (
    repair_log_id in (
      select id from public.repair_logs
      where account_id in (select account_id from public.account_members where user_id = auth.uid())
    )
  );

create policy accident_details_insert on public.accident_details
  for insert with check (
    repair_log_id in (
      select id from public.repair_logs
      where account_id in (select account_id from public.account_members where user_id = auth.uid())
    )
  );

create policy accident_details_update on public.accident_details
  for update using (
    repair_log_id in (
      select id from public.repair_logs
      where account_id in (select account_id from public.account_members where user_id = auth.uid())
    )
  );

create policy accident_details_delete on public.accident_details
  for delete using (
    repair_log_id in (
      select id from public.repair_logs
      where account_id in (select account_id from public.account_members where user_id = auth.uid())
    )
  );


-- ──────────────────────────────────────────────────────────────────────────
-- 5. updated_at triggers (shared helper pattern used by other tables)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger repair_types_touch_tg
  before update on public.repair_types
  for each row execute function public.touch_updated_at();

create trigger repair_logs_touch_tg
  before update on public.repair_logs
  for each row execute function public.touch_updated_at();

create trigger accident_details_touch_tg
  before update on public.accident_details
  for each row execute function public.touch_updated_at();


-- ──────────────────────────────────────────────────────────────────────────
-- 6. Storage bucket: vehicle-files
--     Private bucket for anything the user uploads against a vehicle —
--     repair receipts, vessel scan images, driver-license scans.
--
--     Path convention: {account_id}/{vehicle_id}/{uuid}-{safe_filename}
--       for repair attachments.
--     Path convention: scans/{user_id}/{uuid}-{safe_filename}
--       for license/vessel scan source images (no vehicle yet).
-- ──────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('vehicle-files', 'vehicle-files', false)
on conflict (id) do nothing;

drop policy if exists vehicle_files_select on storage.objects;
drop policy if exists vehicle_files_insert on storage.objects;
drop policy if exists vehicle_files_update on storage.objects;
drop policy if exists vehicle_files_delete on storage.objects;

create policy vehicle_files_select on storage.objects
  for select using (
    bucket_id = 'vehicle-files'
    and (
      (storage.foldername(name))[1] in (
        select account_id::text from public.account_members where user_id = auth.uid()
      )
      or (
        (storage.foldername(name))[1] = 'scans'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

create policy vehicle_files_insert on storage.objects
  for insert with check (
    bucket_id = 'vehicle-files'
    and (
      (storage.foldername(name))[1] in (
        select account_id::text from public.account_members where user_id = auth.uid()
      )
      or (
        (storage.foldername(name))[1] = 'scans'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

create policy vehicle_files_update on storage.objects
  for update using (
    bucket_id = 'vehicle-files'
    and (
      (storage.foldername(name))[1] in (
        select account_id::text from public.account_members where user_id = auth.uid()
      )
      or (
        (storage.foldername(name))[1] = 'scans'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

create policy vehicle_files_delete on storage.objects
  for delete using (
    bucket_id = 'vehicle-files'
    and (
      (storage.foldername(name))[1] in (
        select account_id::text from public.account_members where user_id = auth.uid()
      )
      or (
        (storage.foldername(name))[1] = 'scans'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );
