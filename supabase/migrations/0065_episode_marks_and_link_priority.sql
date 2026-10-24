-- MediaWatch — миграция 0065: метки выпусков и порядок сопоставления источников
--
-- 1. episode_marks — метки выпусков подкаста (и частей аудиокниги) для
--    тегов «в процессе» / «в планах» в списке выпусков (24.10.2026).
--    «Прослушан» здесь НЕ хранится: он уже есть в watched_episodes, и второй
--    источник правды разъехался бы с первым. watch_progress держит одну
--    строку на подкаст — место только текущего выпуска; здесь — место в
--    каждом начатом выпуске, поэтому к брошенному выпуску можно вернуться.
--
-- 2. source_link_attempts + next_*_link_batch() — порция для фоновых
--    задач сопоставления (link-manga-sources, link-ranobe-flibusta). Раньше
--    они шли курсором по возрастанию id: сначала старые и малоизвестные
--    тайтлы, полный круг — месяц у манги и три у ранобэ, а «не нашли»
--    нигде не помнилось. Теперь: сначала то, что читают и держат в
--    списках, потом по популярности; попытку без находки повторяем не
--    раньше чем через 30 дней.
--
-- Применять после 0064.

-- ─────────────────────────────────────────────────────────────
-- 1. Метки выпусков
-- ─────────────────────────────────────────────────────────────
create table if not exists episode_marks (
  user_id uuid not null references auth.users (id) on delete cascade,
  content_type text not null check (content_type in ('podcast', 'audiobook')),
  shikimori_id bigint not null,
  episode integer not null,
  status text not null check (status in ('in_progress', 'planned')),
  -- Место внутри выпуска — для «в процессе».
  position_seconds real,
  duration_seconds real,
  updated_at timestamptz not null default now(),
  primary key (user_id, content_type, shikimori_id, episode)
);

comment on table episode_marks is
  'Метки выпусков: в процессе (с местом) и в планах. Прослушанные — в watched_episodes.';

alter table episode_marks enable row level security;
create policy "own episode marks select" on episode_marks for select using (auth.uid() = user_id);
create policy "own episode marks insert" on episode_marks for insert with check (auth.uid() = user_id);
create policy "own episode marks update" on episode_marks for update using (auth.uid() = user_id);
create policy "own episode marks delete" on episode_marks for delete using (auth.uid() = user_id);
grant select, insert, update, delete on episode_marks to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Порядок фонового сопоставления источников
-- ─────────────────────────────────────────────────────────────
create table if not exists source_link_attempts (
  job text not null,
  title_key bigint not null,
  attempted_at timestamptz not null default now(),
  found boolean not null default false,
  primary key (job, title_key)
);

comment on table source_link_attempts is
  'Когда фоновая задача сопоставления (job) последний раз искала тайтл и нашла ли.';

alter table source_link_attempts enable row level security;
-- Пишет и читает только крон с service_role.

-- Интерес: кто-то читает (watch_progress) или держит в списке (user_list).
-- Сортировка: интерес → популярность (views) → id. Повтор — через 30 дней.
create or replace function next_manga_link_batch(lim integer default 20)
returns table (title_id bigint, title text, original_title text, alternative_title text, year smallint)
language sql stable
as $$
  with interest as (
    select shikimori_id from watch_progress where content_type = 'manga'
    union
    select shikimori_id from user_list where content_type = 'manga'
  )
  select m.title_id, m.title, m.original_title, m.alternative_title, m.year
    from manga_index m
    left join source_link_attempts a on a.job = 'manga' and a.title_key = m.title_id
    left join interest i on i.shikimori_id = m.title_id
   where m.in_catalog
     and (a.attempted_at is null or a.attempted_at < now() - interval '30 days')
   order by (i.shikimori_id is not null) desc, m.views desc nulls last, m.title_id
   limit greatest(lim, 1);
$$;

create or replace function next_ranobe_link_batch(lim integer default 10)
returns table (title_id bigint, dir text, title text, original_title text, alternative_title text, year smallint)
language sql stable
as $$
  with interest as (
    select shikimori_id from watch_progress where content_type = 'ranobe'
    union
    select shikimori_id from user_list where content_type = 'ranobe'
  )
  select r.title_id, r.dir, r.title, r.original_title, r.alternative_title, r.year
    from ranobe_index r
    left join source_link_attempts a on a.job = 'ranobe' and a.title_key = r.title_id
    left join interest i on i.shikimori_id = r.title_id
   where r.in_catalog
     and (a.attempted_at is null or a.attempted_at < now() - interval '30 days')
   order by (i.shikimori_id is not null) desc, r.views desc nulls last, r.title_id
   limit greatest(lim, 1);
$$;

grant execute on function next_manga_link_batch(integer) to service_role;
grant execute on function next_ranobe_link_batch(integer) to service_role;

-- Уже пройденное старым курсором не повторяем сразу: всё до курсора
-- считаем попыткой «сейчас» (найденное — найденным, по title_sources).
insert into source_link_attempts (job, title_key, attempted_at, found)
select 'manga', m.title_id, now(),
       exists (select 1 from title_sources s
                where s.content_type = 'manga' and s.title_key = m.title_id
                  and s.source not in ('remanga', 'mangalib'))
  from manga_index m, source_link_state st
 where st.job = 'manga' and m.title_id <= coalesce(st.last_cursor, 0)
on conflict (job, title_key) do nothing;

insert into source_link_attempts (job, title_key, attempted_at, found)
select 'ranobe', r.title_id, now(),
       exists (select 1 from title_sources s
                where s.content_type = 'ranobe' and s.title_key = r.title_id and s.source = 'flibusta')
  from ranobe_index r, source_link_state st
 where st.job = 'ranobe' and r.title_id <= coalesce(st.last_cursor, 0)
on conflict (job, title_key) do nothing;
