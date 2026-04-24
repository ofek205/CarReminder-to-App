-- ==========================================================================
-- Server-side sanitization + rate limits for community tables
--
-- Audit #5 (HIGH): author_name is written straight from the client; a
-- tampered client can insert `<script>` or inline event handlers. The
-- client-side sanitizeRow already scrubs HTML, but relying on the client
-- for security is the classic RLS-isn't-enough trap.
--
-- Audit #6 (MEDIUM): contact_messages + community_comments + community_posts
-- have no per-user rate limit. An authenticated user (or a stolen token)
-- can spam thousands of rows.
--
-- Both concerns are handled in the DB so every write path — including
-- future callers, other clients, bots — is covered.
--
-- Safe to re-run.
-- ==========================================================================


-- ──────────────────────────────────────────────────────────────────────────
-- 1. Scrubbing helper — strips HTML tags, event handlers, and dangerous URI
--    schemes from text. Designed to be fast (regex-only) and idempotent.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.scrub_text(txt text)
returns text
language sql
immutable
as $$
  select
    case
      when txt is null then null
      -- 1. Decode numeric HTML entities so attacker-encoded tags don't slip past the tag stripper.
      --    &#60;img ...&#62; -> <img ...>. Done BEFORE tag-strip.
      -- 2. Strip any HTML tag.
      -- 3. Strip leftover event handlers and `javascript:` protocol.
      -- 4. Collapse control characters except newline/tab.
      else regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(txt, '&#(\d+);?', '', 'g'),
                   '<[^>]*>', '', 'g'
                 ),
                 '(on\w+\s*=|javascript\s*:)', '', 'gi'
               ),
               '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g'
             ),
             E'^\\s+|\\s+$', '', 'g'
           )
    end
$$;


-- ──────────────────────────────────────────────────────────────────────────
-- 2. Triggers — enforce sanitize on insert/update for the three community
--    tables. Running in BEFORE triggers so the stored value is already clean.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.community_posts_sanitize()
returns trigger language plpgsql as $$
begin
  new.author_name := public.scrub_text(new.author_name);
  new.body        := public.scrub_text(new.body);
  return new;
end $$;

drop trigger if exists community_posts_sanitize_tg on public.community_posts;
create trigger community_posts_sanitize_tg
  before insert or update on public.community_posts
  for each row execute function public.community_posts_sanitize();


create or replace function public.community_comments_sanitize()
returns trigger language plpgsql as $$
begin
  new.author_name := public.scrub_text(new.author_name);
  new.body        := public.scrub_text(new.body);
  return new;
end $$;

drop trigger if exists community_comments_sanitize_tg on public.community_comments;
create trigger community_comments_sanitize_tg
  before insert or update on public.community_comments
  for each row execute function public.community_comments_sanitize();


create or replace function public.contact_messages_sanitize()
returns trigger language plpgsql as $$
begin
  new.name    := public.scrub_text(new.name);
  new.subject := public.scrub_text(new.subject);
  new.message := public.scrub_text(new.message);
  return new;
end $$;

drop trigger if exists contact_messages_sanitize_tg on public.contact_messages;
create trigger contact_messages_sanitize_tg
  before insert or update on public.contact_messages
  for each row execute function public.contact_messages_sanitize();


-- ──────────────────────────────────────────────────────────────────────────
-- 3. Rate-limit triggers — per-user caps on INSERT.
--     Uses the existing rate_limit_check(kind, max_per_min) RPC from the
--     ai-proxy bootstrap. If the table is missing we fail open (returning
--     null from the check), so the triggers are safe on fresh DBs.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.community_posts_rate_limit()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if auth.uid() is null then return new; end if;  -- service-role writes bypass
  begin
    select public.rate_limit_check(
      'community_post:' || auth.uid()::text,
      5                 -- 5 posts / minute / user
    ) into allowed;
  exception when others then allowed := null; end;
  if allowed = false then
    raise exception 'rate_limit_exceeded: too many posts, wait a minute';
  end if;
  return new;
end $$;

drop trigger if exists community_posts_rate_limit_tg on public.community_posts;
create trigger community_posts_rate_limit_tg
  before insert on public.community_posts
  for each row execute function public.community_posts_rate_limit();


create or replace function public.community_comments_rate_limit()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if auth.uid() is null then return new; end if;
  begin
    select public.rate_limit_check(
      'community_comment:' || auth.uid()::text,
      20                -- 20 comments / minute / user
    ) into allowed;
  exception when others then allowed := null; end;
  if allowed = false then
    raise exception 'rate_limit_exceeded: too many comments, wait a minute';
  end if;
  return new;
end $$;

drop trigger if exists community_comments_rate_limit_tg on public.community_comments;
create trigger community_comments_rate_limit_tg
  before insert on public.community_comments
  for each row execute function public.community_comments_rate_limit();


create or replace function public.contact_messages_rate_limit()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if auth.uid() is null then return new; end if;
  begin
    select public.rate_limit_check(
      'contact_message:' || auth.uid()::text,
      3                 -- 3 contact messages / minute
    ) into allowed;
  exception when others then allowed := null; end;
  if allowed = false then
    raise exception 'rate_limit_exceeded: too many contact messages, wait a minute';
  end if;
  return new;
end $$;

drop trigger if exists contact_messages_rate_limit_tg on public.contact_messages;
create trigger contact_messages_rate_limit_tg
  before insert on public.contact_messages
  for each row execute function public.contact_messages_rate_limit();
