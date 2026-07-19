-- AnimeWatch — миграция 0004: просмотренные серии
-- Точная пометка каждой досмотренной серии (а не только «текущая позиция»),
-- чтобы подсвечивать просмотренное в сетках серий и автоматически переводить
-- тайтл в статус «Просмотрено». Применить после 0003.

create table if not exists watched_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null default 'anime'
    check (content_type in ('anime', 'cinema')),
  -- Для 'anime' — shikimori_id, для 'cinema' — kinopoisk_id (как всюду).
  shikimori_id integer not null,
  season integer not null default 1,
  episode integer not null,
  watched_at timestamptz not null default now(),
  unique (user_id, content_type, shikimori_id, season, episode)
);

create index if not exists watched_episodes_title_idx
  on watched_episodes (user_id, content_type, shikimori_id);

alter table watched_episodes enable row level security;

drop policy if exists "own watched select" on watched_episodes;
drop policy if exists "own watched insert" on watched_episodes;
drop policy if exists "own watched delete" on watched_episodes;

create policy "own watched select" on watched_episodes
  for select using (auth.uid() = user_id);
create policy "own watched insert" on watched_episodes
  for insert with check (auth.uid() = user_id);
create policy "own watched delete" on watched_episodes
  for delete using (auth.uid() = user_id);

grant select, insert, delete on watched_episodes to authenticated;
