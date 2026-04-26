-- ==========================================================================
-- get_vehicle_owner_name(p_vehicle_id) — return the owner's display name
-- for a vehicle the caller has access to.
--
-- Why this RPC:
--   The sharee-side VehicleAccessModal previously only said "the owner
--   shared this with you" without naming them. Showing the owner's full
--   name closes the "who shared this with me?" question — important for
--   trust before tapping "leave share" or any other destructive action.
--
--   user_profiles has RLS that only lets users see their own row, so a
--   sharee can't read owner names directly. Cross-account auth.users
--   reads are also blocked. Hence: SECURITY DEFINER RPC, gated by an
--   explicit access check.
--
-- Authorization:
--   Caller must EITHER own the vehicle OR have an accepted share on it.
--   Anyone else gets NULL (not an error — keeps the UI fail-soft;
--   modal just falls back to the generic copy).
--
-- Returns: text — the owner's full_name (preferred) or email-prefix
--                 fallback (preserves the same fallback chain used in
--                 share_vehicle_with_email and other notification RPCs).
-- ==========================================================================

create or replace function public.get_vehicle_owner_name(p_vehicle_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_has_access boolean;
  v_name text;
begin
  if v_caller is null or p_vehicle_id is null then
    return null;
  end if;

  -- Resolve the vehicle's account owner.
  select a.owner_user_id
    into v_owner
    from public.vehicles v
    join public.accounts a on a.id = v.account_id
   where v.id = p_vehicle_id;

  if v_owner is null then return null; end if;

  -- Access gate: caller is the owner OR has an accepted share.
  v_has_access := (v_caller = v_owner) or exists (
    select 1
      from public.vehicle_shares s
     where s.vehicle_id = p_vehicle_id
       and s.shared_with_user_id = v_caller
       and s.status = 'accepted'
  );

  if not v_has_access then
    return null;
  end if;

  -- Owner display name. Same fallback ladder used by every other
  -- notification builder (share invites, revoke notices, etc.) —
  -- keeps the UI text consistent across surfaces.
  select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
    into v_name
    from auth.users
   where id = v_owner;

  return coalesce(v_name, 'משתמש');
end;
$$;

grant execute on function public.get_vehicle_owner_name(uuid) to authenticated;

-- Reload PostgREST schema cache so the RPC is callable immediately
-- without a project restart.
notify pgrst, 'reload schema';
