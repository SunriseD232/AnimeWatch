-- MediaWatch — миграция 0048: совместный просмотр («Смотреть вместе»)
-- Применить: docker cp … supabase-db:/tmp/ && docker exec -i supabase-db
-- psql -U postgres -d postgres -f /tmp/0048_watch_parties.sql (см. README §2).
--
-- В базе живёт только то, что должно пережить перезагрузку страницы: какая
-- комната, что в ней смотрят и кто в неё вошёл. Сам ход просмотра (пауза,
-- позиция, смена серии) и чат идут через Realtime Broadcast приватного канала
-- `party:<id>` и в базу не пишутся вовсе — чат по решению владельца сайта
-- без истории.
--
-- Участников не больше пяти (решение владельца сайта, 2026-10-07): каждый
-- зритель тянет своё видео через прокси на VPS, и трафик растёт с каждым.
-- Комната живёт сутки: ссылка-приглашение из вчерашнего чата не должна
-- открывать дверь навсегда.

create table if not exists watch_parties (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('anime', 'cinema')),
  shikimori_id bigint not null,
  title text not null check (char_length(title) between 1 and 300),
  -- Серия на момент создания: по ней приглашённый открывает страницу. Дальше
  -- актуальную серию он узнаёт от тех, кто уже в комнате (Broadcast).
  season int not null default 1,
  episode int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists watch_party_members (
  party_id uuid not null references watch_parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index if not exists watch_party_members_user_idx on watch_party_members (user_id);

alter table watch_parties enable row level security;
alter table watch_party_members enable row level security;

-- Проверка членства — security definer, чтобы политика на
-- watch_party_members не ссылалась сама на себя (бесконечная рекурсия RLS).
create or replace function is_watch_party_member(p_party uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from watch_party_members
    where party_id = p_party and user_id = auth.uid()
  );
$$;

drop policy if exists "watch parties visible to members" on watch_parties;
create policy "watch parties visible to members" on watch_parties
  for select to authenticated using (is_watch_party_member(id));

drop policy if exists "watch party members visible to members" on watch_party_members;
create policy "watch party members visible to members" on watch_party_members
  for select to authenticated using (is_watch_party_member(party_id));

-- Писать напрямую нельзя никому: создание, вход и выход — только функциями
-- ниже, где проверяются лимит и срок жизни.
revoke all on watch_parties, watch_party_members from anon, authenticated;
grant select on watch_parties, watch_party_members to authenticated;
grant all on watch_parties, watch_party_members to service_role;

create or replace function create_watch_party(
  p_content_type text,
  p_shikimori_id bigint,
  p_title text,
  p_season int,
  p_episode int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  insert into watch_parties (created_by, content_type, shikimori_id, title, season, episode)
  values (auth.uid(), p_content_type, p_shikimori_id, left(p_title, 300),
          greatest(p_season, 1), greatest(p_episode, 1))
  returning id into v_id;
  insert into watch_party_members (party_id, user_id) values (v_id, auth.uid());
  return v_id;
end;
$$;

-- Вход по ссылке. Повторный вход своего же участника — просто ок (обновили
-- страницу, открыли на втором устройстве). Ошибки — кодами в тексте
-- исключения, их читает страница /party/[id]: party_not_found, party_expired,
-- party_full.
create or replace function join_watch_party(p_party uuid)
returns table (content_type text, shikimori_id bigint, season int, episode int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party watch_parties%rowtype;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- for update — два гостя, вошедшие одновременно, не проскочат лимит оба.
  select * into v_party from watch_parties where id = p_party for update;
  if not found then
    raise exception 'party_not_found';
  end if;
  if v_party.created_at < now() - interval '24 hours' then
    raise exception 'party_expired';
  end if;
  if not exists (
    select 1 from watch_party_members where party_id = p_party and user_id = auth.uid()
  ) then
    select count(*) into v_count from watch_party_members where party_id = p_party;
    if v_count >= 5 then
      raise exception 'party_full';
    end if;
    insert into watch_party_members (party_id, user_id) values (p_party, auth.uid());
  end if;
  return query select v_party.content_type, v_party.shikimori_id, v_party.season, v_party.episode;
end;
$$;

-- Выход освобождает место. Последний вышедший закрывает комнату целиком.
create or replace function leave_watch_party(p_party uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from watch_party_members where party_id = p_party and user_id = auth.uid();
  if not exists (select 1 from watch_party_members where party_id = p_party) then
    delete from watch_parties where id = p_party;
  end if;
end;
$$;

revoke all on function create_watch_party(text, bigint, text, int, int) from public, anon;
revoke all on function join_watch_party(uuid) from public, anon;
revoke all on function leave_watch_party(uuid) from public, anon;
revoke all on function is_watch_party_member(uuid) from public, anon;
grant execute on function create_watch_party(text, bigint, text, int, int) to authenticated;
grant execute on function join_watch_party(uuid) to authenticated;
grant execute on function leave_watch_party(uuid) to authenticated;
grant execute on function is_watch_party_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: приватный канал party:<id> — только для участников комнаты
-- ---------------------------------------------------------------------------
-- Realtime Authorization проверяет эти политики при подписке на канал с
-- config.private = true (и при отправке в него). Остальные каналы сайта
-- (уведомления, прогресс) публичные и этих политик не касаются.

drop policy if exists "watch party members read channel" on realtime.messages;
create policy "watch party members read channel" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'party:%'
    and exists (
      select 1 from public.watch_party_members m
      where m.user_id = auth.uid()
        and 'party:' || m.party_id::text = realtime.topic()
    )
  );

drop policy if exists "watch party members write channel" on realtime.messages;
create policy "watch party members write channel" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() like 'party:%'
    and exists (
      select 1 from public.watch_party_members m
      where m.user_id = auth.uid()
        and 'party:' || m.party_id::text = realtime.topic()
    )
  );
