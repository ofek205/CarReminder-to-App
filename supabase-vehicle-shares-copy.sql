-- ==========================================================================
-- Copywriter pass on vehicle-share notification messages.
-- Re-states the affected RPCs with the cleaner Hebrew copy:
--   * gender-neutral verbs ("ביטל/ה", "אישר/ה", "יצא/ה", "מחק/ה", "עדכן/ה")
--   * single-sentence flow where two were nested
--   * "פגה תוקף" → "פגה" (the redundancy is now gone)
--   * "עזב" → "יצא/ה" (consistent with the UI's "יציאה מהשיתוף")
--   * "מעוניין לשתף" → "רוצה לשתף" (less formal)
-- Idempotent — replaces the function bodies in place.
-- ==========================================================================

create or replace function public.share_vehicle_with_email(p_vehicle_id uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_share_id uuid;
  v_token text;
  v_recipient_uid uuid;
  v_existing_active uuid;
  v_inviter_name text;
  v_vehicle_label text;
  v_email_norm text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_role not in ('viewer', 'editor') then raise exception 'invalid_role'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'invalid_email'; end if;
  v_email_norm := lower(trim(p_email));

  select v.account_id into v_account_id from public.vehicles v where v.id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found'; end if;
  if not exists (select 1 from public.account_members where account_id = v_account_id and user_id = uid and status = 'פעיל' and role = 'בעלים') then
    raise exception 'not_vehicle_owner';
  end if;

  select id into v_existing_active from public.vehicle_shares
   where vehicle_id = p_vehicle_id and lower(shared_with_email) = v_email_norm and status in ('pending', 'accepted') limit 1;
  if v_existing_active is not null then raise exception 'share_already_exists'; end if;

  select id into v_recipient_uid from auth.users where lower(email) = v_email_norm limit 1;
  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.vehicle_shares (vehicle_id, owner_user_id, shared_with_email, shared_with_user_id, role, invite_token)
  values (p_vehicle_id, uid, v_email_norm, v_recipient_uid, p_role, v_token)
  returning id into v_share_id;

  if v_recipient_uid is not null and v_recipient_uid <> uid then
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_inviter_name from auth.users where id = uid;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = p_vehicle_id;

    insert into public.app_notifications (user_id, type, title, body, data) values (
      v_recipient_uid, 'share_offered',
      coalesce(v_inviter_name, 'משתמש') || ' רוצה לשתף איתך רכב',
      coalesce(v_inviter_name, 'משתמש') || ' רוצה לשתף איתך את ' || v_vehicle_label || '. אישור השיתוף יוסיף את הרכב לרשימה שלך.',
      jsonb_build_object('share_id', v_share_id, 'vehicle_id', p_vehicle_id, 'vehicle_label', v_vehicle_label,
                         'role', p_role, 'invite_token', v_token, 'inviter_id', uid,
                         'inviter_name', coalesce(v_inviter_name, 'משתמש'))
    );
  end if;

  return jsonb_build_object('share_id', v_share_id, 'invite_token', v_token,
                            'recipient_existing_user', v_recipient_uid is not null,
                            'expires_at', now() + interval '7 days');
end $$;


create or replace function public.accept_vehicle_share(p_share_id uuid default null, p_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_acceptor_name text;
  v_vehicle_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_share_id is not null then
    select * into s from public.vehicle_shares where id = p_share_id for update;
  elsif p_token is not null then
    select * into s from public.vehicle_shares where invite_token = p_token for update;
  else raise exception 'missing_share_id_or_token'; end if;

  if not found then raise exception 'share_not_found'; end if;
  if s.status <> 'pending' then raise exception 'share_not_pending'; end if;
  if not exists (select 1 from auth.users where id = uid and lower(email) = lower(s.shared_with_email)) then
    raise exception 'share_email_mismatch';
  end if;
  if s.expires_at < now() then
    update public.vehicle_shares set status = 'expired' where id = s.id;
    raise exception 'share_expired';
  end if;

  update public.vehicle_shares set status = 'accepted', accepted_at = now(), shared_with_user_id = uid where id = s.id;

  begin
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_acceptor_name from auth.users where id = uid;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = s.vehicle_id;
    insert into public.app_notifications (user_id, type, title, body, data) values (
      s.owner_user_id, 'share_accepted',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר/ה את השיתוף',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר/ה את שיתוף ' || v_vehicle_label || '.',
      jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id, 'vehicle_label', v_vehicle_label,
                         'acceptor_id', uid, 'acceptor_name', coalesce(v_acceptor_name, 'משתמש'), 'role', s.role)
    );
  exception when others then null; end;

  return jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id, 'role', s.role, 'status', 'accepted');
end $$;


create or replace function public.decline_vehicle_share(p_share_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_decliner_name text;
  v_vehicle_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.vehicle_shares where id = p_share_id for update;
  if not found then raise exception 'share_not_found'; end if;
  if s.status <> 'pending' then raise exception 'share_not_pending'; end if;
  if not exists (select 1 from auth.users where id = uid and lower(email) = lower(s.shared_with_email)) then
    raise exception 'share_email_mismatch';
  end if;
  update public.vehicle_shares set status = 'revoked', revoked_at = now() where id = s.id;

  begin
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_decliner_name from auth.users where id = uid;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = s.vehicle_id;
    insert into public.app_notifications (user_id, type, title, body, data) values (
      s.owner_user_id, 'share_declined',
      coalesce(v_decliner_name, 'משתמש') || ' דחה/תה את ההזמנה',
      coalesce(v_decliner_name, 'משתמש') || ' דחה/תה את הזמנת השיתוף ל-' || v_vehicle_label || '.',
      jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id)
    );
  exception when others then null; end;
  return true;
end $$;


create or replace function public.revoke_vehicle_share(p_share_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_owner_name text;
  v_vehicle_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.vehicle_shares where id = p_share_id for update;
  if not found then raise exception 'share_not_found'; end if;
  if s.owner_user_id <> uid then raise exception 'not_share_owner'; end if;
  if s.status not in ('pending', 'accepted') then raise exception 'share_not_active'; end if;
  update public.vehicle_shares set status = 'revoked', revoked_at = now() where id = s.id;

  if s.shared_with_user_id is not null then
    begin
      select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_owner_name from auth.users where id = uid;
      select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = s.vehicle_id;
      insert into public.app_notifications (user_id, type, title, body, data) values (
        s.shared_with_user_id, 'share_revoked',
        coalesce(v_owner_name, 'משתמש') || ' ביטל/ה את השיתוף',
        coalesce(v_owner_name, 'משתמש') || ' ביטל/ה את שיתוף ' || v_vehicle_label || ', והרכב הוסר מהרשימה שלך.',
        jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id)
      );
    exception when others then null; end;
  end if;
  return true;
end $$;


create or replace function public.leave_vehicle_share(p_vehicle_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_user_name text;
  v_vehicle_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.vehicle_shares
   where vehicle_id = p_vehicle_id and shared_with_user_id = uid and status = 'accepted' for update;
  if not found then raise exception 'share_not_found'; end if;
  update public.vehicle_shares set status = 'revoked', revoked_at = now() where id = s.id;

  begin
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_user_name from auth.users where id = uid;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = s.vehicle_id;
    insert into public.app_notifications (user_id, type, title, body, data) values (
      s.owner_user_id, 'share_left',
      coalesce(v_user_name, 'משתמש') || ' יצא/ה מהשיתוף',
      coalesce(v_user_name, 'משתמש') || ' יצא/ה משיתוף ' || v_vehicle_label || '.',
      jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id)
    );
  exception when others then null; end;
  return true;
end $$;


create or replace function public.expire_stale_share_invites()
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.vehicle_shares%rowtype;
  v_owner_name text;
  v_vehicle_label text;
  count_expired int := 0;
begin
  for s in select * from public.vehicle_shares where status = 'pending' and expires_at < now() for update loop
    update public.vehicle_shares set status = 'expired' where id = s.id;
    count_expired := count_expired + 1;
    begin
      select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_owner_name from auth.users where id = s.owner_user_id;
      select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = s.vehicle_id;
      insert into public.app_notifications (user_id, type, title, body, data) values (
        s.owner_user_id, 'share_expired',
        'הזמנת שיתוף פגה',
        'ההזמנה ל-' || s.shared_with_email || ' לשיתוף ' || v_vehicle_label || ' פגה אחרי 7 ימים ללא אישור. אפשר לשלוח הזמנה חדשה.',
        jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id, 'side', 'owner')
      );
      if s.shared_with_user_id is not null then
        insert into public.app_notifications (user_id, type, title, body, data) values (
          s.shared_with_user_id, 'share_expired',
          'הזמנת שיתוף פגה',
          'הזמנת השיתוף של ' || coalesce(v_owner_name, 'משתמש') || ' ל-' || v_vehicle_label || ' פגה.',
          jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id, 'side', 'recipient')
        );
      end if;
    exception when others then null; end;
  end loop;
  return count_expired;
end $$;


create or replace function public.delete_vehicle_with_share_choice(p_vehicle_id uuid, p_mode text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_owner_name text;
  v_vehicle_label text;
  s record;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_mode not in ('both', 'self_leave') then raise exception 'invalid_mode'; end if;
  if p_mode = 'self_leave' then return public.leave_vehicle_share(p_vehicle_id); end if;

  select v.account_id into v_account_id from public.vehicles v where v.id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found'; end if;
  if not exists (select 1 from public.account_members where account_id = v_account_id and user_id = uid and status = 'פעיל' and role = 'בעלים') then
    raise exception 'not_vehicle_owner';
  end if;

  begin
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_owner_name from auth.users where id = uid;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = p_vehicle_id;
    for s in select shared_with_user_id, id from public.vehicle_shares
       where vehicle_id = p_vehicle_id and status = 'accepted' and shared_with_user_id is not null loop
      insert into public.app_notifications (user_id, type, title, body, data) values (
        s.shared_with_user_id, 'share_deleted',
        coalesce(v_owner_name, 'משתמש') || ' מחק/ה את הרכב',
        coalesce(v_owner_name, 'משתמש') || ' מחק/ה את ' || v_vehicle_label || ', והרכב הוסר מהרשימה שלך.',
        jsonb_build_object('share_id', s.id, 'vehicle_id', p_vehicle_id)
      );
    end loop;
  exception when others then null; end;

  delete from public.vehicles where id = p_vehicle_id;
  return true;
end $$;


create or replace function public.notify_vehicle_change(p_vehicle_id uuid, p_change_type text, p_summary text)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_actor_name text;
  v_vehicle_label text;
  v_owner_id uuid;
  recipient record;
begin
  if uid is null then return; end if;
  select am.user_id into v_owner_id from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים' and am.status = 'פעיל'
   where v.id = p_vehicle_id limit 1;
  select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = p_vehicle_id;
  select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_actor_name from auth.users where id = uid;

  if v_owner_id is not null and v_owner_id <> uid then
    insert into public.app_notifications (user_id, type, title, body, data) values (
      v_owner_id, 'vehicle_change',
      coalesce(v_actor_name, 'משתמש') || ' עדכן/ה את ' || v_vehicle_label,
      p_summary,
      jsonb_build_object('vehicle_id', p_vehicle_id, 'change_type', p_change_type, 'actor_id', uid)
    );
  end if;

  for recipient in select shared_with_user_id from public.vehicle_shares
     where vehicle_id = p_vehicle_id and status = 'accepted' and shared_with_user_id is not null and shared_with_user_id <> uid loop
    insert into public.app_notifications (user_id, type, title, body, data) values (
      recipient.shared_with_user_id, 'vehicle_change',
      coalesce(v_actor_name, 'משתמש') || ' עדכן/ה את ' || v_vehicle_label,
      p_summary,
      jsonb_build_object('vehicle_id', p_vehicle_id, 'change_type', p_change_type, 'actor_id', uid)
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
