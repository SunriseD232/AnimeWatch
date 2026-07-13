-- AnimeWatch MVP — начальная миграция
-- Применить через Supabase SQL Editor или CLI (supabase db push).

-- =========================================================
-- Прогресс просмотра: одна строка на пару (пользователь, тайтл)
-- =========================================================
create table if not exists watch_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shikimori_id integer not null,
  anime_title text not null,          -- денормализация для быстрого рендера списка
  poster_url text,                    -- то же
  episode integer not null default 1,
  position_seconds numeric not null default 0,
  duration_seconds numeric,           -- для расчёта % просмотра
  translation_id integer,             -- id озвучки Kodik, чтобы восстанавливать её же
  updated_at timestamptz not null default now(),
  unique (user_id, shikimori_id)
);

create index if not exists watch_progress_user_updated_idx
  on watch_progress (user_id, updated_at desc);

-- =========================================================
-- Список «Смотрю / Запланировано / Просмотрено»
-- =========================================================
create table if not exists user_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shikimori_id integer not null,
  anime_title text not null,
  poster_url text,
  status text not null check (status in ('watching','planned','completed','dropped')),
  created_at timestamptz not null default now(),
  unique (user_id, shikimori_id)
);

create index if not exists user_list_user_idx
  on user_list (user_id, created_at desc);

-- =========================================================
-- Row Level Security
-- =========================================================
alter table watch_progress enable row level security;
alter table user_list enable row level security;

-- watch_progress
drop policy if exists "own progress select" on watch_progress;
drop policy if exists "own progress insert" on watch_progress;
drop policy if exists "own progress update" on watch_progress;
drop policy if exists "own progress delete" on watch_progress;

create policy "own progress select" on watch_progress for select using (auth.uid() = user_id);
create policy "own progress insert" on watch_progress for insert with check (auth.uid() = user_id);
create policy "own progress update" on watch_progress for update using (auth.uid() = user_id);
create policy "own progress delete" on watch_progress for delete using (auth.uid() = user_id);

-- user_list
drop policy if exists "own list select" on user_list;
drop policy if exists "own list insert" on user_list;
drop policy if exists "own list update" on user_list;
drop policy if exists "own list delete" on user_list;

create policy "own list select" on user_list for select using (auth.uid() = user_id);
create policy "own list insert" on user_list for insert with check (auth.uid() = user_id);
create policy "own list update" on user_list for update using (auth.uid() = user_id);
create policy "own list delete" on user_list for delete using (auth.uid() = user_id);

-- =========================================================
-- Табличные привилегии: роль authenticated должна иметь GRANT,
-- RLS дополнительно ограничивает доступ строками владельца.
-- (anon намеренно без доступа — гости прогресс не сохраняют.)
-- =========================================================
grant select, insert, update, delete on watch_progress to authenticated;
grant select, insert, update, delete on user_list to authenticated;

-- =========================================================
-- Realtime: публикуем изменения watch_progress
-- (RLS всё равно ограничивает выдачу строк владельцем)
-- =========================================================
alter publication supabase_realtime add table watch_progress;
