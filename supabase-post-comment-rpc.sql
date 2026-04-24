-- ==========================================================================
-- post_comment(...) — SECURITY DEFINER RPC
--
-- Fuses the two client-side calls:
--   1. supabase.rpc('get_anonymous_number', ...)
--   2. db.community_comments.create(...)
-- into a single atomic transaction with an advisory lock per post.
--
-- Why this exists (audit L3): two users commenting anonymously on the
-- same post within the same few milliseconds would both hit
-- get_anonymous_number concurrently, both see MAX=N, and both get N+1 —
-- causing duplicate anonymous numbers. The old flow had no serialization
-- between the "look up number" and "insert comment" steps.
--
-- Using pg_advisory_xact_lock(hash(post_id)) serializes writers per post
-- at the lock level, not the transaction level, so unrelated posts don't
-- contend. The advisory lock releases automatically at transaction end.
--
-- Safe to re-run.
-- ==========================================================================

create or replace function public.post_comment(
  p_post_id      uuid,
  p_body         text,
  p_is_anonymous boolean,
  p_author_name  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_anon_num int := null;
  v_author_name text;
  v_comment_id uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'empty_body';
  end if;

  -- Lightweight post_id existence check (also acts as a poor-man's authz
  -- guard — RLS on community_posts only lets a user see posts they're
  -- allowed to interact with).
  if not exists (select 1 from public.community_posts where id = p_post_id) then
    raise exception 'post_not_found';
  end if;

  if p_is_anonymous then
    -- Serialize writers on the same post so two concurrent anonymous
    -- commenters can't both read the same MAX and both insert N+1.
    -- hashtextextended returns bigint → advisory_xact_lock accepts bigint.
    perform pg_advisory_xact_lock(hashtextextended(p_post_id::text, 0));

    -- Reuse existing number if this user already commented anonymously
    -- on this post (same identity across comments in the same thread).
    select anonymous_number into v_anon_num
    from public.community_comments
    where post_id = p_post_id
      and user_id = uid
      and is_anonymous = true
      and anonymous_number is not null
    order by created_at asc
    limit 1;

    if v_anon_num is null then
      -- Include the post's own anonymous_number (the OP is typically #1)
      -- so the first anonymous commenter doesn't collide with the OP by
      -- also getting #1.
      select coalesce(
        greatest(
          max(c.anonymous_number),
          (select anonymous_number from public.community_posts
             where id = p_post_id and is_anonymous = true and anonymous_number is not null)
        ),
        0
      ) + 1
      into v_anon_num
      from public.community_comments c
      where c.post_id = p_post_id
        and c.is_anonymous = true;
    end if;

    v_author_name := 'אנונימי #' || v_anon_num;
  else
    v_author_name := coalesce(nullif(btrim(p_author_name), ''), 'משתמש');
  end if;

  insert into public.community_comments (
    post_id, user_id, author_name, body, is_ai,
    is_anonymous, anonymous_number
  ) values (
    p_post_id, uid, v_author_name, p_body, false,
    p_is_anonymous, v_anon_num
  )
  returning id into v_comment_id;

  return jsonb_build_object(
    'ok', true,
    'comment_id', v_comment_id,
    'anonymous_number', v_anon_num,
    'author_name', v_author_name
  );
end $$;

revoke all on function public.post_comment(uuid, text, boolean, text) from public;
grant execute on function public.post_comment(uuid, text, boolean, text) to authenticated;
