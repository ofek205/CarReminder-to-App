-- ==========================================================================
-- Vehicle-shares UX polish — three fixes the user reported after testing:
--
--   1. JoinInvite success message lacks the inviter name + vehicle name —
--      reads "השיתוף אושר! הרכב התווסף" with no context. Update
--      accept_vehicle_share RPC to also return vehicle_label and
--      inviter_name so the page can render a meaningful message.
--
--   2. my_vehicles_v needs share_count on the owned-rows side so the
--      Dashboard card can show "שותף עם N" badge for the owner.
--
-- (The "access denied for sharee" issue is fixed in VehicleDetail.jsx
-- by switching the vehicle query to my_vehicles_v — no SQL change.)
--
-- Idempotent.
-- ==========================================================================

-- Extend the view: owned rows now expose share_count (accepted shares
-- on this vehicle). Recipient rows show 0 since they shouldn't see the
-- owner's full sharee list.
create or replace view public.my_vehicles_v as
  select v.*,
         false as is_shared_with_me,
         null::uuid as share_id,
         null::text as share_role,
         null::uuid as share_owner_user_id,
         (
           select count(*)::int
             from public.vehicle_shares s
            where s.vehicle_id = v.id
              and s.status = 'accepted'
         ) as share_count
    from public.vehicles v
   where v.account_id in (
     select account_id from public.account_members
      where user_id = auth.uid() and status = 'פעיל'
   )
  union all
  select v.*,
         true as is_shared_with_me,
         s.id as share_id,
         s.role as share_role,
         s.owner_user_id as share_owner_user_id,
         0 as share_count
    from public.vehicles v
    join public.vehicle_shares s on s.vehicle_id = v.id
   where s.shared_with_user_id = auth.uid()
     and s.status = 'accepted';

grant select on public.my_vehicles_v to authenticated;


-- accept_vehicle_share — return vehicle_label + inviter_name so the
-- JoinInvite page can render a personalized success message.
create or replace function public.accept_vehicle_share(p_share_id uuid default null, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_acceptor_name text;
  v_vehicle_label text;
  v_inviter_name text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_share_id is not null then
    select * into s from public.vehicle_shares where id = p_share_id for update;
  elsif p_token is not null then
    select * into s from public.vehicle_shares where invite_token = p_token for update;
  else
    raise exception 'missing_share_id_or_token';
  end if;

  if not found then raise exception 'share_not_found'; end if;
  if s.status <> 'pending' then raise exception 'share_not_pending'; end if;
  if not exists (select 1 from auth.users where id = uid and lower(email) = lower(s.shared_with_email)) then
    raise exception 'share_email_mismatch';
  end if;
  if s.expires_at < now() then
    update public.vehicle_shares set status = 'expired' where id = s.id;
    raise exception 'share_expired';
  end if;

  perform pg_advisory_xact_lock(hashtext(s.vehicle_id::text));

  update public.vehicle_shares
     set status = 'accepted', accepted_at = now(), shared_with_user_id = uid
   where id = s.id;

  -- Resolve labels for both the notification body AND the return value.
  select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב')
    into v_vehicle_label
    from public.vehicles where id = s.vehicle_id;

  select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
    into v_inviter_name
    from auth.users where id = s.owner_user_id;

  -- Owner notification (best-effort).
  begin
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_acceptor_name
      from auth.users where id = uid;
    insert into public.app_notifications (user_id, type, title, body, data) values (
      s.owner_user_id, 'share_accepted',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר/ה את השיתוף',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר/ה את שיתוף ' || v_vehicle_label || '.',
      jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id,
                         'vehicle_label', v_vehicle_label,
                         'acceptor_id', uid, 'acceptor_name', coalesce(v_acceptor_name, 'משתמש'),
                         'role', s.role)
    );
  exception when others then null; end;

  return jsonb_build_object(
    'share_id',      s.id,
    'vehicle_id',    s.vehicle_id,
    'vehicle_label', v_vehicle_label,
    'inviter_name',  v_inviter_name,
    'role',          s.role,
    'status',        'accepted'
  );
end $$;

notify pgrst, 'reload schema';
