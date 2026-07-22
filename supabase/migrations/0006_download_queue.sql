-- MediaWatch — миграция 0006: Telegram-бот и очередь скачивания
-- Применить через Supabase SQL Editor.

-- =========================================================
-- Привязка Telegram ID к аккаунту пользователя
-- =========================================================
create table if not exists telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_id text not null unique,
  created_at timestamptz not null default now()
);

-- Индекс для быстрого поиска по telegram_id (бот ищет пользователя).
create index if not exists telegram_links_tg_id_idx
  on telegram_links (telegram_id);

-- =========================================================
-- Верификация Telegram ID (код подтверждения)
-- =========================================================
create table if not exists telegram_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_id text not null,
  code text not null,
  status text not null default 'pending' check (status in ('pending','sent','confirmed','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz
);

-- =========================================================
-- Очередь скачивания в Telegram
-- =========================================================
create table if not exists download_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tg_id text not null,
  content_type text not null check (content_type in ('anime', 'cinema')),
  shikimori_id integer not null,
  anime_title text not null,
  poster_url text,
  season integer not null default 1,
  episode integer not null,
  video_url text,
  file_size_bytes bigint,
  status text not null default 'pending' check (status in ('pending','extracting','downloading','sending','completed','failed')),
  error text,
  file_id text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Индексы для очереди (бот читает по статусу).
create index if not exists download_queue_status_idx
  on download_queue (status, created_at);

-- =========================================================
-- Row Level Security
-- =========================================================

-- telegram_links: пользователь видит только свою
  alter table telegram_links enable row level security;

  drop policy if exists "own tg links select" on telegram_links;
  drop policy if exists "own tg links insert" on telegram_links;
  drop policy if exists "own tg links update" on telegram_links;
  drop policy if exists "own tg links delete" on telegram_links;

  create policy "own tg links select" on telegram_links for select using (auth.uid() = user_id);
  create policy "own tg links insert" on telegram_links for insert with check (auth.uid() = user_id);
  create policy "own tg links update" on telegram_links for update using (auth.uid() = user_id);
  create policy "own tg links delete" on telegram_links for delete using (auth.uid() = user_id);

-- telegram_verifications: пользователь видит только свои
  alter table telegram_verifications enable row level security;

  drop policy if exists "own tg verifications select" on telegram_verifications;
  drop policy if exists "own tg verifications insert" on telegram_verifications;
  drop policy if exists "own tg verifications update" on telegram_verifications;

  create policy "own tg verifications select" on telegram_verifications for select using (auth.uid() = user_id);
  create policy "own tg verifications insert" on telegram_verifications for insert with check (auth.uid() = user_id);
  create policy "own tg verifications update" on telegram_verifications for update using (auth.uid() = user_id);

-- download_queue: пользователь видит только свои
  alter table download_queue enable row level security;

  drop policy if exists "own dq select" on download_queue;
  drop policy if exists "own dq insert" on download_queue;

  create policy "own dq select" on download_queue for select using (auth.uid() = user_id);
  create policy "own dq insert" on download_queue for insert with check (auth.uid() = user_id);

-- =========================================================
-- Привилегии
-- =========================================================
grant select, insert, update, delete on telegram_links to authenticated;
grant select, insert, update on telegram_verifications to authenticated;
grant select, insert on download_queue to authenticated;

-- =========================================================
-- Realtime для очереди (бот может читать через service_role)
-- =========================================================
alter publication supabase_realtime add table download_queue;

-- =========================================================
-- Функция атомарного захвата задачи (FOR UPDATE SKIP LOCKED)
-- Используется ботом для concurrency = 1.
-- Вызывается: SELECT * FROM claim_download_task();
-- =========================================================
create or replace function claim_download_task()
returns setof download_queue
language plpgsql
security definer
as $$
declare
  v_task download_queue;
begin
  select * into v_task
  from download_queue
  where status = 'pending'
    and retry_count < 3
  order by created_at asc
  limit 1
  for update skip locked;

  if found then
    update download_queue
    set status = 'extracting',
        started_at = now(),
        retry_count = retry_count + 1,
        error = null
    where id = v_task.id;

    return query select * from download_queue where id = v_task.id;
  end if;

  return;
end;
$$;
