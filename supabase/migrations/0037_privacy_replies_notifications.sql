-- MediaWatch — миграция 0037: приватность, «Пересматриваю», ответы на
-- комментарии, социальные уведомления
-- Применить после 0036.

-- ---------------------------------------------------------------------------
-- 1. Приватность: кто видит список и оценки
-- ---------------------------------------------------------------------------
-- Три уровня: все вошедшие / только друзья / никто. По умолчанию «только
-- друзья» — ровно то, как оценки работали до этой миграции, а список до неё
-- не видел никто, кроме владельца. Молча открыть его всем значило бы
-- поменять приватность за людей, не спросив.
alter table profiles
  add column if not exists lists_visibility text not null default 'friends'
    check (lists_visibility in ('everyone', 'friends', 'nobody')),
  add column if not exists ratings_visibility text not null default 'friends'
    check (ratings_visibility in ('everyone', 'friends', 'nobody'));

-- Может ли текущий пользователь видеть раздел владельца. Строки профиля
-- может не быть (человек ничего не настраивал) — тогда действует умолчание.
create or replace function can_view_section(owner uuid, section text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  level text;
begin
  if viewer is null then
    return false;
  end if;
  if viewer = owner then
    return true;
  end if;
  select case section
           when 'lists' then p.lists_visibility
           when 'ratings' then p.ratings_visibility
         end
    into level
    from profiles p
   where p.user_id = owner;
  level := coalesce(level, 'friends');
  if level = 'everyone' then
    return true;
  end if;
  if level = 'friends' then
    return are_friends(viewer, owner);
  end if;
  return false;
end;
$$;

revoke all on function can_view_section(uuid, text) from public, anon;
grant execute on function can_view_section(uuid, text) to authenticated, service_role;

-- Оценки: вместо «сам и друзья» — по настройке владельца.
drop policy if exists "ratings visible to self and friends" on title_ratings;
drop policy if exists "ratings visible by owner privacy" on title_ratings;
create policy "ratings visible by owner privacy" on title_ratings
  for select to authenticated
  using (auth.uid() = user_id or can_view_section(user_id, 'ratings'));

-- Список: RLS user_list НЕ трогаем. Больше десятка запросов по сайту
-- читают user_list без фильтра по user_id и полагаются на то, что RLS отдаёт
-- только своё («Продолжить просмотр», календарь, профиль). Расширь политику —
-- и в своём списке у человека появились бы тайтлы друзей. Чужой список
-- отдаётся только этой функцией, и только если владелец разрешил.
create or replace function get_visible_user_list(owner uuid)
returns table (
  content_type text,
  shikimori_id integer,
  anime_title text,
  poster_url text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.content_type, l.shikimori_id, l.anime_title, l.poster_url, l.status, l.created_at
    from user_list l
   where l.user_id = owner
     and can_view_section(owner, 'lists')
   order by l.created_at desc
   limit 1000;
$$;

revoke all on function get_visible_user_list(uuid) from public, anon;
grant execute on function get_visible_user_list(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Статус «Пересматриваю»
-- ---------------------------------------------------------------------------
-- Уведомления о новых сериях по нему не шлются (крон берёт только
-- 'watching'): пересматривают то, что уже вышло.
alter table user_list drop constraint if exists user_list_status_check;
alter table user_list add constraint user_list_status_check
  check (status in ('watching', 'rewatching', 'planned', 'completed', 'dropped'));

-- ---------------------------------------------------------------------------
-- 3. Ответы на комментарии
-- ---------------------------------------------------------------------------
-- parent_id — на что отвечают, root_id — верхний комментарий ветки. root_id
-- нужен, чтобы ветку целиком читать одним запросом по индексу, а не
-- рекурсией по parent_id. Вычисляет его триггер, а не клиент.
--
-- deleted_at — мягкое удаление: у комментария с ответами текст стирается,
-- а сам он остаётся заглушкой «комментарий удалён», иначе чужие ответы
-- повисли бы без контекста или пропали каскадом.
--
-- anime_title / poster_url — для раздела «Мои комментарии» и уведомлений об
-- ответах: там комментарий показывается вне страницы серии.
alter table episode_comments
  add column if not exists parent_id uuid references episode_comments(id) on delete cascade,
  add column if not exists root_id uuid references episode_comments(id) on delete cascade,
  add column if not exists deleted_at timestamptz,
  add column if not exists anime_title text,
  add column if not exists poster_url text;

create index if not exists episode_comments_top_idx
  on episode_comments (content_type, shikimori_id, season, episode, created_at desc)
  where parent_id is null;
create index if not exists episode_comments_root_idx
  on episode_comments (root_id, created_at)
  where root_id is not null;
create index if not exists episode_comments_user_idx
  on episode_comments (user_id, created_at desc);

create or replace function episode_comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent episode_comments;
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  if new.parent_id is null then
    new.root_id := null;
    return new;
  end if;
  select * into parent from episode_comments where id = new.parent_id;
  if not found then
    raise exception 'parent comment not found' using errcode = '23503';
  end if;
  if parent.content_type <> new.content_type
     or parent.shikimori_id <> new.shikimori_id
     or parent.season <> new.season
     or parent.episode <> new.episode then
    raise exception 'reply must belong to the same episode' using errcode = '23514';
  end if;
  if parent.deleted_at is not null then
    raise exception 'cannot reply to a deleted comment' using errcode = '23514';
  end if;
  new.root_id := coalesce(parent.root_id, parent.id);
  return new;
end;
$$;

drop trigger if exists episode_comments_before_insert on episode_comments;
create trigger episode_comments_before_insert
  before insert on episode_comments
  for each row execute function episode_comments_before_insert();

-- Удалённый комментарий не правится и не «воскрешается».
create or replace function episode_comments_before_update()
returns trigger
language plpgsql
as $$
begin
  if old.deleted_at is not null and (new.deleted_at is null or new.body <> old.body) then
    raise exception 'comment is deleted' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists episode_comments_before_update on episode_comments;
create trigger episode_comments_before_update
  before update on episode_comments
  for each row execute function episode_comments_before_update();

-- Колоночный грант из 0036 плюс deleted_at: мягко удалить своё может сам
-- автор (RLS пускает только его строки).
grant update (body, edited_at, deleted_at) on episode_comments to authenticated;

-- Число живых ответов в ветках — одним вызовом на страницу комментариев.
create or replace function comment_reply_counts(p_roots uuid[])
returns table (root_id uuid, replies integer)
language sql
stable
set search_path = public
as $$
  select c.root_id, count(*)::integer
    from episode_comments c
   where c.root_id = any (p_roots)
     and c.deleted_at is null
   group by c.root_id;
$$;

revoke all on function comment_reply_counts(uuid[]) from public, anon;
grant execute on function comment_reply_counts(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Социальные уведомления: заявки в друзья и ответы на комментарии
-- ---------------------------------------------------------------------------
-- Создаются триггерами, а не кодом маршрутов: заявку можно отправить и
-- принять разными путями, и уведомление не должно зависеть от того, какой
-- из них сработал. Клиент их только читает, отмечает прочитанными и удаляет.
create table if not exists social_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'comment_reply')),
  actor_id uuid references auth.users(id) on delete cascade,
  comment_id uuid references episode_comments(id) on delete cascade,
  content_type text check (content_type is null or content_type in ('anime', 'cinema')),
  shikimori_id integer,
  season integer,
  episode integer,
  title text,
  snippet text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists social_notifications_user_idx
  on social_notifications (user_id, created_at desc);

alter table social_notifications enable row level security;

drop policy if exists "social notifications own select" on social_notifications;
drop policy if exists "social notifications own update" on social_notifications;
drop policy if exists "social notifications own delete" on social_notifications;

create policy "social notifications own select" on social_notifications
  for select to authenticated using (auth.uid() = user_id);
create policy "social notifications own update" on social_notifications
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "social notifications own delete" on social_notifications
  for delete to authenticated using (auth.uid() = user_id);

revoke all on social_notifications from anon, authenticated;
grant select, delete on social_notifications to authenticated;
grant update (read_at) on social_notifications to authenticated;
grant select, insert, update, delete on social_notifications to service_role;

create or replace function notify_friendship_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Повторная заявка после отзыва не должна копить дубли.
    delete from social_notifications
     where user_id = new.addressee_id and actor_id = new.requester_id and kind = 'friend_request';
    insert into social_notifications (user_id, kind, actor_id)
    values (new.addressee_id, 'friend_request', new.requester_id);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'accepted' then
      -- Заявка решена — уведомление о ней больше не нужно.
      delete from social_notifications
       where user_id = new.addressee_id and actor_id = new.requester_id and kind = 'friend_request';
      insert into social_notifications (user_id, kind, actor_id)
      values (new.requester_id, 'friend_accepted', new.addressee_id);
    end if;
    return new;
  end if;

  -- DELETE: отозванная или отклонённая заявка не должна висеть в колокольчике.
  delete from social_notifications
   where user_id = old.addressee_id and actor_id = old.requester_id and kind = 'friend_request';
  return old;
end;
$$;

drop trigger if exists friendships_notify on friendships;
create trigger friendships_notify
  after insert or update or delete on friendships
  for each row execute function notify_friendship_change();

create or replace function notify_comment_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  select user_id into recipient from episode_comments where id = new.parent_id;
  -- Ответ самому себе — не повод для уведомления.
  if recipient is null or recipient = new.user_id then
    return new;
  end if;
  insert into social_notifications
    (user_id, kind, actor_id, comment_id, content_type, shikimori_id, season, episode, title, snippet)
  values
    (recipient, 'comment_reply', new.user_id, new.id, new.content_type, new.shikimori_id,
     new.season, new.episode, new.anime_title, left(new.body, 160));
  return new;
end;
$$;

drop trigger if exists episode_comments_notify_reply on episode_comments;
create trigger episode_comments_notify_reply
  after insert on episode_comments
  for each row execute function notify_comment_reply();

-- Новые уведомления прилетают в колокольчик без перезагрузки — как и
-- уведомления о сериях.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'social_notifications'
  ) then
    alter publication supabase_realtime add table social_notifications;
  end if;
end $$;
