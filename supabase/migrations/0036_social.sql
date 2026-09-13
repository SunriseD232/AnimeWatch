-- MediaWatch — миграция 0036: социальная часть
-- Применить после 0035.
--
-- Четыре таблицы: профиль (имя и аватар), дружба, оценки тайтлов и
-- комментарии к конкретной серии. Сайт целиком закрыт для гостей (см.
-- lib/supabase/middleware.ts), поэтому «видно всем» здесь везде значит
-- «видно всем ВОШЕДШИМ»: политики выданы роли authenticated, у anon нет ни
-- одного права ни на одну из таблиц.
--
-- ОБЩИЙ ПРИНЦИП ПРАВ. RLS отвечает на вопрос «какие строки», но не «какие
-- колонки». Там, где клиенту можно менять только часть полей (подтвердить
-- дружбу, но не подменить отправителя; поправить текст комментария, но не
-- перенести его под другую серию), права сужены до колонок: сначала REVOKE
-- всего, что раздали default privileges из 0014, потом точечный GRANT.

-- ---------------------------------------------------------------------------
-- profiles: отображаемое имя и аватар
-- ---------------------------------------------------------------------------
-- Почта пользователя другим НЕ показывается нигде — отсюда отдельное имя.
-- Строка появляется лениво, при первой записи через /api/profile; у кого её
-- нет, интерфейс показывает нейтральную подпись (см. lib/social/names.ts).
--
-- Писать сюда клиенту нельзя вовсе — только сервер через service_role. Имя
-- проверяется на сервере (длина, символы, зарезервированные слова), а
-- avatar_path должен указывать ТОЛЬКО на наш файл: дай клиенту записать туда
-- произвольный адрес — и каждый, кто откроет комментарии, отправит запрос на
-- чужой сервер. CHECK ниже держит это и на уровне базы.
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text
    check (display_name is null or char_length(display_name) between 2 and 32),
  avatar_path text
    check (avatar_path is null or avatar_path ~ '^/avatars/[0-9a-f]{32}\.webp$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Имя уникально без учёта регистра: «Neko» и «neko» в списке друзей были бы
-- неотличимы, и добавить в друзья можно было бы не того.
create unique index if not exists profiles_display_name_key
  on profiles (lower(display_name))
  where display_name is not null;

alter table profiles enable row level security;

drop policy if exists "profiles readable by signed in" on profiles;
create policy "profiles readable by signed in" on profiles
  for select to authenticated using (true);

revoke all on profiles from anon, authenticated;
grant select on profiles to authenticated;
grant select, insert, update, delete on profiles to service_role;

-- ---------------------------------------------------------------------------
-- friendships: заявка, потом дружба
-- ---------------------------------------------------------------------------
-- Одна строка на пару, кто бы кому ни отправил: уникальный индекс по
-- (меньший id, больший id). Иначе встречные заявки A->B и B->A жили бы двумя
-- строками, и «дружат ли они» пришлось бы выяснять по обеим.
create table if not exists friendships (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_key
  on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx
  on friendships (addressee_id, status);

alter table friendships enable row level security;

drop policy if exists "friendships visible to both sides" on friendships;
drop policy if exists "friendships request as self" on friendships;
drop policy if exists "friendships accept as addressee" on friendships;
drop policy if exists "friendships delete by either side" on friendships;

create policy "friendships visible to both sides" on friendships
  for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Отправить можно только ОТ СЕБЯ и только заявку — сразу «accepted» не выйдет.
create policy "friendships request as self" on friendships
  for insert to authenticated
  with check (auth.uid() = requester_id and status = 'pending');

-- Принять может только тот, КОМУ отправили. Какие поля он вправе менять —
-- решает колоночный грант ниже: статус и время, но не участников.
create policy "friendships accept as addressee" on friendships
  for update to authenticated
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id and status = 'accepted');

-- Отозвать заявку, отклонить её или удалить из друзей — любая из сторон.
create policy "friendships delete by either side" on friendships
  for delete to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

revoke all on friendships from anon, authenticated;
grant select, insert, delete on friendships to authenticated;
grant update (status, accepted_at) on friendships to authenticated;
grant select, insert, update, delete on friendships to service_role;

-- Дружат ли двое. SECURITY DEFINER: функцию зовёт политика ДРУГОЙ таблицы
-- (оценки ниже), и так её ответ не зависит от того, как устроен RLS самой
-- friendships.
create or replace function are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and least(requester_id, addressee_id) = least(a, b)
      and greatest(requester_id, addressee_id) = greatest(a, b)
  );
$$;

revoke all on function are_friends(uuid, uuid) from public, anon;
grant execute on function are_friends(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- title_ratings: оценка тайтла 1-10
-- ---------------------------------------------------------------------------
-- Название и постер лежат рядом с оценкой по той же причине, что и в
-- user_list: список оценок друга рисуется одним запросом, без похода к
-- Shikimori/Videoseed за каждой карточкой.
--
-- Отдельные оценки видны только самому человеку и его друзьям. Средняя по
-- сайту видна всем — через функцию title_rating_summary ниже, которая
-- отдаёт только агрегат и не раскрывает, кто что поставил.
create table if not exists title_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('anime', 'cinema')),
  -- Для 'cinema' — kinopoisk_id, как во всех таблицах проекта.
  shikimori_id integer not null,
  score smallint not null check (score between 1 and 10),
  anime_title text,
  poster_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, content_type, shikimori_id)
);

create index if not exists title_ratings_title_idx
  on title_ratings (content_type, shikimori_id);

alter table title_ratings enable row level security;

drop policy if exists "ratings visible to self and friends" on title_ratings;
drop policy if exists "ratings insert own" on title_ratings;
drop policy if exists "ratings update own" on title_ratings;
drop policy if exists "ratings delete own" on title_ratings;

create policy "ratings visible to self and friends" on title_ratings
  for select to authenticated
  using (auth.uid() = user_id or are_friends(auth.uid(), user_id));
create policy "ratings insert own" on title_ratings
  for insert to authenticated with check (auth.uid() = user_id);
create policy "ratings update own" on title_ratings
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ratings delete own" on title_ratings
  for delete to authenticated using (auth.uid() = user_id);

revoke all on title_ratings from anon, authenticated;
grant select, insert, update, delete on title_ratings to authenticated;
grant select, insert, update, delete on title_ratings to service_role;

-- Средняя оценка сайта сразу по пачке тайтлов: карточки каталога просят её
-- одним вызовом на страницу, а не запросом на карточку.
create or replace function title_rating_summary(p_content_type text, p_ids integer[])
returns table (shikimori_id integer, average numeric, votes integer)
language sql
stable
security definer
set search_path = public
as $$
  select r.shikimori_id,
         round(avg(r.score)::numeric, 1) as average,
         count(*)::integer as votes
  from title_ratings r
  where r.content_type = p_content_type
    and r.shikimori_id = any (p_ids)
  group by r.shikimori_id;
$$;

revoke all on function title_rating_summary(text, integer[]) from public, anon;
grant execute on function title_rating_summary(text, integer[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- episode_comments: обсуждение конкретной серии
-- ---------------------------------------------------------------------------
create table if not exists episode_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('anime', 'cinema')),
  shikimori_id integer not null,
  season integer not null default 1 check (season >= 1),
  episode integer not null check (episode >= 1),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

-- Лента серии листается от новых к старым — индекс ровно под этот порядок.
create index if not exists episode_comments_thread_idx
  on episode_comments (content_type, shikimori_id, season, episode, created_at desc);

alter table episode_comments enable row level security;

drop policy if exists "comments readable by signed in" on episode_comments;
drop policy if exists "comments insert own" on episode_comments;
drop policy if exists "comments update own" on episode_comments;
drop policy if exists "comments delete own" on episode_comments;

create policy "comments readable by signed in" on episode_comments
  for select to authenticated using (true);
create policy "comments insert own" on episode_comments
  for insert to authenticated with check (auth.uid() = user_id);
create policy "comments update own" on episode_comments
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "comments delete own" on episode_comments
  for delete to authenticated using (auth.uid() = user_id);

-- Править можно только текст (и отметку о правке) — не серию и не автора.
-- Удаление чужих комментариев админом идёт через service_role в
-- /api/comments/[id], здесь его нет намеренно: список админов живёт в коде
-- (lib/admin.ts), а не в базе.
revoke all on episode_comments from anon, authenticated;
grant select, insert, delete on episode_comments to authenticated;
grant update (body, edited_at) on episode_comments to authenticated;
grant select, insert, update, delete on episode_comments to service_role;
